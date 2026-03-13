# TerminalDeck Build Report — Phases 1-10

**Date:** 2026-02-18
**Status:** All 10 phases complete, 130/130 tests passing (61 backend + 61 frontend + 8 integration)

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

### Phase 8: Hot Reload & Activity Monitoring

**Files created:**
- `server/config-diff.js` — Config diff engine (55 lines)
- `server/config-diff.test.js` — 8 tests
- `server/activity.js` — Terminal activity tracker (50 lines)
- `server/activity.test.js` — 9 tests

**Files modified:**
- `server/config.js` — Debounce increased from 250ms to 500ms; `change` event now also passes old config
- `server/sessions.js` — Added logging to `handleConfigReload()` (logs "Terminal 'X' added/removed" for each change)
- `server/websocket.js` — Integrated ActivityTracker; added `startActivityBroadcasting()`, `stopActivityBroadcasting()`, `_broadcastToAll()` methods; activity recorded on every pty output event
- `server/index.js` — Starts activity broadcasting on server launch; added `configManager.on('error')` listener to prevent uncaught error crashes
- `client/js/app.js` — Enhanced `_handleConfigReload()` to add/remove terminal connections (not just theme/header); added `_handleActivity()` method for server activity broadcasts; wired `_onActivityBroadcast` callback on all connections
- `client/js/terminal.js` — Added `activity` message type handling via new `_onActivityBroadcast` callback hook
- `client/js/layout.js` — Fixed pre-existing timer leak in `_showCellPopover()` where `setTimeout` fired after jsdom teardown (added `typeof document` guard)
- `client/css/style.css` — Changed `.strip-status` default from green to `--td-text-dim` (gray); added `.status-active` class (green glow) and `.status-idle` class (gray); added transitions
- `server/config.test.js` — Added debounce test (rapid file changes result in single reload)
- `client/js/app.test.js` — Added 5 new tests for config reload add/remove/theme/layout and activity handling

**Config diff engine (`config-diff.js`) capabilities:**
- `computeConfigDiff(oldConfig, newConfig)` — Returns a structured diff:
  - `addedTerminals` — Terminal config objects present in new but not old
  - `removedTerminals` — Terminal IDs present in old but not new
  - `modifiedTerminals` — Terminal IDs with same ID but changed properties
  - `layoutsChanged` — Boolean, true if layouts object differs
  - `themeChanged` — Boolean, true if theme settings differ
  - `settingsChanged` — Boolean, true if any settings differ
- Uses a local `deepEqual()` for recursive structural comparison

**Activity tracker (`activity.js`) capabilities:**
- `recordOutput(terminalId)` — Records current timestamp for a terminal
- `isActive(terminalId)` — Returns true if output was received within the last 3 seconds (configurable `ACTIVE_THRESHOLD_MS = 3000`)
- `getStatuses()` — Returns `{ terminalId: boolean }` map of all tracked terminals
- `removeTerminal(terminalId)` — Removes a terminal from tracking
- `startBroadcasting(broadcastFn)` — Starts a 2-second interval (`BROADCAST_INTERVAL_MS = 2000`) that calls `broadcastFn({ type: 'activity', statuses: {...} })`
- `stopBroadcasting()` — Clears the interval

**Frontend hot reload (`app.js` `_handleConfigReload`) capabilities:**
- Detects terminals removed from config, calls `destroy()` on their connections, removes from layout engine strip
- Detects terminals added to config, creates new `TerminalConnection` with full callback wiring, adds to minimized strip
- Preserves ephemeral terminals (only removes non-ephemeral connections that are gone from config)
- Re-applies theme via CSS custom properties
- Rebuilds header layout buttons
- Updates connection status indicator

**Frontend activity handling (`app.js` `_handleActivity`) capabilities:**
- On receiving `{ type: 'activity', statuses: {...} }` message from server:
  - Updates `.strip-status` dot CSS classes: `status-active` (green) or `status-idle` (gray)
  - Triggers `strip-item-active` pulse animation on active minimized terminals

