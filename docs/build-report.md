# TerminalDeck Build Report — Foundation (Phases 1-4)

**Date:** 2026-02-18
**Status:** All 4 phases complete, 36/36 tests passing

---

## What Was Built

### Phase 1: Project Scaffold & Configuration

**Files created:**
- `package.json` — Project manifest with dependencies (node-pty, ws, mocha, chai, sinon)
- `config/terminaldeck.json` — Default config with 4 terminals and 3 layouts
- `server/config.js` — Configuration manager (136 lines)
- `server/config.test.js` — 11 tests
- `test/setup.js` — Test harness setup
- Client placeholders: `client/index.html`, `client/css/style.css`, `client/js/app.js`, `client/js/terminal.js`, `client/js/layout.js`

**ConfigManager capabilities:**
- Reads and parses `terminaldeck.json` from a configurable path
- Validates required sections (`settings`, `terminals`, `layouts`)
- Validates terminal IDs are unique
- Validates layout cell references match existing terminal IDs
- Applies sensible defaults for missing optional fields (shell, theme, autoStart, workingDir)
- Watches the config file for changes using `fs.watch` with 50ms debounce
- Extends `EventEmitter` — emits `change` on valid updates, `error` on invalid ones
- On malformed JSON, retains last valid config instead of crashing

### Phase 2: Session Manager (tmux + node-pty)

**Files created:**
- `server/sessions.js` — Session manager (134 lines)
- `server/sessions.test.js` — 9 tests

**SessionManager capabilities:**
- `createSession(terminalConfig)` — Creates a named tmux session (`terminaldeck-{id}`), reuses existing sessions
- `attachSession(id)` — Returns a node-pty process attached to the tmux session via `tmux attach-session`
- `destroySession(id)` — Kills the tmux session and removes it from internal tracking
- `listSessions()` — Returns all tracked sessions with id, name, active status, and ephemeral flag
- `startAll()` — Creates sessions for all terminals with `autoStart: true`
- `createEphemeral(name, command?)` — Creates an ad-hoc session with auto-generated ID (`ephemeral-{timestamp}`)
- `handleConfigReload(newConfig)` — Diffs old vs new config, creates new sessions, destroys removed ones, preserves ephemeral sessions

### Phase 3: WebSocket Server

**Files created:**
- `server/websocket.js` — WebSocket terminal bridge (139 lines)
- `server/websocket.test.js` — 8 tests

**TerminalWSServer capabilities:**
- Handles HTTP upgrade on `/ws/terminal/{id}` paths using `noServer` mode
- On connection: attaches to the tmux session via node-pty, bridges I/O bidirectionally
- JSON message protocol:
  - Client sends: `input`, `resize`, `create_ephemeral`, `destroy_ephemeral`
  - Server sends: `output`, `sessions`, `config_reload`, `activity`
- Supports multiple simultaneous clients on the same terminal (each gets their own pty attachment to the same tmux session)
- On disconnect: kills the pty attachment but preserves the tmux session
- Broadcasts session list updates after ephemeral create/destroy
- Exposes `broadcastConfigReload(config)` for use by the HTTP server

### Phase 4: HTTP Server & Static File Serving

**Files created:**
- `server/index.js` — HTTP server and application entry point (122 lines)
- `server/index.test.js` — 8 tests
- `Dockerfile` — Debian-slim container with Node.js 22, tmux
- `docker-compose.yml` — Service definition with volume mounts

**HTTP server capabilities:**
- Plain `http` module (no Express)
- Serves static files from `client/` with correct MIME types for html, css, js, json, images, fonts
- Directory traversal protection (path normalization + prefix check)
- `GET /api/config` — Returns current config as JSON
- `GET /api/sessions` — Returns active session list as JSON
- HTTP upgrade delegation to WebSocket server
- Config hot-reload: watches file, triggers session manager reload, broadcasts to WebSocket clients
- Configurable port via `TERMINALDECK_PORT` env var (default 3000)
- `createApp(options)` factory function for testability (accepts port:0 for random port in tests)

---

## Test Summary

| Module | File | Tests | Status |
|--------|------|-------|--------|
| Config | `server/config.test.js` | 11 | Passing |
| Sessions | `server/sessions.test.js` | 9 | Passing |
| WebSocket | `server/websocket.test.js` | 8 | Passing |
| HTTP Server | `server/index.test.js` | 8 | Passing |
| **Total** | | **36** | **All passing** |

Run with: `npm test`

---

## Challenges Encountered

### 1. No Node.js installed
The development machine had no Node.js runtime. Resolved by installing nvm and Node.js v24.13.1 LTS.

