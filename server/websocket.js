const { execFile } = require('child_process');
const { WebSocketServer } = require('ws');
const { ActivityTracker } = require('./activity');
const log = require('./log');

const PTY_GRACE_PERIOD = 30000; // 30s before killing orphaned PTY
const HEARTBEAT_INTERVAL = 15000; // 15s ping interval
const HEARTBEAT_TIMEOUT = 10000; // 10s to receive pong

function short(id) { return id ? id.slice(0, 8) : '?'; }

class TerminalWSServer {
  constructor(httpServer, sessionManager) {
    this._sessionManager = sessionManager;
    // terminalId -> { pty, clients: Set<ws>, disconnectTimer, exited }
    this._terminals = new Map();
    this._activity = new ActivityTracker();

    // Control channel clients
    this._controlClients = new Set();
    this._heartbeatInterval = null;

    this._terminalWss = new WebSocketServer({ noServer: true, maxPayload: 1 * 1024 * 1024 });
    this._controlWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

    httpServer.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

      if (pathname === '/ws/control') {
        this._controlWss.handleUpgrade(req, socket, head, (ws) => {
          this._handleControlConnection(ws);
        });
        return;
      }

      const match = pathname.match(/^\/ws\/terminal\/(.+)$/);
      if (match) {
        const terminalId = match[1];
        this._terminalWss.handleUpgrade(req, socket, head, (ws) => {
          this._handleTerminalConnection(ws, terminalId);
        });
        return;
      }

      socket.destroy();
    });

    this._startHeartbeat();
  }

  // --- Heartbeat / ping-pong ---

  _startHeartbeat() {
    this._heartbeatInterval = setInterval(() => {
      const now = Date.now();

      // Ping control clients
      for (const ws of this._controlClients) {
        if (ws._pendingPing && (now - ws._pendingPing > HEARTBEAT_TIMEOUT)) {
          ws.terminate();
          continue;
        }
        ws._pendingPing = now;
        try { ws.ping(); } catch {}
      }

      // Ping terminal clients
      for (const [termId, terminal] of this._terminals) {
        for (const ws of terminal.clients) {
          if (ws._pendingPing && (now - ws._pendingPing > HEARTBEAT_TIMEOUT)) {
            log.debug(`[ws] heartbeat timeout, killing stale connection for ${short(termId)}`);
            ws.terminate();
            continue;
          }
          ws._pendingPing = now;
          try { ws.ping(); } catch {}
        }
      }
    }, HEARTBEAT_INTERVAL);
  }

  // --- Control channel ---

  _handleControlConnection(ws) {
    this._controlClients.add(ws);
    ws._pendingPing = 0;

    ws.on('pong', () => {
      ws._pendingPing = 0;
    });

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      try {
        switch (msg.type) {
          case 'create_terminal': {
            await this._sessionManager.createTerminal(
              msg.name, msg.command, msg.headerBg, msg.headerColor
            );
            await this._broadcastSessions();
            break;
          }
          case 'destroy_terminal': {
            if (!msg.id) break;
            log.warn(`[ws] destroy_terminal received for ${short(msg.id)} from control client`);
            await this._sessionManager.destroySession(msg.id);
            await this._broadcastSessions();
            break;
          }
          case 'update_terminal': {
            if (!msg.id) break;
            var updates = {};
            if (msg.name !== undefined) updates.name = msg.name;
            if (msg.headerBg !== undefined) updates.headerBg = msg.headerBg;
            if (msg.headerColor !== undefined) updates.headerColor = msg.headerColor;
            this._sessionManager.updateSession(msg.id, updates);
            await this._broadcastSessions();
            break;
          }
        }
      } catch (err) {
        log.error('Control WebSocket handler error:', err);
        try {
          ws.send(JSON.stringify({ type: 'error', message: err.message || 'Internal error' }));
        } catch {}
      }
    });

    ws.on('close', () => {
      this._controlClients.delete(ws);
    });
  }

  _sendToControl(msg) {
    const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const ws of this._controlClients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    }
  }

  async _broadcastSessions() {
    const sessions = await this._sessionManager.listSessions();
    this._sendToControl({ type: 'sessions', sessions });
  }

  broadcastConfigReload(config) {
    this._sendToControl({ type: 'config_reload', config });
  }

  // --- Terminal connections ---

  async _handleTerminalConnection(ws, terminalId) {
    let terminal = this._terminals.get(terminalId);

    if (terminal) {
      // Reconnecting to existing PTY — cancel any pending disconnect timer
      if (terminal.disconnectTimer) {
        log.debug(`[ws] client reconnected to ${short(terminalId)} within grace period`);
        clearTimeout(terminal.disconnectTimer);
        terminal.disconnectTimer = null;
      }

      // If the PTY already exited, tell the client immediately
      if (terminal.exited) {
        ws.send(JSON.stringify({
          type: 'exited',
          exitCode: terminal.exitCode,
          signal: terminal.exitSignal
        }));
        ws.close(4001, 'Terminal already exited');
        return;
      }
    }

    if (!terminal) {
      let pty;
      try {
        pty = await this._sessionManager.attachSession(terminalId);
      } catch (err) {
        log.warn(`[pty] attach failed for ${short(terminalId)}: ${err.message}`);
        ws.close(4004, `Terminal not found: ${terminalId}`);
        return;
      }

      log.debug(`[pty] attached to ${short(terminalId)} (pid ${pty.pid})`);
      terminal = { pty, clients: new Set(), disconnectTimer: null, exited: false };
      this._terminals.set(terminalId, terminal);

      pty.onData((data) => {
        this._activity.recordOutput(terminalId);
        const msg = JSON.stringify({ type: 'output', data });
        for (const client of terminal.clients) {
          if (client.readyState === client.OPEN) {
            client.send(msg);
          }
        }
      });

      pty.onExit(({ exitCode, signal }) => {
        log.warn(`[pty] exited ${short(terminalId)} code=${exitCode} signal=${signal || 'none'} clients=${terminal.clients.size}`);

        const tmuxName = this._sessionManager._tmuxSessionName(terminalId);
        const tmuxSocket = 'terminaldeck';

        // Try to capture pane info before it disappears
        const { execFile: execFileCb } = require('child_process');
        execFileCb('tmux', ['-L', tmuxSocket, 'list-panes', '-t', tmuxName, '-F',
          '#{pane_pid} #{pane_dead} #{pane_dead_status}'], (err, stdout) => {
          if (err) {
            log.warn(`[tmux] could not query panes for ${short(terminalId)}: ${err.message}`);
          } else {
            log.debug(`[tmux] pane state for ${short(terminalId)}: ${stdout.trim()}`);
          }
        });

        // Immediately check if the tmux session is still alive
        this._sessionManager._tmuxSessionExists(terminalId).then((alive) => {
          if (!alive) {
            log.error(`[tmux] session ${short(terminalId)} is GONE — tmux killed the session`);
            this._sessionManager._dumpDiagnostics().catch(() => {});
          } else {
            log.debug(`[tmux] session ${short(terminalId)} still alive (attach process exited)`);
          }
        }).catch(() => {});

        terminal.exited = true;
        terminal.exitCode = exitCode;
        terminal.exitSignal = signal;

        // Notify all connected clients
        const msg = JSON.stringify({ type: 'exited', exitCode, signal });
        for (const client of terminal.clients) {
          if (client.readyState === client.OPEN) {
            try { client.send(msg); } catch {}
          }
        }

        // Clean up after a short delay (let clients receive the message)
        setTimeout(() => {
          this._terminals.delete(terminalId);
        }, 5000);
      });
    }

    ws._pendingPing = 0;
    ws.on('pong', () => {
      ws._pendingPing = 0;
    });

    const { pty } = terminal;
    terminal.clients.add(ws);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case 'input':
          if (!terminal.exited) {
            pty.write(msg.data);
          }
          break;
        case 'resize':
          if (
            !terminal.exited &&
            typeof msg.cols === 'number' && typeof msg.rows === 'number' &&
            msg.cols > 0 && msg.rows > 0 &&
            msg.cols <= 500 && msg.rows <= 200
          ) {
            pty.resize(msg.cols, msg.rows);
          }
          break;
      }
    });

    ws.on('close', () => {
      terminal.clients.delete(ws);
      if (terminal.clients.size === 0 && !terminal.exited) {
        log.debug(`[ws] last client left ${short(terminalId)}, grace period ${PTY_GRACE_PERIOD / 1000}s`);
        // Don't kill immediately — allow reconnection within grace period
        terminal.disconnectTimer = setTimeout(() => {
          log.debug(`[pty] grace period expired, killing ${short(terminalId)}`);
          try { pty.kill(); } catch {}
          this._terminals.delete(terminalId);
        }, PTY_GRACE_PERIOD);
      }
    });
  }

  // --- Activity broadcasting ---

  startActivityBroadcasting() {
    this._activity.startBroadcasting((msg) => {
      this._sendToControl(msg);
    });
  }

  stopActivityBroadcasting() {
    this._activity.stopBroadcasting();
  }

  // --- Cleanup ---

  closeAll() {
    this._activity.stopBroadcasting();

    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }

    for (const ws of this._controlClients) {
      ws.close(1001, 'Server shutting down');
    }
    this._controlClients.clear();

    for (const [, terminal] of this._terminals) {
      if (terminal.disconnectTimer) {
        clearTimeout(terminal.disconnectTimer);
      }
      for (const ws of terminal.clients) {
        ws.close(1001, 'Server shutting down');
      }
      try { terminal.pty.kill(); } catch {}
    }
    this._terminals.clear();

    this._terminalWss.close();
    this._controlWss.close();
  }
}

module.exports = { TerminalWSServer };
