const { execSync, exec } = require('child_process');
const pty = require('node-pty');

class SessionManager {
  constructor(config) {
    this._config = config;
    this._sessions = new Map(); // id -> { id, name, command, workingDir, ephemeral }
  }

  _tmuxSessionName(id) {
    return `terminaldeck-${id}`;
  }

  _tmuxSessionExists(id) {
    try {
      execSync(`tmux has-session -t "${this._tmuxSessionName(id)}" 2>/dev/null`);
      return true;
    } catch {
      return false;
    }
  }

  async createSession(terminalConfig) {
    const { id, name, command, workingDir } = terminalConfig;
    const tmuxName = this._tmuxSessionName(id);
    const shell = command || this._config.settings.shell || '/bin/bash';
    const cwd = workingDir || '/home';

    if (!this._tmuxSessionExists(id)) {
      execSync(
        `tmux new-session -d -s "${tmuxName}" -c "${cwd}" "${shell}"`,
        { stdio: 'ignore' }
      );
    }

    this._sessions.set(id, {
      id,
      name: name || id,
      command: shell,
      workingDir: cwd,
      ephemeral: false
    });
  }

  attachSession(id) {
    const tmuxName = this._tmuxSessionName(id);
    if (!this._tmuxSessionExists(id)) {
      throw new Error(`No tmux session found for terminal: ${id}`);
    }

    const ptyProcess = pty.spawn('tmux', ['attach-session', '-t', tmuxName], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      env: process.env
    });

    return ptyProcess;
  }

  async destroySession(id) {
    const tmuxName = this._tmuxSessionName(id);
    try {
      execSync(`tmux kill-session -t "${tmuxName}" 2>/dev/null`);
    } catch {}
    this._sessions.delete(id);
  }

  async listSessions() {
    const result = [];
    for (const [id, session] of this._sessions) {
      result.push({
        id,
        name: session.name,
        active: this._tmuxSessionExists(id),
        ephemeral: session.ephemeral
      });
    }
    return result;
  }

  async startAll() {
    const autoStartTerminals = this._config.terminals.filter((t) => t.autoStart);
    for (const terminal of autoStartTerminals) {
      await this.createSession(terminal);
    }
  }

  async createEphemeral(name, command) {
    const id = `ephemeral-${Date.now()}`;
    const shell = command || this._config.settings.shell || '/bin/bash';
    const tmuxName = this._tmuxSessionName(id);

    execSync(`tmux new-session -d -s "${tmuxName}" "${shell}"`, { stdio: 'ignore' });

    this._sessions.set(id, {
      id,
      name: name || id,
      command: shell,
      workingDir: '/home',
      ephemeral: true
    });

    return { id, name: name || id };
  }

  async handleConfigReload(newConfig) {
    const oldIds = new Set(
      [...this._sessions.entries()]
        .filter(([, s]) => !s.ephemeral)
        .map(([id]) => id)
    );
    const newTerminals = newConfig.terminals.filter((t) => t.autoStart);
    const newIds = new Set(newTerminals.map((t) => t.id));

    // Remove sessions no longer in config
    for (const id of oldIds) {
      if (!newIds.has(id)) {
        await this.destroySession(id);
      }
    }

    // Add new sessions
    for (const terminal of newTerminals) {
      if (!this._sessions.has(terminal.id)) {
        await this.createSession(terminal);
      }
    }

    this._config = newConfig;
  }
}

module.exports = { SessionManager };
