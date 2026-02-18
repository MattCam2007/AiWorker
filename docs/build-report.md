# TerminalDeck Build Report — Phases 1-7

**Date:** 2026-02-18
**Status:** All 7 phases complete, 99/99 tests passing (43 backend + 56 frontend)

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

### Phase 5: Terminal Rendering

**Files created:**
- `client/js/test-helpers.js` — Shared mock classes for frontend tests (72 lines)
- `client/js/terminal.js` — Terminal connection manager (161 lines, rewritten from placeholder)
- `client/js/terminal.test.js` — 18 tests

**Test helpers (`test-helpers.js`):**
- **MockTerminal** — Stubs for xterm.js Terminal API: `open()`, `write()`, `onData()`, `loadAddon()`, `dispose()`, all backed by sinon stubs. Tracks `_onDataCallbacks` for simulating user input.
- **MockFitAddon** — Stubs for `fit()` and `proposeDimensions()` returning `{cols: 80, rows: 24}`
- **MockWebSocket** — Tracks `url`, `_sent[]` (outgoing messages), exposes `_receive(msg)` for simulating server messages. Auto-opens via `setTimeout`. Implements `addEventListener`/`removeEventListener`, readyState constants.

**TerminalConnection capabilities:**
- IIFE pattern attaching `TerminalConnection` to `window.TerminalDeck` namespace
- `attach(el)` — Creates fresh xterm.js Terminal with theme settings (fontFamily, fontSize, foreground, background), loads FitAddon, opens terminal in element, fits, and connects WebSocket
- `_connectWS()` — Opens WebSocket to `ws[s]://host/ws/terminal/{id}`, sends resize on open, handles `output` (writes to xterm), `sessions`, and `config_reload` message types
- `detach()` — Disposes xterm Terminal, closes WebSocket, clears timers. Sets `_detaching` flag to suppress reconnection
- `refit()` — Calls `fitAddon.fit()` and sends a resize message with new dimensions
- `isActive()` — Returns true when WebSocket is OPEN
- `getLastOutput()` — Returns last ~80 chars of output with ANSI escape codes stripped
- `destroy()` — Sets `_destroyed` flag, calls `detach()`, prevents all future reconnection
- `_scheduleReconnect()` — Exponential backoff: base 1s, doubling up to 30s cap, with ±20% random jitter
- Callback hooks: `_onActivity`, `_onStatusChange`, `_onSessions`, `_onConfigReload` (wired by App)

**Key design decision — re-create on re-attach:** xterm.js `Terminal.open()` can only be called once per instance. So `attach()` always creates a fresh Terminal + FitAddon + WebSocket, and `detach()` disposes everything. Since tmux preserves all state server-side and replays output on reconnect, this is seamless.

### Phase 6: Layout Engine

**Files created:**
- `client/js/layout.js` — Grid layout engine (283 lines, rewritten from placeholder)
- `client/js/layout.test.js` — 23 tests

**LayoutEngine capabilities:**
- IIFE pattern attaching `LayoutEngine` to `window.TerminalDeck` namespace
- **8 grid presets** (format is CxR where C=columns, R=rows): 1x1, 2x1, 1x2, 2x2, 2x3, 3x2, 3x1, 1x3
- `setGrid(spec)` — Sets `grid-template-columns`/`grid-template-rows` using `repeat(N, 1fr)`. Creates N cell divs each with `.cell-header` (hidden initially) and `.cell-terminal` mount point. Detaches current occupants to minimized strip before rebuilding.
- `applyLayout(layoutConfig, connections)` — Calls `setGrid()`, iterates `layoutConfig.cells` (2D array of IDs), assigns terminals to cells in order, puts remainder in strip, then `requestAnimationFrame(() => refitAll())`
- `assignTerminal(cell, terminalId, connection)` — Calls `connection.attach()` on cell's `.cell-terminal` mount, shows cell header with terminal name, removes from strip if present
- **Swap interaction:** Strip item click sets `_swapSource` with highlight. Clicking again deselects. Grid cell click with source detaches occupant to strip, assigns source to cell, refits. Empty cell click with source places the terminal directly.
- **Popover:** Empty cell click without selection shows a popover listing minimized terminals. Clicking a popover item assigns that terminal to the cell. Closes on outside click.
- `enterFullscreen(terminalId, connection)` — Detaches from grid cell, shows `#fullscreen-overlay`, attaches to fullscreen container, refits
- `exitFullscreen()` — Hides overlay, re-attaches to original grid cell, refits
- Escape key listener calls `exitFullscreen()`
- `refitAll()` — Iterates all cells, calls `refit()` on each assigned connection
- `checkMobile()` — Uses `window.matchMedia('(max-width: 767px)')`. Forces 1x1 grid when matched.
- **ResizeObserver** — Observes grid container, calls `refitAll()` on resize (gracefully skipped when unavailable, e.g., in tests)

