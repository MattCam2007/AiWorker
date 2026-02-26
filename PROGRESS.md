# Feature Progress

## Command Palette (Team 1)
**Branch:** `feature/command-palette`
**Status:** Complete

### What was built
A slide-out command palette panel that shows searchable, scrollable command history.

### Backend
- **`server/history.js`** — New module with `parseHistory()`, `getHistoryFilePath()`, `readHistory()`, and `createHistoryRoute()` functions. Parses `~/.bash_history` or `~/.zsh_history` (based on configured shell), deduplicates entries, and returns most-recent-first. Handles missing/malformed files gracefully.
- **`server/index.js`** — Added `GET /api/history` route using the same `if` block pattern as existing routes. Reads the history file path from `config.settings.shell`.
- **`server/websocket.js`** — Added `watchHistoryFile()` method with 500ms debounced `fs.watch()` that broadcasts `{ type: 'history_update', history: [...] }` to control clients when the history file changes. Cleanup handled in `closeAll()`.

### Frontend
- **`client/js/command-palette.js`** — New IIFE module (`window.TerminalDeck.CommandPalette`). Fetches `/api/history` on open, uses fuse.js for client-side fuzzy search, renders scrollable list, fires `onSelect` callback when a command is clicked.
- **`client/js/app.js`** — Wired up `_initCommandPalette()` in init chain. Handles `history_update` WebSocket messages to live-update the palette. Added swipe-left gesture from right edge for mobile. Selected commands are sent to the active terminal via `_sendToActiveTerminal(command + '\n')`.
- **`client/index.html`** — Added command palette HTML structure, fuse.min.js vendor script, and command-palette.js script tag.
- **`client/css/style.css`** — Added `.command-palette`, `.cp-header`, `.cp-search-input`, `.cp-close`, `.cp-list`, `.cp-item`, `.cp-backdrop` styles with slide-out transform transition, mobile responsive overrides.
- **`client/vendor/fuse.min.js`** — Copied from `node_modules/fuse.js/dist/fuse.min.js`.

### Tests
- **`server/history.test.js`** — 19 tests: parseHistory (8), getHistoryFilePath (4), readHistory (4), /api/history endpoint (3)
- **`client/js/command-palette.test.js`** — 18 tests: namespace, open/close/toggle, loadHistory, search, selectItem, keyboard shortcuts (Ctrl+K, Cmd+K, Escape), close button, backdrop click, updateHistory

### Keyboard/Gesture Bindings
- **Desktop:** `Ctrl+K` (or `Cmd+K` on Mac) toggles palette
- **Mobile:** Swipe left from right edge opens palette
- **Escape** closes palette
- **Backdrop click** closes palette
- **Close button** closes palette

### Notes
- fuse.js is served from `client/vendor/fuse.min.js` (same vendor pattern as xterm.js)
- Keyboard shortcuts are registered by the CommandPalette constructor itself
- No existing tests were broken by these changes
