const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
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
  return val === null || val === 'inherit' || /^#[0-9a-fA-F]{6}$/.test(val);
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
    this._sessionPrefix = config.sessionPrefix || SESSION_PREFIX;
    this._tmuxSocket = config.tmuxSocket || TMUX_SOCKET;
    this._sessions = new Map(); // id -> { id, name, command, workingDir, shellPid, createdAt }
    this._healthInterval = null;
    this._lastHealthSnapshot = null;
    this._serverDownLogged = false;
    this._serverStarted = false;
  }

  // Start tmux server on our dedicated socket (verbose logging when DEBUG=1)
  async _ensureServer() {
    if (this._serverStarted) return;
    this._serverStarted = true;
    try {
      const args = ['-L', this._tmuxSocket];
      if (process.env.DEBUG === '1' || process.env.DEBUG === 'true') args.push('-vvv');
      args.push('start-server');
      await execFileAsync('tmux', args);
      log.debug(`[tmux] server started on socket "${this._tmuxSocket}"`);
    } catch (err) {
      // Server may already be running — not an error
      log.debug(`[tmux] start-server: ${err.message}`);
    }

    // Install pane-died hook for real-time death recording
    try {
      const hookCmd = 'run-shell "echo \\"$(date +%Y-%m-%dT%H:%M:%S) session=#{session_name} pane_pid=#{pane_pid} exit=#{pane_dead_status}\\" >> /tmp/terminaldeck-deaths.log"';
      await execFileAsync('tmux', ['-L', this._tmuxSocket, 'set-hook', '-g', 'pane-died', hookCmd]);
      log.debug('[tmux] installed pane-died hook');
    } catch (err) {
      log.debug(`[tmux] failed to install pane-died hook: ${err.message}`);
    }
  }

  _tmuxSessionName(id) {
    return `${this._sessionPrefix}${id}`;
  }

  async _tmuxSessionExists(id) {
    try {
      await execFileAsync('tmux', ['-L', this._tmuxSocket, 'has-session', '-t', this._tmuxSessionName(id)]);
      return true;
    } catch {
      return false;
    }
  }

  // Public wrappers for cross-module access
  async tmuxSessionExists(id) { return this._tmuxSessionExists(id); }
  async dumpDiagnostics(context) { return this._dumpDiagnostics(context); }

  getSessionMeta(id) {
    const s = this._sessions.get(id);
    if (!s) return null;
    return { name: s.name, shellPid: s.shellPid || null, createdAt: s.createdAt || null };
  }

  async discoverSessions() {
    let tmuxSessions;
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', this._tmuxSocket, 'list-sessions', '-F', '#{session_name}']);
      tmuxSessions = stdout.trim().split('\n').filter(Boolean);
    } catch {
      tmuxSessions = [];
    }

    for (const name of tmuxSessions) {
      if (!name.startsWith(this._sessionPrefix)) continue;
      const id = name.slice(this._sessionPrefix.length);
      if (!this._sessions.has(id)) {
        let shellPid = null;
        try {
          const { stdout: pidOut } = await execFileAsync('tmux', ['-L', this._tmuxSocket, 'list-panes', '-t', name, '-F', '#{pane_pid}']);
          shellPid = parseInt(pidOut.trim(), 10) || null;
        } catch {}
        this._sessions.set(id, {
          id,
          name: id,
          command: this._config.settings.shell || '/bin/bash',
          workingDir: '/workspace',
          headerBg: null,
          headerColor: null,
          shellPid,
          createdAt: Date.now()
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
    await execFileAsync('tmux', ['-L', this._tmuxSocket, 'new-session', '-d', '-s', tmuxName, '-c', '/workspace', sessionCmd]);

    // Explicitly set remain-on-exit as a WINDOW option on this session's window.
    // The global setw -g in tmux.conf may not propagate correctly in all cases.
    try {
      await execFileAsync('tmux', ['-L', this._tmuxSocket, 'set-window-option', '-t', `${tmuxName}:`, 'remain-on-exit', 'on']);
    } catch (err) {
      log.error(`[tmux] failed to set remain-on-exit on ${tmuxName.slice(-8)}: ${err.message}`);
    }

    // Capture shell PID from the pane
    let shellPid = null;
    try {
      const { stdout: pidOut } = await execFileAsync('tmux', ['-L', this._tmuxSocket, 'list-panes', '-t', tmuxName, '-F', '#{pane_pid}']);
      shellPid = parseInt(pidOut.trim(), 10) || null;
      log.log(`[tmux] session ${tmuxName.slice(-8)} shell pid=${shellPid}`);
    } catch (err) {
      log.debug(`[tmux] failed to get pane pid for ${tmuxName.slice(-8)}: ${err.message}`);
    }

    // Verify the session survived creation
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', this._tmuxSocket, 'list-sessions', '-F', '#{session_name}']);
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
      headerColor: validColor,
      shellPid,
      createdAt: Date.now()
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

    const ptyProcess = pty.spawn('tmux', ['-L', this._tmuxSocket, 'attach-session', '-t', tmuxName], {
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
      await execFileAsync('tmux', ['-L', this._tmuxSocket, 'kill-session', '-t', tmuxName]);
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

    // Capture resource snapshot each cycle (used by _dumpDiagnostics for pre-death state)
    this._lastHealthSnapshot = {
      ts: Date.now(),
      freeMem: os.freemem(),
      totalMem: os.totalmem(),
      nodeRSS: process.memoryUsage().rss
    };

    let liveSessions;
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', this._tmuxSocket, 'list-sessions', '-F', '#{session_name}']);
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
        const uptime = session.createdAt ? Math.round((Date.now() - session.createdAt) / 1000) : '?';
        log.error(`[tmux] session vanished: ${session.name} (${id.slice(0, 8)}) uptime=${uptime}s pid=${session.shellPid || '?'}`);
        await this._dumpDiagnostics({ sessionId: id, sessionName: session.name, shellPid: session.shellPid, reason: 'health-check-vanished' });
        this._sessions.delete(id); // Remove so we don't log repeatedly
        this.emit('sessionDied', id, session.name);
      }
    }
  }

  async _dumpPaneDeathInfo(sessionId) {
    const tmuxName = this._tmuxSessionName(sessionId);
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', this._tmuxSocket, 'list-panes', '-t', tmuxName, '-F', '#{pane_dead} #{pane_dead_status} #{pane_pid}'], { timeout: DIAG_TIMEOUT_MS });
      for (const line of stdout.trim().split('\n').filter(Boolean)) {
        const [dead, statusStr, pid] = line.split(' ');
        if (dead === '1') {
          const exitStatus = parseInt(statusStr, 10);
          let interpretation = `exit ${exitStatus}`;
          if (exitStatus > 128) {
            const sig = exitStatus - 128;
            interpretation = `killed by signal ${sig}`;
            if (sig === 9) interpretation += ' (SIGKILL — likely OOM)';
            else if (sig === 15) interpretation += ' (SIGTERM)';
            else if (sig === 6) interpretation += ' (SIGABRT)';
          }
          log.error(`[diag] pane death: pid=${pid} ${interpretation}`);
        } else {
          log.error(`[diag] pane alive: pid=${pid} status=${statusStr}`);
        }
      }
    } catch {
      log.debug(`[diag] could not query pane death info for ${sessionId.slice(0, 8)} (session may be fully gone)`);
    }
  }

  _dumpShellProcInfo(pid) {
    if (!pid) return;
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const vmPeak = status.match(/VmPeak:\s+(\d+\s+\w+)/);
      const vmRSS = status.match(/VmRSS:\s+(\d+\s+\w+)/);
      log.error(`[diag] shell pid=${pid} VmPeak=${vmPeak ? vmPeak[1] : '?'} VmRSS=${vmRSS ? vmRSS[1] : '?'}`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        log.error(`[diag] shell pid=${pid} /proc entry gone (process already reaped by kernel)`);
      } else {
        log.debug(`[diag] failed to read /proc/${pid}/status: ${err.message}`);
      }
    }
  }

  async _dumpDiagnostics(context) {
    if (context) {
      log.error(`[diag] --- death diagnostics for ${context.sessionName || '?'} (reason: ${context.reason || 'unknown'}) ---`);
    }

    const mem = process.memoryUsage();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    log.error(`[diag] node rss=${Math.round(mem.rss / 1048576)}MB heap=${Math.round(mem.heapUsed / 1048576)}/${Math.round(mem.heapTotal / 1048576)}MB`);
    log.error(`[diag] system mem free=${Math.round(freeMem / 1048576)}MB total=${Math.round(totalMem / 1048576)}MB (${Math.round(freeMem / totalMem * 100)}% free)`);

    // Log pre-death health snapshot (more accurate than post-death readings)
    if (this._lastHealthSnapshot) {
      const snap = this._lastHealthSnapshot;
      const age = Math.round((Date.now() - snap.ts) / 1000);
      log.error(`[diag] pre-death snapshot (${age}s ago): free=${Math.round(snap.freeMem / 1048576)}MB nodeRSS=${Math.round(snap.nodeRSS / 1048576)}MB`);
    }

    // Session-specific diagnostics
    if (context) {
      if (context.sessionId) {
        await this._dumpPaneDeathInfo(context.sessionId);
      }
      if (context.shellPid) {
        this._dumpShellProcInfo(context.shellPid);
      }
    }

    // OOM check — always run (highest-value diagnostic)
    try {
      const { stdout } = await execFileAsync('dmesg', ['-T', '--level=err,crit,alert,emerg'], { timeout: DIAG_TIMEOUT_MS });
      const oomLines = stdout.split('\n').filter(l => /oom|killed process|out of memory/i.test(l)).slice(-5);
      if (oomLines.length) {
        log.error('[diag] recent OOM/kill events:');
        oomLines.forEach(l => log.error(`  ${l.trim()}`));
      }
    } catch {}

    // Surviving tmux sessions — always run
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', this._tmuxSocket, 'list-sessions']);
      log.error(`[diag] surviving tmux sessions (socket=${this._tmuxSocket}):\n  ${stdout.trim().replace(/\n/g, '\n  ')}`);
    } catch (e) {
      log.error(`[diag] tmux list-sessions failed: ${e.message}`);
    }

    // Recent pane-died hook entries
    try {
      const { stdout } = await execFileAsync('tail', ['-5', '/tmp/terminaldeck-deaths.log'], { timeout: DIAG_TIMEOUT_MS });
      if (stdout.trim()) {
        log.error(`[diag] recent pane deaths:\n  ${stdout.trim().replace(/\n/g, '\n  ')}`);
      }
    } catch {}

    // Detailed diagnostics only in debug mode
    if (process.env.DEBUG === '1' || process.env.DEBUG === 'true') {
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

  async getForegroundCommands() {
    // Single tmux call returns all panes across all sessions on this socket.
    // Output format: "<session_name> <pane_current_command>" per line.
    const { stdout } = await execFileAsync('tmux', [
      '-L', this._tmuxSocket,
      'list-panes', '-a',
      '-F', '#{session_name} #{pane_current_command}'
    ]);

    const result = {};
    for (const line of stdout.trim().split('\n')) {
      if (!line) continue;
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) continue;
      const sessionName = line.slice(0, spaceIdx);
      const cmd = line.slice(spaceIdx + 1).trim();
      // Reverse-map session name to terminal id
      for (const [id, session] of this._sessions) {
        if (session.name === sessionName || this._tmuxSessionName(id) === sessionName) {
          result[id] = cmd;
          break;
        }
      }
    }
    return result;
  }

  async listSessions() {
    let activeTmuxSessions;
    try {
      const { stdout } = await execFileAsync('tmux', ['-L', this._tmuxSocket, 'list-sessions', '-F', '#{session_name}']);
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
