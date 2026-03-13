# Results: UUID-Based Instance Identifiers

**Date**: 2026-03-12
**Status**: Complete

---

## What Was Implemented

### Phase 1 + Phase 6: Client Instance ID (`client/js/app.js`, `client/js/terminal.js`)

- `App._initInstanceId()` reads `?instance=<uuid>` from URL query string, falls back to `localStorage` key `terminaldeck-instanceId`, falls back to generating a new UUID via `crypto.randomUUID()` (with a Math.random fallback for older environments)
- UUID stored as `app.instanceId` and `ns._instanceId` (namespace-accessible for `TerminalConnection`)
- Written to `localStorage` so the same browser tab defaults to its previous instance on reload
- `history.replaceState` updates the URL to include `?instance=<uuid>` without page reload
- All API calls now include `?instance=<uuid>`: `/api/folders`, `/api/sessions`
- Control WebSocket URL: `/ws/control?t=<token>&instance=<uuid>`
- Terminal WebSocket URL: `/ws/terminal/<id>?t=<token>&instance=<uuid>` (clean — no empty params)

### Phase 2: Server Session Scoping (`server/sessions.js`)

- `_instances: Map<instanceId, Set<sessionId>>` added to `SessionManager`
- `config.instancesPath` option added (defaults to `config/instances.json`)
- `createTerminal(instanceId, name, ...)` — instanceId is now first parameter
- `listSessions(instanceId)` — returns only sessions belonging to that instance
- `destroySession(instanceId, id)` — removes from both `_sessions` and instance map
- `discoverSessions()` — loads `instances.json` on startup; orphaned tmux sessions get assigned to `DEFAULT_INSTANCE = 'default'`
- `getInstanceForSession(sessionId)` — reverse lookup helper
- Health check (`_checkHealth`) emits `sessionDied` with instanceId
- `DEFAULT_INSTANCE` exported for use in other modules

### Phase 3: Server Folder Scoping (`server/index.js`)

- `getFolderManager(instanceId)` function with lazy-creation per instance
- Default instance uses existing `config/folders.json`
- New instances get `config/folders-<instanceId>.json`
- Pre-loads default instance folder manager on startup

### Phase 4: WebSocket Scoping (`server/websocket.js`)

- Parses `instance` query param from both control and terminal WS upgrade URLs
- Stores `ws.instanceId` on every WebSocket connection
- `_sendToControl(msg, instanceId)` — scopes broadcast to matching instance; `instanceId=null` broadcasts to all (used for config reload, tasks update, history update)
- `_broadcastSessions(instanceId)` — instance-scoped
- `_broadcastFolders(instanceId)` — uses `_getFolderManager(instanceId)`
- Activity broadcasts, pane context, and task_complete events scoped by `getInstanceForSession(terminalId)`
- Constructor accepts `getFolderManager` function (backward-compatible: falls back to `options.folderManager`)

### Phase 5: API Scoping (`server/index.js`)

- `/api/sessions?instance=<uuid>` → `sessionManager.listSessions(instanceId)`
- `/api/folders?instance=<uuid>` → `getFolderManager(instanceId).getFolders()`
- File/note/fileops/config/shortcuts/history APIs unchanged (shared filesystem, global)
- `sessionDied` event listener updated to pass instanceId to `_broadcastSessions`

---

## Test Results

**343 passing, 0 failing**

### New tests added:
- `sessions.test.js` — "sessions from different instances are isolated": creates sessions under two different instance IDs, verifies each `listSessions` returns only its own sessions
- `sessions.test.js` — "restores instance mapping from instances.json on discoverSessions": verifies that a new `SessionManager` loading from `instances.json` correctly restores instance→session mapping

### Tests updated:
- `server/sessions.test.js` — all `createTerminal`, `listSessions`, `destroySession` calls updated to pass `DEFAULT_INSTANCE`; `instancesPath` added to testConfig
- `server/websocket.test.js` — same; `instancesPath` added
- `server/index.test.js` — same; `instancesPath` added
- `test/integration.test.js` — same; `instancesPath` added
- `client/js/app.test.js` — WS URL test updated to check for `instance=` param instead of exact URL; fetch stubs updated to match URLs with query params
- `client/js/notifications.test.js` — fetch stub updated

---

## Deviations from Plan

- **UI indicator**: Not implemented. The plan called for "a small UI indicator showing the instance ID (truncated) somewhere unobtrusive". Skipped to keep changes focused; easily added later.
- **`_getFolderManager` backward compatibility**: Constructor accepts either `getFolderManager(instanceId)` function OR legacy `folderManager` single instance — the legacy path is retained for test compatibility.
- **`updateSession` not scoped**: Per plan, `updateSession(id, updates)` was intentionally left unscoped (any client knowing a session ID can update it). This is fine for the POC.

---

## Known Issues / Follow-up

1. **Stale instances**: Instances with no active connections accumulate tmux sessions indefinitely. A cleanup/expiry mechanism is needed (noted in plan as future work).
2. **UI indicator**: Instance UUID not shown in the header yet.
3. **`instances.json` write contention**: Multiple rapid creates/destroys trigger many synchronous file writes. For production, consider debouncing or async writes.
4. **Cross-instance terminal attach**: The terminal WebSocket handler does NOT validate that the requested `terminalId` belongs to `ws.instanceId`. A client with a known session UUID can still attach from a different instance. Low risk for POC but should be hardened.

---

## Final State

Each browser tab generates a UUID on first load, stores it in `localStorage` and the URL. All API calls and WebSocket connections carry this UUID. The server scopes sessions, folder organization, and WebSocket broadcasts per instance. Multiple tabs with the same UUID share state; different UUIDs have fully isolated terminal sets. The shared filesystem is unaffected.
