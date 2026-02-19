const { execFile } = require('child_process');
const util = require('util');
const { randomUUID } = require('crypto');
const os = require('os');
const pty = require('node-pty');
const log = require('./log');

const execFileAsync = util.promisify(execFile);

const SESSION_PREFIX = 'terminaldeck-';
const TMUX_SOCKET = 'terminaldeck'; // Dedicated socket to isolate from processes inside terminals
const HEALTH_CHECK_INTERVAL = 10000; // 10s

class SessionManager {
  constructor(config) {
    this._config = config;
    this._sessions = new Map(); // id -> { id, name, command, workingDir }
    this._healthInterval = null;
    this._onSessionDied = null; // callback(id, name, diag)
    this._serverDownLogged = false;
    this._serverStarted = false;
  }

  // Start tmux server with verbose logging on our dedicated socket
  async _ensureVerboseServer() {
    if (this._serverStarted) return;
    this._serverStarted = true;
    try {
      await execFileAsync('tmux', ['-L', TMUX_SOCKET, '-vvv', 'start-server']);
      log.log(`[tmux] server started on socket "${TMUX_SOCKET}" with verbose logging`);
    } catch (err) {
      // Server may already be running — not an error
      log.log(`[tmux] start-server: ${err.message}`);
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
    const id = randomUUID();
    const shell = command || this._config.settings.shell || '/bin/bash';
    const tmuxName = this._tmuxSessionName(id);

    log.log(`[tmux] creating session ${tmuxName.slice(-8)} cmd="${shell}"`);
    await this._ensureVerboseServer();
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

    // Verify the session and server survived creation
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'list-sessions', '-F', '#{session_name}']);
      const sessions = stdout.trim().split('\n').filter(Boolean);
      if (!sessions.includes(tmuxName)) {
        log.error(`[tmux] session GONE immediately after creation!`);
      }
    } catch (err) {
      log.error(`[tmux] server DEAD immediately after creating session: ${err.message}`);
    }
    try {
      const { stdout } = await execFileAsync('pgrep', ['-a', 'tmux']);
      log.log(`[tmux] server processes: ${stdout.trim().replace(/\n/g, ', ')}`);
    } catch {}

    // Verify critical tmux options are actually loaded
    try {
      // Session/server options
      for (const opt of ['exit-empty', 'destroy-unattached']) {
        try {
          const { stdout } = await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'show-options', '-g', opt]);
          log.log(`[tmux] option: ${stdout.trim()}`);
        } catch {}
      }
      // Window options (remain-on-exit is a WINDOW option)
      try {
        const { stdout } = await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'show-window-options', '-g', 'remain-on-exit']);
        log.log(`[tmux] window-option(global): ${stdout.trim()}`);
      } catch {}
      // Per-session window option (the explicit set we just did)
      try {
        const { stdout } = await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'show-window-options', '-t', `${tmuxName}:`, 'remain-on-exit']);
        log.log(`[tmux] window-option(${tmuxName.slice(-8)}): ${stdout.trim()}`);
      } catch {}
    } catch {}

    this._sessions.set(id, {
      id,
      name: name || id,
      command: shell,
      workingDir: '/workspace',
      headerBg: headerBg || null,
      headerColor: headerColor || null
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
    if (updates.name !== undefined) session.name = updates.name;
    if (updates.headerBg !== undefined) session.headerBg = updates.headerBg;
    if (updates.headerColor !== undefined) session.headerColor = updates.headerColor;
    return true;
  }

  async destroySession(id) {
    const tmuxName = this._tmuxSessionName(id);
    const stack = new Error().stack;
    log.warn(`[tmux] destroySession called for ${id.slice(0, 8)} — stack:\n${stack}`);
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
        if (this._onSessionDied) this._onSessionDied(id, session.name);
      }
    }
  }

  async _dumpDiagnostics() {
    const mem = process.memoryUsage();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    log.error(`[diag] node rss=${Math.round(mem.rss / 1048576)}MB heap=${Math.round(mem.heapUsed / 1048576)}/${Math.round(mem.heapTotal / 1048576)}MB`);
    log.error(`[diag] system mem free=${Math.round(freeMem / 1048576)}MB total=${Math.round(totalMem / 1048576)}MB (${Math.round(freeMem / totalMem * 100)}% free)`);

    // Check for OOM kills in dmesg
    try {
      const { stdout } = await execFileAsync('dmesg', ['-T', '--level=err,crit,alert,emerg'], { timeout: 2000 });
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

    // Also check default socket for comparison
    try {
      const { stdout } = await execFileAsync('tmux', ['list-sessions']);
      log.error(`[diag] sessions on DEFAULT socket:\n  ${stdout.trim().replace(/\n/g, '\n  ')}`);
    } catch {}

    // Check key tmux options (session/server level)
    for (const opt of ['destroy-unattached', 'exit-unattached', 'exit-empty']) {
      try {
        const { stdout } = await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'show-options', '-g', opt]);
        log.error(`[diag] tmux ${stdout.trim()}`);
      } catch {}
    }
    // Check remain-on-exit at window level (it's a window option, not session)
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'show-window-options', '-g', 'remain-on-exit']);
      log.error(`[diag] tmux window-opt: ${stdout.trim()}`);
    } catch (e) {
      log.error(`[diag] tmux remain-on-exit NOT SET as window option`);
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
      const { stdout } = await execFileAsync('cat', ['/tmp/tmux-events.log'], { timeout: 2000 });
      if (stdout.trim()) {
        log.error(`[diag] tmux lifecycle events:\n${stdout.trim()}`);
      }
    } catch {}

    // Search tmux server verbose log for the session destruction trigger
    // With -L terminaldeck, the log file may be in /tmp/tmux-1000/
    try {
      const { stdout: files } = await execFileAsync('bash', ['-c',
        'ls -t /app/tmux-server-*.log /home/*/tmux-server-*.log /tmp/tmux-server-*.log /tmp/tmux-*/tmux-server-*.log 2>/dev/null | head -1'
      ], { timeout: 2000 });
      const logFile = files.trim();
      if (logFile) {
        // Get 50 lines BEFORE session_destroy to see what triggered it
        try {
          const { stdout: events } = await execFileAsync('grep', [
            '-B', '50', '-m', '1',
            'session_destroy',
            logFile
          ], { timeout: 30000, maxBuffer: 1024 * 1024 });
          log.error(`[diag] tmux: 50 lines before session_destroy:\n${events}`);
        } catch {
          log.error(`[diag] no session_destroy found in tmux server log`);
        }
        // Also check for any kill-session or kill-server commands
        try {
          const { stdout: kills } = await execFileAsync('grep', ['-E',
            'kill-session|kill-server|kill-pane|kill-window',
            logFile
          ], { timeout: 10000 });
          if (kills.trim()) {
            log.error(`[diag] tmux kill commands found:\n${kills.trim()}`);
          }
        } catch {}
        // File size for reference
        try {
          const { stdout: size } = await execFileAsync('wc', ['-c', logFile]);
          log.error(`[diag] tmux server log size: ${size.trim()}`);
        } catch {}
      } else {
        log.error('[diag] no tmux server log file found');
      }
    } catch (e) {
      log.error(`[diag] could not read tmux server log: ${e.message}`);
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