**Key design decisions:**
- **Separate `_onActivityBroadcast` callback:** The server's periodic activity broadcast is handled differently from per-terminal `_onActivity` (which fires on every output chunk). The broadcast provides a consolidated view of all terminals; the per-terminal callback provides instant feedback for the specific terminal producing output.
- **500ms debounce:** Editors like vim write temp files, rename, etc. on save — generating multiple `fs.watch` events. 500ms captures a complete save cycle without feeling laggy to the user.
- **Activity threshold of 3 seconds:** Short enough to be responsive (a terminal appears "idle" quickly after output stops), long enough that brief pauses between lines of output don't cause flickering.

### Phase 9: Docker & Deployment

**Files modified:**
- `Dockerfile` — Rewritten from `node:22-bookworm-slim` base to `debian:bookworm-slim` base (36 lines)
- `docker-compose.yml` — Added version field, workspace volume, restart policy (12 lines)
- `package.json` — Added `test:integration` and `test:all` scripts

**Dockerfile changes:**
- Base image: `debian:bookworm-slim` (previously `node:22-bookworm-slim`)
- Node.js installed via nodesource `setup_20.x` script (Node 20 LTS, previously Node 22 from base image)
- Added system packages: `git`, `curl`, `procps` (previously only `tmux` and `bash`)
- Added `npm install --production` (previously `npm ci --omit=dev`)
- Added `mkdir -p /workspace` for default workspace directory
- Copies `server/`, `client/`, `config/` directories (unchanged)
- Exposes port 3000, starts via `node server/index.js` (unchanged)

**docker-compose.yml changes:**
- Added `version: '3.8'` field
- Changed workspace volume from `.:/workspace` (whole project) to `./workspace:/workspace` (dedicated workspace directory)
- Added `restart: unless-stopped` policy

**package.json script additions:**
- `test:integration` — Runs only `test/**/*.test.js` with 30s timeout
- `test:all` — Runs all test globs (server + client + integration) with 30s timeout

### Phase 10: Integration Testing & Polish

**Files created:**
- `test/integration.test.js` — Full-stack integration tests (337 lines, 8 tests)

**Files modified:**
- `README.md` — Complete rewrite with expanded documentation (283 lines)

**Integration test capabilities:**

Each test spins up a real server instance (random port, temp config file, real tmux sessions) and tears it down afterwards. All tests share helper functions:
- `httpGet(port, path)` — HTTP GET request returning `{ status, headers, body }`
- `connectWS(port, terminalId)` — Opens WebSocket, resolves on `open`
- `waitForMessage(ws, type, timeout)` — Resolves when a message of the given type arrives
- `collectOutput(ws, durationMs)` — Collects all `output` messages for a duration

**Test scenarios:**

1. **Full startup flow** — Server starts → config loads → tmux sessions created for all `autoStart` terminals → HTTP serves the dashboard page → `/api/config` returns correct data → `/api/sessions` returns 2 auto-started sessions

2. **Terminal connectivity** — WebSocket connects to a terminal → sends `echo hello_integration_test\n` → collects output for 2 seconds → verifies output contains "hello_integration_test"

3. **Multi-client** — Two WebSocket clients connect to the same terminal → client A sends `echo multiclient_test_42\n` → client B's collected output contains "multiclient_test_42"

4. **Session persistence** — Connect → set environment variable `PERSIST_VAR=alive_12345` → disconnect WebSocket → wait for cleanup → reconnect → send `echo $PERSIST_VAR\n` → output contains "alive_12345" (proves tmux session survived disconnect)

5. **Ephemeral lifecycle** — Create ephemeral terminal via WebSocket message → receive `sessions` broadcast → verify ephemeral session exists with correct name → verify it appears in `/api/sessions` → destroy it via WebSocket → receive updated `sessions` broadcast → verify it's gone from both broadcast and API

6. **Hot reload — add terminal** — Write new config with additional terminal to file → receive `config_reload` WebSocket message → verify new config has 3 terminals → verify `/api/sessions` shows new session was created

7. **Hot reload — remove terminal** — Write new config with terminal removed → receive `config_reload` message → verify config has 1 terminal → verify `/api/sessions` confirms session was destroyed

8. **Config validation** — Write invalid JSON to config file → wait for debounce → server still running → `/api/config` still returns last valid config with 2 terminals

**Bug fixes during Phase 10:**

