# TerminalDeck Feature Sprint — Progress Report

## Feature: Task Shortcuts (Team 2)

**Branch:** `feature/task-shortcuts`
**Status:** Complete — Merged to main

### What was built

A configurable shortcut system with aliases, defined in `config/terminaldeck.json`, with a backend API endpoint (`GET /api/shortcuts`) that returns merged project + global shortcuts. The data structure is ready for fuse.js integration by Team 1.

### Changes

1. **`server/config.js`** — Added shortcuts validation and defaults:
   - `_validate()`: validates `shortcuts` as object, `shortcuts.global` as array, `shortcuts.projects` as object, each shortcut requires `name` (string) and `command` (string), optional `aliases` (string array) and `icon` (string)
   - `_validateShortcut()`: new helper for individual shortcut validation
   - `_applyDefaults()`: defaults shortcuts to `{ global: [], projects: {} }` when missing
   - `getShortcuts(cwd)`: new method that merges project shortcuts (longest cwd match) + global shortcuts, project shortcuts appear first, each tagged with `source: 'project'` or `source: 'global'`

2. **`server/index.js`** — New `GET /api/shortcuts` endpoint
3. **`config/terminaldeck.json`** — Added example shortcuts section

### Tests: 34 new tests, all passing

---

## Command Palette (Team 1)

**Branch:** `feature/command-palette`
**Status:** Complete — Merged to main

### What was built
A slide-out command palette panel that shows searchable, scrollable command history.

### Backend
- **`server/history.js`** — New module: `parseHistory()`, `getHistoryFilePath()`, `readHistory()`, `createHistoryRoute()`
- **`server/index.js`** — Added `GET /api/history` route
- **`server/websocket.js`** — Added `watchHistoryFile()` with debounced `fs.watch()`, broadcasts `history_update`

### Frontend
- **`client/js/command-palette.js`** — New IIFE module with fuse.js fuzzy search
- **`client/js/app.js`** — Wired palette init, history_update handler, swipe gesture
- **`client/index.html`** — Added palette HTML, fuse.min.js, command-palette.js
- **`client/css/style.css`** — Added palette styles with slide-out transition
- **`client/vendor/fuse.min.js`** — fuse.js UMD bundle

### Tests: 37 new tests, all passing

---

## Notifications (Team 3)

**Branch:** `feature/notifications`
**Status:** Complete — Merged to main

### What was built
Task completion notification system: audio ding, browser notifications, visual flash.

### Backend
- **`server/prompt-detector.js`** — PromptDetector class: per-terminal output tracking, 2s debounce, ANSI-stripping, configurable regex
- **`server/config.js`** — Added `promptPattern` to defaults and validation
- **`server/websocket.js`** — Integrated PromptDetector, broadcasts `task_complete`
- **`server/index.js`** — Passes `configManager` to TerminalWSServer

### Frontend
- **`client/js/app.js`** — `_handleTaskComplete`, `_playDing` (Web Audio API 830Hz sine), `_flashTerminalCell`, `_toggleNotificationMute`, `_initNotifications`
- **`client/css/style.css`** — Notification toggle, task-complete-glow animation
- **`client/index.html`** — Bell toggle button in header

### Tests: 27 new tests, all passing

---

## Merge Log

1. `feature/task-shortcuts` → `main`: Fast-forward (no conflicts)
2. `feature/command-palette` → `main`: Conflict in PROGRESS.md only (resolved)
3. `feature/notifications` → `main`: Conflicts in PROGRESS.md, config/terminaldeck.json, server/websocket.js, client/js/app.js (all resolved — kept both features' additions)

---

## Markdown Notes

**Branch:** `feature/markdown-notes`
**Status:** Complete — Ready to merge

### What was built
Embedded markdown note panels that live alongside terminal sessions in the grid layout. Notes use EasyMDE (CodeMirror-based) with full dark theme, autosave, and multi-client sync via WebSocket broadcast.

### Backend
- **`server/notes.js`** — NoteManager class: CRUD operations (`listNotes`, `getNote`, `saveNote`, `createNote`, `deleteNote`), path traversal protection, slug-based ID generation, config persistence
- **`server/index.js`** — 5 REST endpoints: `GET /api/notes`, `GET /api/notes/:id`, `PUT /api/notes/:id`, `POST /api/notes`, `DELETE /api/notes/:id`
- **`server/config.js`** — Notes array validation (id/name/file required, duplicate ID check), defaults preservation
- **`server/websocket.js`** — `broadcastNoteSaved(noteId)` for multi-client sync
- **`config/terminaldeck.json`** — Added `notes` array with example Scratchpad entry

### Frontend
- **`client/js/note-panel.js`** — NotePanel class matching TerminalConnection interface (`attach`, `detach`, `refit`, `focus`, `isActive`, `destroy`, `moveTo`). EasyMDE init, 3s autosave debounce, Ctrl+S, dirty state tracking
- **`client/js/app.js`** — Notes loaded at init via API, create dialog with Terminal/Note type selector, note_saved WebSocket handler, beforeunload dirty check, sidebar close minimizes notes
- **`client/js/terminal-list.js`** — Memo icon for notes, dirty asterisk indicator, activity dot skipped for notes
- **`client/css/style.css`** — Full EasyMDE dark theme (editor, toolbar, preview, CodeMirror), note panel wrapper layout, type selector styles, mobile responsive overrides
- **`client/index.html`** — EasyMDE CDN (CSS + JS), note-panel.js script tag

### Architecture Decisions
- `_connections{}` stores both TerminalConnection and NotePanel, distinguished by `.type === 'note'`
- Layout engine unchanged — `assignTerminal()` works with any panel implementing the interface
- Notes persist in config, close button minimizes (doesn't destroy)
- EasyMDE loaded via CDN, not vendored
- Notes stored as `.md` files in `/workspace/.unity/notes/`

### Commits (5)
1. `ab511a0` — Backend note CRUD: NoteManager, API routes, WebSocket broadcast
2. `65ad7b8` — NotePanel class and EasyMDE integration
3. `da78187` — Layout engine integration and UI wiring
4. `3258d46` — EasyMDE dark theme and note panel CSS
5. `a425355` — Polish: error handling, config defaults, mobile CSS

### Tests: 32 new tests (19 server + 13 client), all passing

---

## Final Summary

- **4 features implemented**: Task Shortcuts, Command Palette, Notifications, Markdown Notes
- **130 new tests** across all features
- **Files changed**: 24 files modified/created
- **No regressions** to existing functionality
