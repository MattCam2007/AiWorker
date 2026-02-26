const fs = require('fs');
const { WebSocketServer } = require('ws');
const { ActivityTracker } = require('./activity');
const { readHistory } = require('./history');
const { PromptDetector } = require('./prompt-detector');
const log = require('./log');

const MAX_TERM_COLS = 500;
const MAX_TERM_ROWS = 200;

const PTY_GRACE_PERIOD = 30000; // 30s before killing orphaned PTY
const HEARTBEAT_INTERVAL = 15000; // 15s ping interval
const HEARTBEAT_TIMEOUT = 10000; // 10s to receive pong
const MAX_REATTACH = 5; // max PTY re-attach attempts before giving up

function short(id) { return id ? id.slice(0, 8) : '?'; }

class TerminalWSServer {
  // --- Constructor / Initialization ---

  constructor(httpServer, sessionManager, options = {}) {
    this._sessionManager = sessionManager;
    this._serverToken = options.serverToken || null;
    // terminalId -> { pty, clients: Set<ws>, disconnectTimer, exited }
    this._terminals = new Map();
    this._activity = new ActivityTracker();

    // Prompt detection for task completion notifications
    const promptPattern = (options.configManager && options.configManager.getConfig())
      ? options.configManager.getConfig().settings.promptPattern
      : '\\$\\s*$';
    this._promptDetector = new PromptDetector(promptPattern, (terminalId) => {
      this._sendToControl({
        type: 'task_complete',
        terminalId,
        timestamp: new Date().toISOString()
      });
    });

    // Control channel clients
    this._controlClients = new Set();
    this._heartbeatInterval = null;

    this._terminalWss = new WebSocketServer({ noServer: true, maxPayload: 1 * 1024 * 1024 });
    this._controlWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

    httpServer.on('upgrade', (req, socket, head) => {
      const origin = req.headers.origin;
      if (origin) {
        const host = req.headers.host;
        if (origin !== `http://${host}` && origin !== `https://${host}`) {
          socket.destroy();
          return;
        }
      }

      const url = new URL(req.url, `http://${req.headers.host}`);
      if (this._serverToken) {
        if (url.searchParams.get('t') !== this._serverToken) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      const pathname = url.pathname;

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

  // --- Heartbeat ---

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
        try { ws.ping(); } catch (err) { log.debug('[ws] ping failed:', err.message); }
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
          try { ws.ping(); } catch (err) { log.debug('[ws] ping failed:', err.message); }
        }
      }
    }, HEARTBEAT_INTERVAL);
  }

  // --- Control Channel ---

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
            const updates = {};
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
        } catch (err) { log.debug('[ws] failed to send error:', err.message); }
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
        this._safeSend(ws, data);
      }
    }
  }

  _safeSend(ws, data) {
    if (ws.bufferedAmount > 256 * 1024) {
      log.debug('[ws] skipping send, buffer full');
      return;
    }
    try { ws.send(data); } catch (err) { log.debug('[ws] send failed:', err.message); }
  }

  async _broadcastSessions() {
    const sessions = await this._sessionManager.listSessions();
    this._sendToControl({ type: 'sessions', sessions });
  }

  broadcastConfigReload(config) {
    this._sendToControl({ type: 'config_reload', config });
  }

  broadcastNoteSaved(noteId) {
    this._sendToControl({ type: 'note_saved', noteId: noteId, timestamp: new Date().toISOString() });
  }

  // --- PTY Lifecycle ---

  /**
   * Wire onData/onExit handlers on the current terminal.pty.
   * If the PTY exits but the tmux session is still alive, automatically
   * re-attach instead of telling clients the terminal died.
   */
  _setupPtyHandlers(terminalId, terminal) {
    const pty = terminal.pty;

    pty.onData((data) => {
      this._activity.recordOutput(terminalId);
      this._promptDetector.recordOutput(terminalId, data);
      const msg = JSON.stringify({ type: 'output', data });
      for (const client of terminal.clients) {
        if (client.readyState === client.OPEN) {
          this._safeSend(client, msg);
        }
      }
      terminal.outputBuffer += data;
      if (terminal.outputBuffer.length > 65536) {
        terminal.outputBuffer = terminal.outputBuffer.slice(-65536);
      }
    });

    pty.onExit(async ({ exitCode, signal }) => {
      log.warn(`[pty] exited ${short(terminalId)} code=${exitCode} signal=${signal || 'none'} clients=${terminal.clients.size}`);

      // If terminal was already cleaned up (grace period or destroy), nothing to do
      if (!this._terminals.has(terminalId)) {
        log.debug(`[pty] ${short(terminalId)} already removed from map, ignoring exit`);
        return;
      }

      // Check if the tmux session is still alive
      let alive = false;
      try {
        alive = await this._sessionManager.tmuxSessionExists(terminalId);
      } catch {}

      if (alive && (terminal.reattachCount || 0) < MAX_REATTACH) {
        terminal.reattachCount = (terminal.reattachCount || 0) + 1;
        log.log(`[pty] tmux session ${short(terminalId)} still alive, re-attaching (attempt ${terminal.reattachCount}/${MAX_REATTACH})...`);
        try {
          const newPty = await this._sessionManager.attachSession(terminalId);
          terminal.pty = newPty;
          this._setupPtyHandlers(terminalId, terminal);
          log.log(`[pty] re-attached to ${short(terminalId)} (pid ${newPty.pid})`);
          return;
        } catch (err) {
          log.error(`[pty] re-attach failed for ${short(terminalId)}: ${err.message}`);
        }
      } else if (alive) {
        log.error(`[pty] max re-attach attempts (${MAX_REATTACH}) reached for ${short(terminalId)}, giving up`);
      } else {
        log.error(`[tmux] session ${short(terminalId)} is GONE — tmux killed the session`);
        this._sessionManager.dumpDiagnostics().catch(() => {});
      }

      // Terminal is truly dead — notify clients
      terminal.exited = true;
      terminal.exitCode = exitCode;
      terminal.exitSignal = signal;

      const msg = JSON.stringify({ type: 'exited', exitCode, signal });
      for (const client of terminal.clients) {
        if (client.readyState === client.OPEN) {
          try { client.send(msg); } catch (err) { log.debug('[ws] failed to send exited:', err.message); }
        }
      }

      setTimeout(() => {
        terminal.outputBuffer = '';
        this._terminals.delete(terminalId);
        this._activity.removeTerminal(terminalId);
        this._promptDetector.removeTerminal(terminalId);
      }, 5000);
    });
  }

  // --- Terminal Connections ---

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
      terminal = { pty, clients: new Set(), disconnectTimer: null, exited: false, reattachCount: 0, outputBuffer: '' };
      this._terminals.set(terminalId, terminal);
      this._setupPtyHandlers(terminalId, terminal);
    }

    ws._pendingPing = 0;
    ws._rateLimiter = { count: 0, windowStart: Date.now() };
    ws.on('pong', () => {
      ws._pendingPing = 0;
    });

    terminal.clients.add(ws);

    if (terminal.outputBuffer) {
      try { ws.send(JSON.stringify({ type: 'output', data: terminal.outputBuffer })); } catch (e) {}
    }

    ws.on('message', (raw) => {
      const now = Date.now();
      if (now - ws._rateLimiter.windowStart > 1000) {
        ws._rateLimiter.count = 0;
        ws._rateLimiter.windowStart = now;
      }
      ws._rateLimiter.count++;
      if (ws._rateLimiter.count > 100) return; // drop silently

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === 'resize') {
        const now2 = Date.now();
        if (terminal.lastResize && now2 - terminal.lastResize < 100) return;
        terminal.lastResize = now2;
      }

      switch (msg.type) {
        case 'input':
          if (!terminal.exited) {
            terminal.pty.write(msg.data);
          }
          break;
        case 'resize':
          if (
            !terminal.exited &&
            typeof msg.cols === 'number' && typeof msg.rows === 'number' &&
            msg.cols > 0 && msg.rows > 0 &&
            msg.cols <= MAX_TERM_COLS && msg.rows <= MAX_TERM_ROWS
          ) {
            terminal.pty.resize(msg.cols, msg.rows);
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
          try { terminal.pty.kill(); } catch (err) { log.debug('[pty] kill failed:', err.message); }
          terminal.outputBuffer = '';
          this._terminals.delete(terminalId);
          this._activity.removeTerminal(terminalId);
          this._promptDetector.removeTerminal(terminalId);
        }, PTY_GRACE_PERIOD);
      }
    });
  }

  // --- Broadcasting ---

  startActivityBroadcasting() {
    this._activity.startBroadcasting((msg) => {
      this._sendToControl(msg);
    });
  }

  // --- History File Watcher ---

  /**
   * Watch a history file for changes and broadcast updates to control clients.
   * @param {string} historyFilePath - Absolute path to the history file
   */
  watchHistoryFile(historyFilePath) {
    if (this._historyWatcher) return;
    this._historyDebounceTimer = null;

    try {
      this._historyWatcher = fs.watch(historyFilePath, () => {
        clearTimeout(this._historyDebounceTimer);
        this._historyDebounceTimer = setTimeout(() => {
          try {
            const history = readHistory(historyFilePath);
            this._sendToControl({ type: 'history_update', history });
          } catch (err) {
            log.debug('[history] failed to read history file:', err.message);
          }
        }, 500);
      });

      this._historyWatcher.on('error', (err) => {
        log.debug('[history] watcher error:', err.message);
      });
    } catch (err) {
      log.debug('[history] failed to watch history file:', err.message);
    }
  }

  stopWatchingHistory() {
    if (this._historyWatcher) {
      this._historyWatcher.close();
      this._historyWatcher = null;
    }
    clearTimeout(this._historyDebounceTimer);
  }

  // --- Cleanup ---

  closeAll() {
    this._activity.stopBroadcasting();
    this.stopWatchingHistory();

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
      terminal.outputBuffer = '';
      try { terminal.pty.kill(); } catch (err) { log.debug('[pty] kill failed:', err.message); }
    }
    this._terminals.clear();

    this._terminalWss.close();
    this._controlWss.close();
  }
}

module.exports = { TerminalWSServer };
