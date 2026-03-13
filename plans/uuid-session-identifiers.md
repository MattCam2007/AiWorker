# Plan: UUID-Based Instance Identifiers for Multi-User/Multi-Session

**Goal**: Introduce a per-browser-instance UUID ("instance ID") passed via query string that scopes terminal sessions and folder organization per instance — so multiple users or browser tabs each get their own set of terminals and layout. The underlying filesystem is **shared** — all instances see the same `/home/terminaldeck/home`, files, and config.

**Status**: Draft
**Date**: 2026-03-12

---

## Current State

- Sessions already use UUIDs internally (`crypto.randomUUID()` in `sessions.js`)
- **No instance/user scoping** — all clients share the same sessions, folders, and config
- Single `serverToken` authenticates all clients identically
- `folders.json` is a single global file; `_sessions` is a single in-memory Map
- Control WebSocket broadcasts to **all** connected clients
- Terminal WebSocket allows any client to attach to any session by UUID

## Concept: Instance ID via Query String

For the POC, the browser URL determines the instance:

```
https://host/?instance=<uuid>
```

- If no `?instance=` is present, generate a new UUID and redirect/update the URL
- The instance UUID scopes **terminal sessions and folder layout** — which terminals you see, which folders organize them
- The **filesystem is shared** — all instances operate on the same `/home/terminaldeck/home`, same files, same workspace. This is intentional and by design
- Multiple tabs with the **same** instance UUID share state (same user, same view)
- Different instance UUIDs have separate terminals and folder organization, but share the filesystem

---

## Development Principles

### Test-Driven Development (TDD)

Every phase follows red-green-refactor:

1. **Write failing tests first** — before any implementation code, write tests that describe the expected behavior
2. **Make them pass** — write the minimum code to pass
3. **Refactor** — clean up while keeping tests green

Test locations follow existing conventions:
- Server tests: alongside source files or in a `__tests__` directory (match existing project pattern)
- Client tests: `client/js/*.test.js` (already exists — e.g., `app.test.js`, `layout.test.js`)

**Per-phase test expectations:**
- **Phase 1 (Client instance ID)**: Test UUID generation, query string parsing, `localStorage` read/write, `history.replaceState` call, instance ID passed to fetch/WS calls
- **Phase 2 (Server session scoping)**: Test instance-keyed Maps — create/list/get/destroy scoped to instance, cross-instance isolation, `instances.json` persistence and reload
- **Phase 3 (Folder scoping)**: Test per-instance folder file creation, isolation between instances, default template from existing `folders.json`
- **Phase 4 (WebSocket scoping)**: Test broadcast only reaches matching instance, terminal attach rejected for wrong instance
- **Phase 5 (API scoping)**: Test `/api/sessions` and `/api/folders` return instance-scoped data, shared endpoints remain unscoped

### Documentation

- Update any existing docs that describe session management or architecture
- Update `CLAUDE.md` / memory if instance scoping changes how the project should be worked on
- Each phase should include inline code comments only where the logic isn't self-evident

### Completion Report

After all phases are implemented, write a completion document (`plans/uuid-session-identifiers-results.md`) containing:
- What was implemented per phase
- Test results (pass/fail counts, any notable findings)
- Any deviations from this plan and why
- Known issues or follow-up work identified during implementation
- Summary of the final state

---

## Implementation Plan

### Phase 1: Client — Instance ID Lifecycle

**File: `client/js/app.js`**

1. On app init (before any fetch/WebSocket), read `instance` from `URLSearchParams`
2. If missing, generate a UUID via `crypto.randomUUID()` and `history.replaceState` to add `?instance=<uuid>` to the URL (no page reload)
3. Store as `app.instanceId`
4. Pass `instanceId` in all API calls and WebSocket connections:
   - HTTP: `Authorization` header or query param `?instance=<uuid>` on every `/api/*` call
   - Control WS: `/ws/control?t=<token>&instance=<uuid>`
   - Terminal WS: `/ws/terminal/<id>?t=<token>&instance=<uuid>`

**Estimated changes**: ~15 lines in `app.js` init, ~5 lines per fetch/WS call (or a helper)

### Phase 2: Server — Instance-Scoped Session Manager

**File: `server/sessions.js`**

Currently `SessionManager` holds one flat `_sessions` Map. Change to instance-scoped:

1. Add `_instances: Map<instanceId, Map<sessionId, sessionData>>` — a Map of Maps
2. `createTerminal(instanceId, opts)` → stores session under the instance's sub-map
3. `listSessions(instanceId)` → returns only that instance's sessions
4. `getSession(instanceId, sessionId)` → scoped lookup
5. `destroySession(instanceId, sessionId)` → only if owned by that instance
6. `discoverSessions()` → on startup, tmux sessions are named `terminaldeck-<sessionId>`. Need a way to map back to instances. Options:
   - **Option A (recommended for POC)**: Store instance→session mapping in a JSON file (`config/instances.json`)
   - **Option B**: Encode instance ID in tmux session name: `terminaldeck-<instanceId>-<sessionId>` (but tmux names have length limits)
   - **Option C**: Use tmux environment variables to tag sessions with instance ID

**Recommendation**: Option A — simplest, no tmux naming gymnastics. Write a small `instances.json`:
```json
{
  "<instanceId>": {
    "sessions": ["<sessionId1>", "<sessionId2>"],
    "createdAt": "2026-03-12T..."
  }
}
```

On `discoverSessions()`, cross-reference live tmux sessions against `instances.json` to rebuild the in-memory `_instances` Map.

**Estimated changes**: ~60 lines refactoring SessionManager, ~30 lines for instances.json persistence

### Phase 3: Server — Instance-Scoped Folders

**File: `server/folders.js`**

