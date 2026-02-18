const { execFile } = require('child_process');
const util = require('util');
const { randomUUID } = require('crypto');
const pty = require('node-pty');

const execFileAsync = util.promisify(execFile);

class SessionManager {
  constructor(config) {
    this._config = config;
    this._sessions = new Map(); // id -> { id, name, command, workingDir, ephemeral }
  }

  _tmuxSessionName(id) {
    return `terminaldeck-${id}`;
  }

  async _tmuxSessionExists(id) {
    try {
      await execFileAsync('tmux', ['has-session', '-t', this._tmuxSessionName(id)]);
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

    if (!(await this._tmuxSessionExists(id))) {
      await execFileAsync('tmux', ['new-session', '-d', '-s', tmuxName, '-c', cwd, shell]);
    }

    this._sessions.set(id, {
      id,
      name: name || id,
      command: shell,
      workingDir: cwd,
      ephemeral: false
    });
  }

  async attachSession(id) {
    const tmuxName = this._tmuxSessionName(id);
    if (!(await this._tmuxSessionExists(id))) {
      throw new Error(`No tmux session found for terminal: ${id}`);
    }

    const safeEnv = {
      TERM: 'xterm-256color',
      LANG: process.env.LANG || 'en_US.UTF-8',
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME || '/home',
      SHELL: process.env.SHELL || '/bin/bash',
      USER: process.env.USER || '',
      COLORTERM: 'truecolor',
    };

    const ptyProcess = pty.spawn('tmux', ['attach-session', '-t', tmuxName], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      env: safeEnv
    });

    return ptyProcess;
  }

  async destroySession(id) {
    const tmuxName = this._tmuxSessionName(id);
    try {
      await execFileAsync('tmux', ['kill-session', '-t', tmuxName]);
    } catch {}
    this._sessions.delete(id);
  }

  async listSessions() {
    let activeTmuxSessions;
    try {
      const { stdout } = await execFileAsync('tmux', ['list-sessions', '-F', '#{session_name}']);
      activeTmuxSessions = new Set(stdout.trim().split('\n').filter(Boolean));
    } catch {
      activeTmuxSessions = new Set();
    }

    const result = [];
    for (const [id, session] of this._sessions) {
      result.push({
        id,
        name: session.name,
        active: activeTmuxSessions.has(this._tmuxSessionName(id)),
        ephemeral: session.ephemeral
      });
    }
    return result;
  }

  async startAll() {
    const autoStartTerminals = this._config.terminals.filter((t) => t.autoStart);
    await Promise.all(autoStartTerminals.map((terminal) => this.createSession(terminal)));
  }

  async createEphemeral(name, command) {
    const id = `ephemeral-${randomUUID()}`;
    const shell = command || this._config.settings.shell || '/bin/bash';
    const tmuxName = this._tmuxSessionName(id);

    await execFileAsync('tmux', ['new-session', '-d', '-s', tmuxName, shell]);

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
    const allNewIds = new Set(newConfig.terminals.map((t) => t.id));
    const autoStartTerminals = newConfig.terminals.filter((t) => t.autoStart);

    // Remove sessions no longer in config
    await Promise.all(
      [...oldIds].filter((id) => !allNewIds.has(id)).map((id) => this.destroySession(id))
    );

    // Add new sessions (only autoStart)
    await Promise.all(
      autoStartTerminals
        .filter((terminal) => !this._sessions.has(terminal.id))
        .map((terminal) => this.createSession(terminal))
    );

    this._config = newConfig;
  }
}

module.exports = { SessionManager };