### Phase 7: Dashboard Chrome & Theming

**Files created/rewritten:**
- `client/js/app.js` — Application orchestrator (290 lines, rewritten from placeholder)
- `client/js/app.test.js` — 15 tests
- `client/css/style.css` — Complete sci-fi theme (521 lines, rewritten from placeholder)
- `client/index.html` — Full HTML structure (37 lines, rewritten from placeholder)

**App capabilities:**
- IIFE pattern attaching `App` to `window.TerminalDeck` namespace. Auto-init on `DOMContentLoaded` (skippable via `ns._noAutoInit` for tests).
- `init()` — Fetches `/api/config`, applies theme, creates TerminalConnections, creates LayoutEngine, builds header, applies default layout, wires ephemeral dialog
- `_applyTheme(theme)` — Sets CSS custom properties on `document.documentElement`: `--td-bg`, `--td-color`, `--td-font-terminal`, `--td-font-size`
- `_buildHeader(config)` — Creates 8 grid preset buttons in `#grid-presets`, creates named layout buttons from config in `#named-layouts`. Buttons get `active` class on click.
- `_wireEphemeralDialog()` — "+" button toggles `#ephemeral-dialog` visibility. Create button sends `{type: "create_ephemeral", name, command}` via any active connection's WebSocket. Cancel button hides dialog.
- `_sendEphemeralDestroy(id)` — Sends `{type: "destroy_ephemeral", id}` via any active WebSocket
- `_handleSessionsUpdate(sessions)` — Creates new TerminalConnections for unknown session IDs (ephemeral), adds them to strip. Destroys connections for sessions that disappeared (ephemeral only).
- `_handleConfigReload(newConfig)` — Re-applies theme, rebuilds header buttons
- `_onActivity(id)` — Updates strip preview text, triggers `strip-item-active` CSS animation (0.6s pulse)
- `_updateStatus()` — Scans all connections: all active = green dot, some active = yellow, none = red

**CSS theme (`style.css`):**
- CSS custom properties: `--td-bg: #0a0a0a`, `--td-color: #33ff33`, `--td-surface: #111111`, `--td-border: #222222`, `--td-cyan: #0abdc6`, `--td-danger: #ff3333`, `--td-text: #cccccc`, `--td-text-dim: #666666`
- Reset and base styles with `box-sizing: border-box`, `100vh` flex column body layout
- Scan-line overlay via `body::after` with `repeating-linear-gradient` at 0.04 opacity, `pointer-events: none`
- Header: 44px fixed height, `#0d0d0d` background, flex row with gap
- Grid cells: 1px border, 4px radius, flex column. Focus-within gets cyan accent border. Cell header: 24px compact bar.
- Minimized strip: 44px bottom bar, horizontal scroll, auto-hides when empty (`:empty` selector)
- Strip items: surface background, status LED dot (radial-gradient), name label, monospace preview (truncated to 150px)
- Activity pulse: `@keyframes` glow on border, 0.6s ease-out
- Fullscreen overlay: fixed, full viewport, z-index 1000. Close button with × character via `::after` pseudo-element.
- Ephemeral dialog: centered overlay, dark surface, cyan-focused inputs
- Status indicator: 10px dot with radial-gradient LED effect and colored box-shadow glow
- Webkit custom scrollbar: 6px thin, dark track, border-colored thumb
- Mobile `@media (max-width: 767px)`: hides preset selector, forces 1x1 grid, strip becomes bottom tab bar with hidden previews
- Fonts: Terminals use Fira Code → Cascadia Code → JetBrains Mono → monospace fallback. UI uses system-ui stack.

