# TerminalDeck Progress

## Feature: Task Shortcuts (Team 2)

**Branch:** `feature/task-shortcuts`
**Status:** Complete

### What was built

A configurable shortcut system with aliases, defined in `config/terminaldeck.json`, with a backend API endpoint (`GET /api/shortcuts`) that returns merged project + global shortcuts. The data structure is ready for fuse.js integration by Team 1.

### Changes

1. **`server/config.js`** — Added shortcuts validation and defaults:
   - `_validate()`: validates `shortcuts` as object, `shortcuts.global` as array, `shortcuts.projects` as object, each shortcut requires `name` (string) and `command` (string), optional `aliases` (string array) and `icon` (string)
   - `_validateShortcut()`: new helper for individual shortcut validation
   - `_applyDefaults()`: defaults shortcuts to `{ global: [], projects: {} }` when missing
   - `getShortcuts(cwd)`: new method that merges project shortcuts (longest cwd match) + global shortcuts, project shortcuts appear first, each tagged with `source: 'project'` or `source: 'global'`

2. **`server/index.js`** — New `GET /api/shortcuts` endpoint:
   - Accepts optional `?cwd=/some/path` query param
   - Returns JSON array of merged shortcuts
   - Uses same routing pattern as existing endpoints

3. **`config/terminaldeck.json`** — Added example shortcuts section with global and project shortcuts

### Tests (34 new tests, all passing)

- `server/config.test.shortcuts.js` (26 tests): parsing, defaults, validation (13 error cases), getShortcuts merging logic
- `server/index.test.shortcuts.js` (8 tests): API endpoint with cwd matching, empty config, security headers, response structure
- All 12 existing `server/config.test.js` tests still pass (46 total)
