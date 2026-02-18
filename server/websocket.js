const { WebSocketServer } = require('ws');

class TerminalWSServer {
  constructor(httpServer, sessionManager) {
    this._sessionManager = sessionManager;
    // terminalId -> { pty, clients: Set<ws> }
    this._terminals = new Map();

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

  async _handleConnection(ws, terminalId) {
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

      // Set up pty output broadcast ONCE when pty is created
      pty.onData((data) => {
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
          if (
            typeof msg.cols === 'number' && typeof msg.rows === 'number' &&
            msg.cols > 0 && msg.rows > 0 &&
            msg.cols <= 500 && msg.rows <= 200
          ) {
            pty.resize(msg.cols, msg.rows);
          }
          break;

        case 'create_ephemeral': {
          const session = await this._sessionManager.createEphemeral(msg.name);
          this._broadcastSessions();
          break;
        }

        case 'destroy_ephemeral': {
          if (!msg.id || !msg.id.startsWith('ephemeral-')) {
            ws.send(JSON.stringify({ type: 'error', message: 'Can only destroy ephemeral sessions' }));
            break;
          }
          await this._sessionManager.destroySession(msg.id);
          this._broadcastSessions();
          break;
        }
      }
    });

    // Cleanup on disconnect
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

  async _broadcastSessions() {
    const sessions = await this._sessionManager.listSessions();
    const msg = JSON.stringify({ type: 'sessions', sessions });

    for (const [, terminal] of this._terminals) {
      for (const ws of terminal.clients) {
        if (ws.readyState === ws.OPEN) {
          ws.send(msg);
        }
      }
    }
  }

  broadcastConfigReload(config) {
    const msg = JSON.stringify({ type: 'config_reload', config });
    for (const [, terminal] of this._terminals) {
      for (const ws of terminal.clients) {
        if (ws.readyState === ws.OPEN) {
          ws.send(msg);
        }
      }
    }
  }

  broadcastActivity(id, active) {
    const msg = JSON.stringify({ type: 'activity', id, active });
    for (const [, terminal] of this._terminals) {
      for (const ws of terminal.clients) {
        if (ws.readyState === ws.OPEN) {
          ws.send(msg);
        }
      }
    }
  }

  closeAll() {
    for (const [, terminal] of this._terminals) {
      for (const ws of terminal.clients) {
        ws.close(1001, 'Server shutting down');
      }
      try { terminal.pty.kill(); } catch {}
    }
    this._terminals.clear();
    this._wss.close();
  }
}

module.exports = { TerminalWSServer };
