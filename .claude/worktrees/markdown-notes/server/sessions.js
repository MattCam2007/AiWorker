const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const util = require('util');
const { randomUUID } = require('crypto');
const os = require('os');
const pty = require('node-pty');
const log = require('./log');

const execFileAsync = util.promisify(execFile);

const DIAG_TIMEOUT_MS = 2000;
const DIAG_GREP_TIMEOUT_MS = 30000;

const SESSION_PREFIX = 'terminaldeck-';
const TMUX_SOCKET = 'terminaldeck'; // Dedicated socket to isolate from processes inside terminals
const HEALTH_CHECK_INTERVAL = 10000; // 10s

function isValidColor(val) {
  return val === null || /^#[0-9a-fA-F]{6}$/.test(val);
}

function isValidCommand(cmd) {
  // Allow absolute executable paths: /bin/bash, /usr/bin/zsh, etc.
  if (/^\/[a-zA-Z0-9/_.-]+$/.test(cmd)) return true;
  // Allow "editor /path" patterns for file opening
  if (/^(vi|vim|nvim|nano|emacs|code)\s+\/[a-zA-Z0-9/_. '-]+$/.test(cmd)) return true;
  return false;
}

class SessionManager extends EventEmitter {
  constructor(config) {
    super();
    this._config = config;
    this._sessions = new Map(); // id -> { id, name, command, workingDir }
    this._healthInterval = null;
    this._serverDownLogged = false;
    this._serverStarted = false;
  }

  // Start tmux server on our dedicated socket (verbose logging when DEBUG=1)
  async _ensureServer() {
    if (this._serverStarted) return;
    this._serverStarted = true;
    try {
      const args = ['-L', TMUX_SOCKET];
      if (process.env.DEBUG === '1' || process.env.DEBUG === 'true') args.push('-vvv');
      args.push('start-server');
      await execFileAsync('tmux', args);
      log.debug(`[tmux] server started on socket "${TMUX_SOCKET}"`);
    } catch (err) {
      // Server may already be running — not an error
      log.debug(`[tmux] start-server: ${err.message}`);
    }
  }

  _tmuxSessionName(id) {
    return `${SESSION_PREFIX}${id}`;
  }

  async _tmuxSessionExists(id) {
    try {
      await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'has-session', '-t', this._tmuxSessionName(id)]);
      return true;
    } catch {
      return false;
    }
  }

  // Public wrappers for cross-module access
  async tmuxSessionExists(id) { return this._tmuxSessionExists(id); }
  async dumpDiagnostics() { return this._dumpDiagnostics(); }

  async discoverSessions() {
    let tmuxSessions;
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'list-sessions', '-F', '#{session_name}']);
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
          workingDir: '/workspace',
          headerBg: null,
          headerColor: null
        });
      }
    }
  }

  async createTerminal(name, command, headerBg, headerColor) {
    if (name && (typeof name !== 'string' || name.length > 100)) {
      throw new Error('Terminal name must be a string of 100 characters or fewer');
    }

    const id = randomUUID();
    const shell = command || this._config.settings.shell || '/bin/bash';
    if (!isValidCommand(shell)) {
      throw new Error(`Invalid command: ${shell}`);
    }
    if (/[\n\r\0]/.test(shell)) throw new Error('Invalid command: contains control characters');
    const validBg = isValidColor(headerBg) ? headerBg : null;
    const validColor = isValidColor(headerColor) ? headerColor : null;
    const tmuxName = this._tmuxSessionName(id);

    log.log(`[tmux] creating session ${tmuxName.slice(-8)} cmd="${shell}"`);
    await this._ensureServer();
    // Unset TMUX/TMUX_PANE so processes inside can't discover our tmux.
    // Combined with the dedicated socket (-L terminaldeck), processes inside
    // won't find our sessions even if they run `tmux list-sessions`.
    const sessionCmd = `unset TMUX TMUX_PANE; exec ${shell}`;
    await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'new-session', '-d', '-s', tmuxName, '-c', '/workspace', sessionCmd]);

    // Explicitly set remain-on-exit as a WINDOW option on this session's window.
    // The global setw -g in tmux.conf may not propagate correctly in all cases.
    try {
      await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'set-window-option', '-t', `${tmuxName}:`, 'remain-on-exit', 'on']);
    } catch (err) {
      log.error(`[tmux] failed to set remain-on-exit on ${tmuxName.slice(-8)}: ${err.message}`);
    }

    // Verify the session survived creation
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'list-sessions', '-F', '#{session_name}']);
      const sessions = stdout.trim().split('\n').filter(Boolean);
      if (!sessions.includes(tmuxName)) {
        log.error(`[tmux] session GONE immediately after creation!`);
      }
    } catch (err) {
      log.error(`[tmux] server DEAD immediately after creating session: ${err.message}`);
    }

    this._sessions.set(id, {
      id,
      name: name || id,
      command: shell,
      workingDir: '/workspace',
      headerBg: validBg,
      headerColor: validColor
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

    const ptyProcess = pty.spawn('tmux', ['-L', TMUX_SOCKET, 'attach-session', '-t', tmuxName], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      env: safeEnv
    });

    return ptyProcess;
  }

  updateSession(id, updates) {
    const session = this._sessions.get(id);
    if (!session) return false;
    if (updates.name !== undefined) {
      if (typeof updates.name !== 'string' || updates.name.length > 100) {
        throw new Error('Terminal name must be a string of 100 characters or fewer');
      }
      session.name = updates.name;
    }
    if (updates.headerBg !== undefined) {
      session.headerBg = isValidColor(updates.headerBg) ? updates.headerBg : null;
    }
    if (updates.headerColor !== undefined) {
      session.headerColor = isValidColor(updates.headerColor) ? updates.headerColor : null;
    }
    return true;
  }

  async destroySession(id) {
    const tmuxName = this._tmuxSessionName(id);
    try {
      await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'kill-session', '-t', tmuxName]);
    } catch {}
    this._sessions.delete(id);
  }

  // --- Health monitoring ---

  startHealthCheck() {
    this._healthInterval = setInterval(() => this._checkHealth(), HEALTH_CHECK_INTERVAL);
  }

  stopHealthCheck() {
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
  }

  async _checkHealth() {
    if (this._sessions.size === 0) return;

    let liveSessions;
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'list-sessions', '-F', '#{session_name}']);
      liveSessions = new Set(stdout.trim().split('\n').filter(Boolean));
    } catch {
      // tmux server itself is gone
      if (this._sessions.size > 0 && !this._serverDownLogged) {
        this._serverDownLogged = true;
        log.error('[tmux] server not responding — all sessions likely dead');
        await this._dumpDiagnostics();
      }
      return;
    }

    // Server is back (or was never down)
    this._serverDownLogged = false;

    for (const [id, session] of this._sessions) {
      const tmuxName = this._tmuxSessionName(id);
      if (!liveSessions.has(tmuxName)) {
        log.error(`[tmux] session vanished: ${session.name} (${id.slice(0, 8)})`);
        await this._dumpDiagnostics();
        this._sessions.delete(id); // Remove so we don't log repeatedly
        this.emit('sessionDied', id, session.name);
      }
    }
  }

  async _dumpDiagnostics() {
    const mem = process.memoryUsage();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    log.error(`[diag] node rss=${Math.round(mem.rss / 1048576)}MB heap=${Math.round(mem.heapUsed / 1048576)}/${Math.round(mem.heapTotal / 1048576)}MB`);
    log.error(`[diag] system mem free=${Math.round(freeMem / 1048576)}MB total=${Math.round(totalMem / 1048576)}MB (${Math.round(freeMem / totalMem * 100)}% free)`);

    // Detailed diagnostics only in debug mode
    if (process.env.DEBUG === '1' || process.env.DEBUG === 'true') {
      // Check for OOM kills in dmesg
      try {
        const { stdout } = await execFileAsync('dmesg', ['-T', '--level=err,crit,alert,emerg'], { timeout: DIAG_TIMEOUT_MS });
        const oomLines = stdout.split('\n').filter(l => /oom|killed process|out of memory/i.test(l)).slice(-5);
        if (oomLines.length) {
          log.error('[diag] recent OOM/kill events:');
          oomLines.forEach(l => log.error(`  ${l.trim()}`));
        }
      } catch {}

      // List surviving tmux sessions on our dedicated socket
      try {
        const { stdout } = await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'list-sessions']);
        log.error(`[diag] surviving tmux sessions (socket=${TMUX_SOCKET}):\n  ${stdout.trim().replace(/\n/g, '\n  ')}`);
      } catch (e) {
        log.error(`[diag] tmux list-sessions failed: ${e.message}`);
      }

      // Check if any tmux processes are alive at all
      try {
        const { stdout } = await execFileAsync('pgrep', ['-a', 'tmux']);
        log.error(`[diag] tmux processes: ${stdout.trim().replace(/\n/g, ', ')}`);
      } catch {
        log.error('[diag] NO tmux processes found (server is completely dead)');
      }
      // Dump tmux lifecycle event hooks log
      try {
        const { stdout } = await execFileAsync('cat', ['/tmp/tmux-events.log'], { timeout: DIAG_TIMEOUT_MS });
        if (stdout.trim()) {
          log.debug(`[diag] tmux lifecycle events:\n${stdout.trim()}`);
        }
      } catch {}

      // Search tmux server verbose log for the session destruction trigger
      try {
        const { stdout: files } = await execFileAsync('bash', ['-c',
          'ls -t /app/tmux-server-*.log /home/*/tmux-server-*.log /tmp/tmux-server-*.log /tmp/tmux-*/tmux-server-*.log 2>/dev/null | head -1'
        ], { timeout: DIAG_TIMEOUT_MS });
        const logFile = files.trim();
        if (logFile) {
          try {
            const { stdout: events } = await execFileAsync('grep', [
              '-B', '50', '-m', '1',
              'session_destroy',
              logFile
            ], { timeout: DIAG_GREP_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
            log.debug(`[diag] tmux: 50 lines before session_destroy:\n${events}`);
          } catch {
            log.debug(`[diag] no session_destroy found in tmux server log`);
          }
        }
      } catch {}
    }
  }

  async listSessions() {
    let activeTmuxSessions;
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'list-sessions', '-F', '#{session_name}']);
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
        headerBg: session.headerBg,
        headerColor: session.headerColor
      });
    }
    return result;
  }
}

module.exports = { SessionManager };