### 2. No tmux installed
tmux was not available and couldn't be installed without sudo. Required manual installation by the user (`sudo apt install tmux`). The session tests are written to gracefully skip if tmux is unavailable.

### 3. Config watcher error event not firing
The initial `load()` implementation silently fell back to the previous valid config on parse errors, which meant the file watcher's try/catch never caught anything and the `error` event was never emitted. Fixed by splitting into two methods:
- `_loadAndValidate()` — Always throws on errors (used by watcher)
- `load()` — Wraps `_loadAndValidate()` with fallback logic (used by direct callers)

### 4. Deprecated `url.parse()` warning
Node.js v24 emits a deprecation warning for `url.parse()`. Fixed by switching to the WHATWG `URL` constructor.

---

## Potential Future Problems

### Security
- **Command injection in session creation:** The `execSync()` calls in `sessions.js` interpolate terminal IDs and commands directly into shell strings. If config is user-editable (it's a mounted volume), a malicious `id` or `command` value could inject shell commands. Consider using `execFile` or an argument-array form instead.
- **No authentication:** The HTTP and WebSocket servers have no authentication. Anyone with network access to port 3000 gets full terminal access. Critical for Docker deployments that expose ports.
- **No HTTPS/WSS:** All traffic is unencrypted. Terminal I/O (including passwords typed into shells) travels in plaintext.

### Stability
- **`fs.watch` reliability:** `fs.watch` behavior varies across platforms and filesystems (especially in Docker with mounted volumes). It may fire duplicate events, miss events, or behave differently on NFS/CIFS mounts. The 50ms debounce helps but doesn't fully solve this.
- **Synchronous `execSync` in sessions:** All tmux operations use `execSync`, which blocks the Node.js event loop. Under heavy load with many session operations, this could cause latency spikes. Consider switching to async `exec` or `child_process.spawn`.
- **node-pty per WebSocket client:** Each WebSocket connection spawns a new pty process attached to the same tmux session. With many simultaneous clients, this could exhaust file descriptors or process limits. Consider sharing a single pty per terminal and multiplexing output to multiple WebSocket clients.

### Docker
- **Dockerfile uses nodesource setup script:** The `curl | bash` pattern for installing Node.js is fragile and could break if the script URL changes or the signing key rotates.
- **tmux sessions inside Docker:** tmux sessions persist within the container's lifetime but are lost on container recreation. The `docker-compose.yml` does not persist tmux state. Consider documenting that sessions survive container restarts but not recreations.
- **Default config references `/workspace`:** The config's `workingDir` paths point to `/workspace/project` which must exist in the container. The docker-compose mounts a named volume at `/workspace` but doesn't pre-populate it.

### Frontend (upcoming phases)
- **No xterm.js vendor bundle yet:** The `client/vendor/` directory is empty. Frontend phases will need to fetch xterm.js UMD bundles.
- **No CSS or layout engine:** The client files are placeholders. The grid layout engine, theme system, and terminal widget integration are all pending.

### Testing
- **Session tests depend on real tmux:** Tests require a running tmux-capable environment (not available in many CI systems). Consider adding a CI-specific test configuration or mocking tmux for unit tests.
- **No test for graceful shutdown:** The server doesn't have a SIGTERM handler to cleanly shut down tmux sessions on process exit. Orphaned tmux sessions could accumulate.
- **Ephemeral session ID collision:** `Date.now()` for ephemeral IDs could collide if two are created in the same millisecond. Low probability but worth noting.

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| node-pty | ^1.0.0 | Pseudo-terminal spawning for tmux attachment |
| ws | ^8.18.0 | WebSocket server |
| mocha | ^10.8.0 | Test runner (dev) |
| chai | ^4.5.0 | Assertion library (dev) |
| sinon | ^19.0.0 | Mocking/stubbing (dev) |

**System requirements:** Node.js 22+, tmux 3.x, bash

---

## Architecture Diagram

```
Browser (future)
    |
    | HTTP (static files, API)
    | WebSocket (/ws/terminal/{id})
    v
+-------------------+
| server/index.js   |  HTTP server, static files, API routes
+-------------------+
    |           |
    v           v
+----------+ +----------------+
| config.js| | websocket.js   |  WebSocket upgrade handler
+----------+ +----------------+
    |               |
    |          (attaches per client)
    v               v
+-------------------+
| sessions.js       |  tmux session lifecycle
+-------------------+
    |
    | execSync / node-pty
    v
+-------------------+
| tmux              |  Persistent terminal sessions
+-------------------+
    |
    v
  bash / commands
```
