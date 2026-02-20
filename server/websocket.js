const { WebSocketServer } = require('ws');
const { ActivityTracker } = require('./activity');
const log = require('./log');

const MAX_TERM_COLS = 500;
const MAX_TERM_ROWS = 200;

const HEARTBEAT_INTERVAL = 15000; // 15s ping interval
const HEARTBEAT_TIMEOUT = 10000; // 10s to receive pong
const MAX_REATTACH = 5; // max PTY re-attach attempts before giving up

function short(id) { return id ? id.slice(0, 8) : '?'; }

class TerminalWSServer {
  // --- Constructor / Initialization ---

  constructor(httpServer, sessionManager, options = {}) {
    this._sessionManager = sessionManager;
    this._serverToken = options.serverToken || null;
    // wsId -> { ws, pty, terminalId, exited, reattachCount }
    this._connections = new Map();
    this._nextWsId = 0;
    this._activity = new ActivityTracker();

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
      for (const [wsId, conn] of this._connections) {
        const ws = conn.ws;
        if (ws._pendingPing && (now - ws._pendingPing > HEARTBEAT_TIMEOUT)) {
          log.debug(`[ws] heartbeat timeout, killing stale connection ${wsId} for ${short(conn.terminalId)}`);
          ws.terminate();
          continue;
        }
        ws._pendingPing = now;
        try { ws.ping(); } catch (err) { log.debug('[ws] ping failed:', err.message); }
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

  // --- PTY Lifecycle ---

  /**
   * Wire onData/onExit handlers for a per-connection PTY.
   * If the PTY exits but the tmux session is still alive, automatically
   * re-attach for this connection only.
   */
  _setupPtyHandlers(wsId, conn) {
    const pty = conn.pty;

    pty.onData((data) => {
      this._activity.recordOutput(conn.terminalId);
      if (conn.ws.readyState === conn.ws.OPEN) {
        this._safeSend(conn.ws, JSON.stringify({ type: 'output', data }));
      }
    });

    pty.onExit(async ({ exitCode, signal }) => {
      log.warn(`[pty] exited conn=${wsId} terminal=${short(conn.terminalId)} code=${exitCode} signal=${signal || 'none'}`);

      // If connection was already cleaned up, nothing to do
      if (!this._connections.has(wsId)) {
        log.debug(`[pty] conn ${wsId} already removed, ignoring exit`);
        return;
      }

      // Check if the tmux session is still alive
      let alive = false;
      try {
        alive = await this._sessionManager.tmuxSessionExists(conn.terminalId);
      } catch {}

      if (alive && conn.reattachCount < MAX_REATTACH) {
        conn.reattachCount++;
        log.log(`[pty] tmux session ${short(conn.terminalId)} still alive, re-attaching conn=${wsId} (attempt ${conn.reattachCount}/${MAX_REATTACH})...`);
        try {
          const newPty = await this._sessionManager.attachSession(conn.terminalId);
          conn.pty = newPty;
          this._setupPtyHandlers(wsId, conn);
          log.log(`[pty] re-attached conn=${wsId} to ${short(conn.terminalId)} (pid ${newPty.pid})`);
          return;
        } catch (err) {
          log.error(`[pty] re-attach failed for conn=${wsId} ${short(conn.terminalId)}: ${err.message}`);
        }
      } else if (alive) {
        log.error(`[pty] max re-attach attempts (${MAX_REATTACH}) reached for conn=${wsId} ${short(conn.terminalId)}, giving up`);
      } else {
        log.error(`[tmux] session ${short(conn.terminalId)} is GONE — tmux killed the session`);
        this._sessionManager.dumpDiagnostics().catch(() => {});
      }

      // Terminal is truly dead — notify this client
      conn.exited = true;

      if (conn.ws.readyState === conn.ws.OPEN) {
        try { conn.ws.send(JSON.stringify({ type: 'exited', exitCode, signal })); } catch (err) { log.debug('[ws] failed to send exited:', err.message); }
      }

      // Clean up after a short delay
      setTimeout(() => {
        this._connections.delete(wsId);
        // Only remove activity tracking if no other connections use this terminal
        const stillConnected = [...this._connections.values()].some(c => c.terminalId === conn.terminalId);
        if (!stillConnected) {
          this._activity.removeTerminal(conn.terminalId);
        }
      }, 5000);
    });
  }

  // --- Terminal Connections ---

  async _handleTerminalConnection(ws, terminalId) {
    // Every client gets its own PTY (tmux attach-session process)
    let pty;
    try {
      pty = await this._sessionManager.attachSession(terminalId);
    } catch (err) {
      log.warn(`[pty] attach failed for ${short(terminalId)}: ${err.message}`);
      ws.close(4004, `Terminal not found: ${terminalId}`);
      return;
    }

    const wsId = this._nextWsId++;
    const conn = { ws, pty, terminalId, exited: false, reattachCount: 0 };
    this._connections.set(wsId, conn);

    log.debug(`[pty] attached conn=${wsId} to ${short(terminalId)} (pid ${pty.pid})`);
    this._setupPtyHandlers(wsId, conn);

    ws._pendingPing = 0;
    ws._rateLimiter = { count: 0, windowStart: Date.now() };
    ws.on('pong', () => {
      ws._pendingPing = 0;
    });

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
        if (ws._lastResize && now2 - ws._lastResize < 100) return;
        ws._lastResize = now2;
      }

      switch (msg.type) {
        case 'input':
          if (!conn.exited) {
            conn.pty.write(msg.data);
          }
          break;
        case 'resize':
          if (
            !conn.exited &&
            typeof msg.cols === 'number' && typeof msg.rows === 'number' &&
            msg.cols > 0 && msg.rows > 0 &&
            msg.cols <= MAX_TERM_COLS && msg.rows <= MAX_TERM_ROWS
          ) {
            conn.pty.resize(msg.cols, msg.rows);
          }
          break;
      }
    });

    ws.on('close', () => {
      log.debug(`[ws] client disconnected conn=${wsId} from ${short(terminalId)}`);
      if (!conn.exited) {
        try { conn.pty.kill(); } catch (err) { log.debug('[pty] kill failed:', err.message); }
      }
      this._connections.delete(wsId);
    });
  }

  // --- Broadcasting ---

  startActivityBroadcasting() {
    this._activity.startBroadcasting((msg) => {
      this._sendToControl(msg);
    });
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

    for (const [, conn] of this._connections) {
      conn.ws.close(1001, 'Server shutting down');
      try { conn.pty.kill(); } catch (err) { log.debug('[pty] kill failed:', err.message); }
    }
    this._connections.clear();

    this._terminalWss.close();
    this._controlWss.close();
  }
}

module.exports = { TerminalWSServer };