1. **Uncaught `error` event on ConfigManager** — When invalid JSON was written to the config file, `ConfigManager` emitted an `error` event. Node's `EventEmitter` throws if `error` is emitted with no listener, crashing the server. Fixed by adding `configManager.on('error', ...)` handler in `index.js` that logs the error message.

2. **WebSocket `sessions` message race condition in tests** — The `waitForMessage` listener was set up *after* sending the `create_ephemeral` message, so the `sessions` response could arrive before the listener was registered. Fixed by setting up the listener *before* sending the message.

3. **Popover timer leak in layout tests** — The `_showCellPopover()` method uses `setTimeout(fn, 0)` to register an outside-click listener. In tests, this timer fired after the jsdom globals were torn down, causing `ReferenceError: document is not defined`. Fixed by guarding with `if (typeof document === 'undefined') return;`.

**Polish checklist results:**

| Item | Status |
|------|--------|
| All tests pass (unit + integration) | 130/130 passing |
| Config hot reload works end-to-end | Verified via integration tests |
| Activity tracker broadcasts statuses | Verified: 2s interval, 3s threshold |
| Activity dots update on strip items | CSS classes wired: `status-active` / `status-idle` |
| Activity pulse animation on minimized terminals | `strip-item-active` class with 0.6s animation |
| Ephemeral terminal create/destroy end-to-end | Verified via integration test |
| Theme changes apply without page reload | CSS custom properties updated dynamically |
| Config reload adds/removes terminal connections | Frontend creates/destroys connections on reload |
| Session persistence across disconnects | Verified: env var survives WS disconnect/reconnect |
| Multi-client terminal sharing | Verified: client A input visible to client B |
| Invalid config doesn't crash server | Server retains last valid config, logs error |
| Debounce prevents duplicate reloads | Verified: rapid writes trigger single `change` event |
| Docker container spec matches requirements | Debian bookworm-slim + Node 20 + tmux/bash/git/curl/procps |

**README updates:**
- Added Hot Reload section explaining the 4-step reload process
- Added Activity Monitoring section
- Added Ephemeral Terminals section
- Added Settings reference table (all theme fields, shell, defaultLayout)
- Added Layouts reference with all 8 presets
- Added Architecture diagram (ASCII box diagram: Browser → Server → tmux)
- Added Troubleshooting section (5 common issues with solutions)
- Added `test:integration` and `test:all` commands to Testing section
- Updated Project Structure with new files (config-diff.js, activity.js, integration.test.js)
- Updated WebSocket Protocol to show correct `activity` message format (statuses object, not per-terminal)
- Updated Current Status to reflect 130/130 tests, all 10 phases complete

---

## Test Summary

| Module | File | Tests | Status |
|--------|------|-------|--------|
| Activity Tracker | `server/activity.test.js` | 9 | Passing |
| Config Diff | `server/config-diff.test.js` | 8 | Passing |
| Config | `server/config.test.js` | 12 | Passing |
| HTTP Server | `server/index.test.js` | 9 | Passing |
| Sessions | `server/sessions.test.js` | 9 | Passing |
| WebSocket | `server/websocket.test.js` | 14 | Passing |
| App | `client/js/app.test.js` | 20 | Passing |
| Layout | `client/js/layout.test.js` | 23 | Passing |
| Terminal | `client/js/terminal.test.js` | 18 | Passing |
| Integration | `test/integration.test.js` | 8 | Passing |
| **Total** | | **130** | **All passing** |

Run with:
- `npm test` — Unit tests only (server + client)
- `npm run test:integration` — Integration tests only
- `npm run test:all` — All tests

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

### Phases 8-10

#### 8. Uncaught EventEmitter `error` event crashing the server
When the config watcher detected invalid JSON, it emitted an `error` event on the `ConfigManager` (an `EventEmitter` subclass). Node.js throws if an `error` event is emitted with no listeners — this crashed the server process. The unit tests didn't catch this because each test adds its own `on('error', ...)` handler. The integration test exposed it by writing invalid JSON to a real watched config file.

**Fix:** Added `configManager.on('error', (err) => console.error(...))` in `index.js` immediately after calling `configManager.watch()`.