Currently reads/writes a single `config/folders.json`.

1. Change to per-instance folder files: `config/folders-<instanceId>.json`
2. `FolderManager` takes `instanceId` in constructor or as a parameter on each method
3. **Option A (simpler)**: One `FolderManager` instance per active instance ID, lazy-loaded
4. **Option B**: Single `FolderManager` with instance-keyed internal maps

**Recommendation**: Option A — create `FolderManager` on first connection for that instance, cache in a `Map<instanceId, FolderManager>`. Garbage-collect when no connections remain for an instance after a timeout.

**Estimated changes**: ~20 lines in `folders.js`, ~15 lines in `index.js`/`websocket.js` to route to correct FolderManager

### Phase 4: Server — Instance-Scoped WebSocket Routing

**File: `server/websocket.js`**

1. Parse `instance` from query string on both control and terminal WebSocket upgrade
2. Store `instanceId` on each WebSocket connection object: `ws.instanceId = instanceId`
3. **Control channel broadcasts**: Only broadcast to clients with matching `instanceId`
   - Currently: `this._controlClients.forEach(ws => ws.send(...))`
   - Change to: `this._controlClients.forEach(ws => { if (ws.instanceId === targetInstanceId) ws.send(...) })`
4. **Terminal channel**: Validate that the requested `terminalId` belongs to the connecting `instanceId` (prevent cross-instance access)
5. **PTY tracking**: `_activePtys` map needs instance scoping or at minimum instance validation on attach

**Estimated changes**: ~30 lines

### Phase 5: Server — Instance-Scoped API Routes

**File: `server/index.js`**

1. Add middleware/helper to extract `instanceId` from query string (or header) on every `/api/*` request
2. Route to the correct `SessionManager` instance scope and `FolderManager`
3. Affected endpoints:
   - `GET /api/sessions` → `sessionManager.listSessions(instanceId)`
   - `GET /api/folders` → `folderManagers.get(instanceId).toJSON()`
   - `GET /api/config` → same config for all instances (global, shared)
   - File/note APIs → **no change** — filesystem is shared across all instances
   - `/api/fileops/*` → **no change** — shared filesystem by design
   - `/api/shortcuts`, `/api/history` → **no change** — global/shared

**Estimated changes**: ~20 lines

### Phase 6: Client — Instance Persistence & UX

**File: `client/js/app.js`, `client/index.html`**

1. Store the instance UUID in `localStorage` under a key like `terminaldeck-instanceId`
2. On load: check `localStorage` first, then query string, then generate new
3. If query string is present, it wins (allows sharing links)
4. Add a small UI indicator showing the instance ID (truncated) somewhere unobtrusive — maybe in the header or a tooltip
5. (Future) Add a way to list/switch instances

**Estimated changes**: ~15 lines

---

## File Change Summary

| File | Type of Change |
|------|---------------|
| `client/js/app.js` | Instance ID init, pass to all API/WS calls |
| `server/sessions.js` | Instance-scoped session maps, instances.json persistence |
| `server/folders.js` | Per-instance folder files or instance-keyed state |
| `server/websocket.js` | Parse instance from WS upgrade, scoped broadcasts, access control |
| `server/index.js` | Extract instance from API requests, route to scoped managers |
| `config/instances.json` | New file — instance→session mapping for persistence |
| `config/folders-<uuid>.json` | New pattern — per-instance folder configs |

## Migration / Backwards Compatibility

- Existing `config/folders.json` becomes the template/default for new instances
- Existing tmux sessions (from before this change) won't have an instance mapping — `discoverSessions()` should assign orphaned sessions to a "default" instance or ignore them
- The `serverToken` auth mechanism is unchanged — instance ID is for scoping, not authentication

## What Is and Isn't Scoped

**Scoped per instance** (isolated):
- Terminal sessions (which tmux sessions belong to this instance)
- Folder organization (how terminals are grouped/arranged)
- WebSocket broadcasts (only see your own instance's events)

**Shared across all instances** (global):
- Filesystem — `/home/terminaldeck/home`, `/workspace`, all files and directories
- File operations — editor, notes, fileops, filetree
- Config — `terminaldeck.json`, theme, shortcuts
- Server token / authentication

This is intentional. The filesystem is the same machine — there is no per-user home directory or sandboxing. Instance scoping gives each user/session their own set of terminals and layout without pretending they have separate filesystems.

## Risks & Edge Cases

1. **Stale instances**: Instances with no active connections accumulate tmux sessions over time. Need a cleanup/expiry mechanism (future — not POC)
2. **Accidental new instance**: A new tab without `?instance=` generates a fresh UUID instead of rejoining an existing one. Mitigate with `localStorage` so the same browser defaults to its last instance
3. **Config reload broadcast**: Currently broadcasts to all clients. Should continue to do so (config is global)
4. **tmux session name collisions**: Session UUIDs are globally unique, so no collision risk even across instances

## Suggested Implementation Order

1. **Phase 1 + Phase 6** (Client instance ID) — get the UUID flowing
2. **Phase 2** (Server session scoping) — core isolation
3. **Phase 4** (WebSocket scoping) — prevent cross-instance visibility
4. **Phase 5** (API scoping) — complete the server side
5. **Phase 3** (Folder scoping) — separate folder configs

Each phase can be tested independently. After Phase 1+2+4, the basic multi-instance isolation works.

## Future (Beyond POC)

- Per-instance config overrides (themes, shell, shortcuts)
- Instance naming/labeling for humans
- Instance listing UI with session counts
- Authentication layer mapping users → allowed instances
- Instance sharing (multiple users viewing same instance)
- Instance templates (pre-configured session/folder layouts)
- Per-user home directories or filesystem sandboxing (would require OS-level changes, not in scope)