**HTML structure (`index.html`):**
- `<head>`: charset, viewport, title, `vendor/xterm.css`, `css/style.css`
- `<header id="header">`: title span, `#grid-presets`, `#named-layouts`, spacer div, "+" button, `#connection-status`
- `<main id="grid-container">`: empty (populated by LayoutEngine)
- `<div id="minimized-strip">`: empty (populated by LayoutEngine)
- `<div id="fullscreen-overlay" class="hidden">`: close button + `.fullscreen-terminal` mount
- `<div id="ephemeral-dialog" class="hidden">`: name input, command input, create/cancel buttons
- Scripts loaded in order: `vendor/xterm.js`, `vendor/xterm-addon-fit.js`, `js/terminal.js`, `js/layout.js`, `js/app.js`

### Vendor Files

**Files downloaded:**
- `client/vendor/xterm.js` — xterm.js v5.3.0 UMD bundle from jsdelivr (283 KB, exposes `window.Terminal`)
- `client/vendor/xterm.css` — xterm.js v5.3.0 stylesheet from jsdelivr (5.4 KB)
- `client/vendor/xterm-addon-fit.js` — xterm-addon-fit v0.8.0 UMD bundle from jsdelivr (1.5 KB, exposes `window.FitAddon.FitAddon`)

---

## Test Summary

| Module | File | Tests | Status |
|--------|------|-------|--------|
| Config | `server/config.test.js` | 11 | Passing |
| Sessions | `server/sessions.test.js` | 9 | Passing |
| WebSocket | `server/websocket.test.js` | 11 | Passing |
| HTTP Server | `server/index.test.js` | 12 | Passing |
| Terminal | `client/js/terminal.test.js` | 18 | Passing |
| Layout | `client/js/layout.test.js` | 23 | Passing |
| App | `client/js/app.test.js` | 15 | Passing |
| **Total** | | **99** | **All passing** |

Run with: `npm test`

---

## Challenges Encountered

### Phases 1-4

#### 1. No Node.js installed
The development machine had no Node.js runtime. Resolved by installing nvm and Node.js v24.13.1 LTS.

#### 2. No tmux installed
tmux was not available and couldn't be installed without sudo. Required manual installation by the user (`sudo apt install tmux`). The session tests are written to gracefully skip if tmux is unavailable.

#### 3. Config watcher error event not firing
The initial `load()` implementation silently fell back to the previous valid config on parse errors, which meant the file watcher's try/catch never caught anything and the `error` event was never emitted. Fixed by splitting into two methods:
- `_loadAndValidate()` — Always throws on errors (used by watcher)
- `load()` — Wraps `_loadAndValidate()` with fallback logic (used by direct callers)

#### 4. Deprecated `url.parse()` warning
Node.js v24 emits a deprecation warning for `url.parse()`. Fixed by switching to the WHATWG `URL` constructor.

### Phases 5-7

#### 5. nvm not on PATH in Claude Code shell
The `npm` command was not found because nvm (Node Version Manager) initializes via shell profile scripts that aren't automatically sourced in non-interactive shells. Every `npm`/`npx` invocation required prefixing with `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"` to load nvm first.

