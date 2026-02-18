const { execFile } = require('child_process');
const util = require('util');
const { randomUUID } = require('crypto');
const pty = require('node-pty');

const execFileAsync = util.promisify(execFile);

const SESSION_PREFIX = 'terminaldeck-';

class SessionManager {
  constructor(config) {
    this._config = config;
    this._sessions = new Map(); // id -> { id, name, command, workingDir }
  }

  _tmuxSessionName(id) {
    return `${SESSION_PREFIX}${id}`;
  }

  async _tmuxSessionExists(id) {
    try {
      await execFileAsync('tmux', ['has-session', '-t', this._tmuxSessionName(id)]);
      return true;
    } catch {
      return false;
    }
  }

  async discoverSessions() {
    let tmuxSessions;
    try {
      const { stdout } = await execFileAsync('tmux', ['list-sessions', '-F', '#{session_name}']);
      tmuxSessions = stdout.trim().split('\n').filter(Boolean);
    } catch {
      tmuxSessions = [];
    }

    for (const name of tmuxSessions) {
      if (!name.startsWith(SESSION_PREFIX)) continue;
      const id = name.slice(SESSION_PREFIX.length);
      if (!this._sessions.has(id)) {
        this._sessions.set(id, {
          id,
          name: id,
          command: this._config.settings.shell || '/bin/bash',
          workingDir: '/workspace'
        });
      }
    }
  }

  async createTerminal(name, command) {
    const id = randomUUID();
    const shell = command || this._config.settings.shell || '/bin/bash';
    const tmuxName = this._tmuxSessionName(id);

    await execFileAsync('tmux', ['new-session', '-d', '-s', tmuxName, '-c', '/workspace', shell]);

    this._sessions.set(id, {
      id,
      name: name || id,
      command: shell,
      workingDir: '/workspace'
    });

    return { id, name: name || id };
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
        active: activeTmuxSessions.has(this._tmuxSessionName(id))
      });
    }
    return result;
  }
}

module.exports = { SessionManager };
