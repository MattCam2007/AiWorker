const { WebSocketServer } = require('ws');

class TerminalWSServer {
  constructor(httpServer, sessionManager) {
    this._sessionManager = sessionManager;
    // Map of terminalId -> Set of { ws, pty }
    this._clients = new Map();

    this._wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
      const match = pathname.match(/^\/ws\/terminal\/(.+)$/);

      if (!match) {
        socket.destroy();
        return;
      }

      const terminalId = match[1];

      this._wss.handleUpgrade(req, socket, head, (ws) => {
        this._handleConnection(ws, terminalId);
      });
    });
  }

  _handleConnection(ws, terminalId) {
    let pty;
    try {
      pty = this._sessionManager.attachSession(terminalId);
    } catch (err) {
      ws.close(4004, `Terminal not found: ${terminalId}`);
      return;
    }

    // Track client
    if (!this._clients.has(terminalId)) {
      this._clients.set(terminalId, new Set());
    }
    const client = { ws, pty };
    this._clients.get(terminalId).add(client);

    // pty output -> ws
    pty.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    // ws messages -> pty / control
    ws.on('message', async (raw) => {
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
          if (msg.cols && msg.rows) {
            pty.resize(msg.cols, msg.rows);
          }
          break;

        case 'create_ephemeral': {
          const session = await this._sessionManager.createEphemeral(
            msg.name,
            msg.command
          );
          this._broadcastSessions();
          break;
        }

        case 'destroy_ephemeral': {
          await this._sessionManager.destroySession(msg.id);
          this._broadcastSessions();
          break;
        }
      }
    });

    // Cleanup on disconnect
    ws.on('close', () => {
      try {
        pty.kill();
      } catch {}
      const clientSet = this._clients.get(terminalId);
      if (clientSet) {
        clientSet.delete(client);
        if (clientSet.size === 0) {
          this._clients.delete(terminalId);
        }
      }
    });
  }

  async _broadcastSessions() {
    const sessions = await this._sessionManager.listSessions();
    const msg = JSON.stringify({ type: 'sessions', sessions });

    for (const [, clientSet] of this._clients) {
      for (const { ws } of clientSet) {
        if (ws.readyState === ws.OPEN) {
          ws.send(msg);
        }
      }
    }
  }

  broadcastConfigReload(config) {
    const msg = JSON.stringify({ type: 'config_reload', config });
    for (const [, clientSet] of this._clients) {
      for (const { ws } of clientSet) {
        if (ws.readyState === ws.OPEN) {
          ws.send(msg);
        }
      }
    }
  }

  broadcastActivity(id, active) {
    const msg = JSON.stringify({ type: 'activity', id, active });
    for (const [, clientSet] of this._clients) {
      for (const { ws } of clientSet) {
        if (ws.readyState === ws.OPEN) {
          ws.send(msg);
        }
      }
    }
  }
}

module.exports = { WebSocketServer: TerminalWSServer };