#### 6. jsdom setTimeout infinite recursion in terminal tests
The initial terminal test setup overrode `global.setTimeout` with `window.setTimeout.bind(window)` (jsdom's implementation) to make the IIFE's timers run in the jsdom context. This caused a stack overflow: jsdom's `window.setTimeout` internally calls the global `setTimeout`, which was now jsdom's own implementation, creating infinite recursion.

**Root cause:** MockWebSocket's constructor calls `setTimeout(cb, 0)` to auto-open. With the override, this triggered `window.setTimeout` → `timerInitializationSteps` → `window.setTimeout` → infinite loop.

**Fix:** Removed the `global.setTimeout`/`global.clearTimeout` overrides entirely. Node's native `setTimeout` works fine for both the IIFE's reconnection timers and MockWebSocket's auto-open — there's no need for them to run in jsdom's timer context.

#### 7. DOMContentLoaded auto-init interfering with app tests
The app.js IIFE registers a `DOMContentLoaded` listener that auto-creates an App instance and calls `init()`. In the test environment using jsdom, this listener fired and created a second App instance that:
- Called `fetch('/api/config')` a second time, causing `fetch.calledOnce` to be false
- Called `_buildHeader()` which replaced the DOM buttons with new ones whose click handlers referenced the auto-init's engine, not the test's engine — so `engine.setGrid.calledWith(...)` assertions failed
- Called `_wireEphemeralDialog()` which added a duplicate click handler to the "+" button — clicking it toggled `hidden` twice, ending back at `hidden`

**Fix:** Added an `ns._noAutoInit` flag check to the DOMContentLoaded registration in app.js. The test sets `window.TerminalDeck._noAutoInit = true` before requiring the module, preventing the auto-init from interfering. This flag has no effect in production since it's never set by the HTML page.

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

### Frontend
- **Vendored xterm.js bundles:** The UMD bundles are checked into `client/vendor/` rather than loaded from a CDN. They must be manually updated when upgrading xterm.js versions. The current v5.3.0 + addon-fit v0.8.0 combination is stable but may drift from upstream.
- **No xterm.js WebGL renderer:** The default canvas renderer is used. For dashboards with many simultaneous terminals (6+ visible), the WebGL addon (`xterm-addon-webgl`) would significantly improve rendering performance.
- **ANSI strip regex is basic:** The `stripAnsi()` function in terminal.js uses a simple regex that handles CSI sequences and OSC sequences but may miss less common escape codes (e.g., DCS, APC). This only affects the strip preview text, not terminal rendering.
- **No touch/drag support for swap:** The swap interaction requires click on strip then click on cell. Mobile users may expect drag-and-drop. The current implementation relies on tap-based interaction only.
- **ResizeObserver not available in all environments:** The layout engine gracefully skips ResizeObserver setup when unavailable (e.g., in Node.js test environment), but this means tests don't verify auto-refit on container resize.

### Testing
- **Session tests depend on real tmux:** Tests require a running tmux-capable environment (not available in many CI systems). Consider adding a CI-specific test configuration or mocking tmux for unit tests.
- **No test for graceful shutdown:** The server doesn't have a SIGTERM handler to cleanly shut down tmux sessions on process exit. Orphaned tmux sessions could accumulate.
- **Ephemeral session ID collision:** `Date.now()` for ephemeral IDs could collide if two are created in the same millisecond. Low probability but worth noting.
- **Frontend tests use jsdom, not a real browser:** jsdom doesn't implement CSS Grid layout, ResizeObserver, or WebGL. Tests verify DOM structure and method calls but can't validate visual rendering, actual terminal display, or responsive layout behavior. Manual browser testing is required for visual verification.

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| node-pty | ^1.0.0 | Pseudo-terminal spawning for tmux attachment |
| ws | ^8.18.0 | WebSocket server |
| mocha | ^10.8.0 | Test runner (dev) |
| chai | ^4.5.0 | Assertion library (dev) |
| sinon | ^19.0.0 | Mocking/stubbing (dev) |
| jsdom | ^26.0.0 | DOM simulation for frontend tests (dev) |

| Vendor File | Version | Purpose |
|-------------|---------|---------|
| xterm.js | 5.3.0 | Terminal emulator widget |
| xterm.css | 5.3.0 | Terminal emulator styles |
| xterm-addon-fit | 0.8.0 | Auto-fit terminal to container |

**System requirements:** Node.js 22+, tmux 3.x, bash

---

## Architecture Diagram

```
Browser
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

Browser Frontend
+------------------------------------------------------+
|  index.html                                          |
|  +-----------+  +------------+  +-----------------+  |
|  | app.js    |->| layout.js  |->| terminal.js     |  |
|  | App       |  | LayoutEngine|  | TerminalConnection|
|  +-----------+  +------------+  +-----------------+  |
|       |              |                |               |
|  fetch /api/config   | CSS Grid       | xterm.js      |
|                      | management     | + WebSocket   |
+------------------------------------------------------+
|  vendor/xterm.js  |  vendor/xterm-addon-fit.js       |
+------------------------------------------------------+
```
