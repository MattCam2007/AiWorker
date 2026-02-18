const { WebSocketServer } = require('ws');
const { ActivityTracker } = require('./activity');

class TerminalWSServer {
  constructor(httpServer, sessionManager) {
    this._sessionManager = sessionManager;
    // terminalId -> { pty, clients: Set<ws> }
    this._terminals = new Map();
    this._activity = new ActivityTracker();

    // Control channel clients
    this._controlClients = new Set();

    this._terminalWss = new WebSocketServer({ noServer: true });
    this._controlWss = new WebSocketServer({ noServer: true });

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
  }

  // --- Control channel ---

  _handleControlConnection(ws) {
    this._controlClients.add(ws);

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
            await this._sessionManager.createTerminal(msg.name, msg.command);
            await this._broadcastSessions();
            break;
          }
          case 'destroy_terminal': {
            if (!msg.id) break;
            await this._sessionManager.destroySession(msg.id);
            await this._broadcastSessions();
            break;
          }
        }
      } catch (err) {
        console.error('Control WebSocket handler error:', err);
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

    if (!terminal) {
      let pty;
      try {
        pty = await this._sessionManager.attachSession(terminalId);
      } catch (err) {
        ws.close(4004, `Terminal not found: ${terminalId}`);
        return;
      }

      terminal = { pty, clients: new Set() };
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
    }

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
          pty.write(msg.data);
          break;
        case 'resize':
          if (
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
      if (terminal.clients.size === 0) {
        try {
          pty.kill();
        } catch {}
        this._terminals.delete(terminalId);
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

    for (const ws of this._controlClients) {
      ws.close(1001, 'Server shutting down');
    }
    this._controlClients.clear();

    for (const [, terminal] of this._terminals) {
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
