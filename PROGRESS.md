# TerminalDeck Feature Sprint — Progress Report

## [2026-02-26 00:00] — ORCHESTRATOR — Phase 0: Reconnaissance Complete

### Codebase Assessment
- **Architecture**: Raw `http.createServer()` (no Express), vanilla ES6 frontend (IIFE pattern on `window.TerminalDeck`), WebSocket via `ws` library, tmux via `node-pty` on dedicated socket `-L terminaldeck`
- **Config**: `config/terminaldeck.json` with `settings.theme` and `settings.shell` only. ConfigManager in `server/config.js` with validation + hot-reload via `fs.watch`
- **WebSocket Protocol**: Two channels — `/ws/control` (create/destroy/update terminals, config reload, activity) and `/ws/terminal/<id>` (input/output/resize)
- **Test setup**: Mocha + Chai + Sinon (backend), Mocha + JSDOM (frontend). Tests in `*.test.js` alongside source files.
- **Key constraint**: `server/index.test.js` calls `cleanupTmuxSessions()` which kills all `terminaldeck-*` sessions — tests CANNOT be run in live environment

### Files Each Team Will Touch
| File | Team 1 (Palette) | Team 2 (Shortcuts) | Team 3 (Notifications) |
|------|:-:|:-:|:-:|
| `server/index.js` | X (history API) | X (shortcuts API) | |
| `server/websocket.js` | X (history push) | | X (task detection) |
| `server/config.js` | | X (shortcuts validation) | X (promptPattern validation) |
| `config/terminaldeck.json` | | X (shortcuts) | X (promptPattern) |
| `client/index.html` | X (drawer HTML, fuse.js) | X (script tag if needed) | X (bell icon) |
| `client/js/app.js` | X (Ctrl+K, swipe, palette) | X (shortcut rendering) | X (task_complete handler, bell) |
| `client/css/style.css` | X (drawer styles) | X (shortcut styles) | X (notification styles) |
| `package.json` | X (fuse.js dep) | | |

### Merge Order Decision
1. **Task Shortcuts** first — adds config schema + API endpoint, minimal frontend
2. **Command Palette** second — adds drawer UI that consumes shortcuts + history
3. **Notifications** last — most isolated, touches WebSocket layer independently

---

## [2026-02-26 00:01] — ORCHESTRATOR — Teams Spawning

Launching 3 parallel agent teams in isolated worktrees:
- Team 1: `feature/command-palette`
- Team 2: `feature/task-shortcuts`
- Team 3: `feature/notifications`

Each follows TDD workflow: Plan → Write tests (red) → Implement (green) → Refactor → Verify → Commit

---

## [2026-02-26 01:00] — Markdown Notes — Phase 0: Reconnaissance Complete

### Codebase Analysis
- **Server**: Raw `http.createServer()`, no Express. Routes are `if/else` chains on `req.url`.
- **Config**: `ConfigManager` in `server/config.js` — loads JSON, validates, hot-reloads. Only `settings` section currently.
- **Frontend**: IIFE pattern on `window.TerminalDeck` namespace. Files: `terminal.js` (TerminalConnection), `layout.js` (LayoutEngine), `terminal-list.js` (sidebar list), `app.js` (orchestrator).
- **Layout**: `LayoutEngine._cellMap` maps cell DOM → `{ connection, terminalId }`. Connections have `attach(el)`, `detach()`, `refit()`, `focus()`, `isActive()`.
- **WebSocket**: `/ws/control` for commands, `/ws/terminal/:id` for PTY I/O. Control broadcasts sessions, config_reload, activity.
- **Testing**: Mocha + Chai + Sinon (server), Mocha + JSDOM (client). Test files co-located with source.

### Key Decisions
- Notes stored at `/workspace/.unity/notes/` as `.md` files
- EasyMDE loaded via CDN (simpler than vendoring, single script+css tag)
- NotePanel class mirrors TerminalConnection interface: `attach()`, `detach()`, `refit()`, `focus()`, `isActive()`
- Layout engine generalized to use "panel" concept — both terminal and note types
- Backend uses same raw HTTP server pattern (no Express dependency)
- Config gets `notes` array alongside existing `settings`

### Worktree
- Branch: `feature/markdown-notes`
- Worktree: `.claude/worktrees/markdown-notes`

---

## [2026-02-26] — Team 3 (Notifications) — Feature Complete

### What Was Built
Task completion notification system that detects when a command finishes in any terminal and alerts the user via audio ding, browser notification (background tabs), and visual flash.

### Files Created
- `server/prompt-detector.js` — PromptDetector class: per-terminal output tracking, 2s debounce, ANSI-stripping, configurable regex pattern, 50-byte minimum output threshold
- `server/prompt-detector.test.js` — 13 unit tests for prompt detection logic
- `server/notifications.test.js` — 4 tests for config promptPattern validation/defaults
- `client/js/notifications.test.js` — 10 tests for frontend notification handling

### Files Modified
- `server/config.js` — Added `promptPattern` to DEFAULT_SETTINGS and validation
- `server/websocket.js` — Integrated PromptDetector into PTY data handler, broadcasts `task_complete` via control channel
- `server/index.js` — Passes `configManager` to TerminalWSServer constructor
- `config/terminaldeck.json` — Added `settings.promptPattern: "\\$\\s*$"`
- `client/js/app.js` — Added `_handleTaskComplete`, `_playDing` (Web Audio API), `_flashTerminalCell`, `_toggleNotificationMute`, `_initNotifications` (Notification.requestPermission)
- `client/css/style.css` — Added `.notification-toggle` button styles, `@keyframes task-complete-glow` animation, `.cell-task-complete` class
- `client/index.html` — Added bell toggle button in header

### Test Results
- 27 new tests: all passing
- 0 regressions in existing tests (config: 12/12, activity: 9/9, app: 27/27)
- Pre-existing failures in layout.test.js and terminal.test.js unaffected

### Architecture Notes
- `PromptDetector` is a standalone class with no dependencies beyond Node.js timers
- Detection heuristic: accumulate output bytes per terminal; when output stops for 2s and the buffer ends with the prompt regex after >50 bytes of output, fire `task_complete`
- ANSI escape sequences stripped before pattern matching
- State resets after each task_complete, preventing false positives from empty prompt mashing
- Frontend mute state stored in `App._notificationsMuted`, toggled via header button
- Audio uses Web Audio API oscillator (830 Hz sine, 0.3s decay) — no external files needed