#### 9. WebSocket `sessions` message arriving before listener in integration tests
The ephemeral lifecycle integration test sent a `create_ephemeral` message and then called `waitForMessage(ws, 'sessions')`. But the server processed the create and broadcast the `sessions` message before the `waitForMessage` listener was registered — the message arrived during the synchronous gap between `ws.send()` and the listener setup. This caused a 5-second timeout.

**Fix:** Set up the `waitForMessage` listener *before* calling `ws.send()`, ensuring the listener is in place before the response can arrive.

#### 10. jsdom teardown race condition in layout popover
The `_showCellPopover()` method schedules `setTimeout(fn, 0)` to register a click-away listener on `document`. In the test environment, jsdom globals (`document`, `window`) are deleted in `afterEach`. If the test completes before the timeout fires, the callback references `document` which no longer exists, causing `ReferenceError: document is not defined` and a "done() called multiple times" error from Mocha.

**Fix:** Added `if (typeof document === 'undefined') return;` guard at the start of the timeout callback. This is safe because the popover no longer exists after teardown anyway.

---

## Potential Future Problems

### Security
- **Config file is user-editable:** The config file is on a mounted volume. While `sessions.js` uses `execFile` with argument arrays (not shell interpolation), a malicious `command` value in config could still run arbitrary code — which is by design since the purpose is to run commands in terminals.
- **No authentication:** The HTTP and WebSocket servers have no authentication. Anyone with network access to port 3000 gets full terminal access. Critical for Docker deployments that expose ports.
- **No HTTPS/WSS:** All traffic is unencrypted. Terminal I/O (including passwords typed into shells) travels in plaintext.

### Stability
- **`fs.watch` reliability:** `fs.watch` behavior varies across platforms and filesystems (especially in Docker with mounted volumes). It may fire duplicate events, miss events, or behave differently on NFS/CIFS mounts. The 500ms debounce helps but doesn't fully solve this.
- **tmux operations use `execFileAsync`:** All tmux operations use promisified `execFile`, which is non-blocking. However, heavy concurrent session creation/destruction could still cause contention.
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

### Activity Monitoring
- **Activity broadcast interval is not configurable:** The 2-second broadcast and 3-second threshold are hardcoded constants. A busy server with many terminals could generate significant broadcast traffic. Consider making these configurable via settings.
- **Activity tracker grows unbounded:** The `_lastOutput` map never removes terminals unless `removeTerminal()` is explicitly called. Long-running servers with many created/destroyed ephemeral terminals could accumulate stale entries. The memory impact is negligible (just a timestamp per ID), but the broadcast would include inactive entries.
- **Activity status dot CSS classes only apply to strip items:** Grid cell headers don't receive activity status updates. The spec mentions updating status dots "in the terminal's title bar area" for grid terminals, which is not yet implemented.

### Testing
- **Session tests depend on real tmux:** Tests require a running tmux-capable environment (not available in many CI systems). Consider adding a CI-specific test configuration or mocking tmux for unit tests.
- **Graceful shutdown doesn't destroy tmux sessions:** The SIGTERM/SIGINT handler in `index.js` closes WebSocket connections and stops the HTTP server, but does not kill tmux sessions. This is intentional (sessions persist for reconnection), but means orphaned sessions accumulate if the server never restarts with the same config.
- **Ephemeral session ID collision:** Uses `crypto.randomUUID()` for ephemeral IDs, so collision probability is negligible.
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

**System requirements:** Node.js 20+ (LTS), tmux 3.x, bash

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
    |           |           |
    v           v           v
+----------+ +----------------+ +---------------+
| config.js| | websocket.js   | | activity.js   |
+----------+ +----------------+ +---------------+
    |               |               |
    v               |          (2s broadcast)
+---------------+   |               |
| config-diff.js|   |          (records pty output)
+---------------+   |               |
    |          (attaches per client) |
    v               v               v
+-------------------------------------------+
| sessions.js       tmux session lifecycle  |
+-------------------------------------------+
    |
    | execFileAsync / node-pty
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
|  config_reload msg   | management     | + WebSocket   |
|  activity msg        |                |               |
+------------------------------------------------------+
|  vendor/xterm.js  |  vendor/xterm-addon-fit.js       |
+------------------------------------------------------+
```
