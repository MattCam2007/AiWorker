# TerminalDeck Code Editor

A full-featured code editor built on CodeMirror 6, embedded as a panel type alongside terminal panels in the TerminalDeck layout engine.

---

## User Guide

### Opening Files

Click any text file in the **Files** sidebar section. The editor detects text files by extension (~60 supported extensions including `.js`, `.py`, `.css`, `.json`, `.yaml`, `.md`, `.sh`, `.sql`, `.rs`, `.go`, etc.) and by name (Dockerfile, Makefile, .gitignore, .bashrc, etc.).

If the file is already open, the existing editor panel is focused instead of opening a duplicate.

### Status Bar

The status bar sits at the top of each editor panel:

```
[undo] [redo] | Saved                    VIM  JAVASCRIPT  [gear]
```

- **Undo/Redo buttons** (left): Click to undo/redo. Disabled when history is empty. Keyboard: `Ctrl+Z` / `Ctrl+Shift+Z`.
- **Status text**: Shows `Loading...`, `Saved`, `Unsaved`, `Saving...`, `Save error`, or `Load error`.
- **VIM badge**: Green badge, visible only when Vim mode is enabled.
- **Language label**: Detected from file extension (e.g., `JAVASCRIPT`, `PYTHON`, `CSS`).
- **Gear icon**: Opens the settings panel.

### Saving

- **Autosave**: Changes are saved automatically 3 seconds after you stop typing.
- **Manual save**: `Ctrl+S` / `Cmd+S`.
- **On close**: Dirty changes are saved before the panel is removed.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` / `Cmd+S` | Save |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+F` | Find / Replace |
| `Ctrl+G` | Go to Line |
| `Ctrl+D` | Select Next Occurrence |
| `Ctrl+/` | Toggle Comment |
| `Ctrl+A` | Select All |
| `Tab` | Indent |
| `Shift+Tab` | Dedent |
| `Alt+Drag` | Rectangular (column) selection |

When **Vim mode** is enabled, standard Vim keybindings are active (normal, insert, visual modes, `:w` to save, etc.).

### Right-Click Context Menu

Right-click anywhere in the editor to access:

**Editing**
- Cut, Copy, Paste
- Select All

**Navigation**
- Find / Replace (`Ctrl+F`)
- Go to Line (`Ctrl+G`)
- Select Next Occurrence (`Ctrl+D`)

**History**
- Undo, Redo

**Code Operations**
- Toggle Comment (`Ctrl+/`)
- Duplicate Line
- Sort Lines (Ascending)
- Sort Lines (Descending)

**Transform** (submenu, operates on selection)
- UPPERCASE
- lowercase
- Title Case

**Folding**
- Fold All
- Unfold All

**Quick Toggles**
- Toggle Word Wrap
- Toggle Minimap

### Settings Panel

Click the gear icon in the status bar. All settings apply globally to every open editor panel and persist across sessions via localStorage.

| Setting | Options | Default |
|---------|---------|---------|
| **Theme** | One Dark, Dracula, Monokai, Nord, Solarized Dark, GitHub Dark, Material Dark, Konsole (Green) | One Dark |
| **Tab Size** | 2, 4, 8 | 2 |
| **Indent** | Spaces, Tabs | Spaces |
| **Word Wrap** | On / Off | Off |
| **Vim Mode** | On / Off | Off |
| **Autocomplete** | On / Off | On |
| **Minimap** | On / Off | Off |
| **Font Size** | 10px - 24px | 14px |

The bottom of the settings panel shows all **Loaded Languages** as tags. Hover a tag to see its associated file extensions.

### Themes

All themes are dark mode with full syntax highlighting for keywords, strings, numbers, comments, types, functions, operators, HTML tags, and more.

| Theme | Background | Style |
|-------|-----------|-------|
| One Dark | `#282c34` | Warm gray, Atom-inspired |
| Dracula | `#282a36` | Purple-accented dark |
| Monokai | `#272822` | Classic Sublime Text |
| Nord | `#2e3440` | Cool arctic blues |
| Solarized Dark | `#002b36` | Ethan Schoonover's palette |
| GitHub Dark | `#0d1117` | GitHub's official dark |
| Material Dark | `#212121` | Google Material Design |
| Konsole | `#000000` | Green-on-black retro terminal |

### Supported Languages

Syntax highlighting for 13 languages:

| Language | Extensions |
|----------|-----------|
| JavaScript | `.js` `.mjs` `.cjs` `.jsx` `.ts` `.tsx` |
| Python | `.py` `.pyw` |
| CSS | `.css` `.scss` `.less` `.sass` |
| HTML | `.html` `.htm` |
| PHP | `.php` |
| JSON | `.json` |
| YAML | `.yaml` `.yml` |
| Rust | `.rs` |
| C/C++ | `.c` `.h` `.cpp` `.cc` `.hpp` |
| Java | `.java` |
| SQL | `.sql` |
| XML/SVG | `.xml` `.svg` |
| Markdown | `.md` |

Files with other recognized text extensions open without syntax highlighting (plain text mode).

### Multiple Cursors / Column Selection

- **Alt+Click**: Add a cursor at click position.
- **Alt+Drag**: Rectangular (block/column) selection.
- **Ctrl+D**: Select next occurrence of current selection (adds cursor).

### Minimap

When enabled, a minimap appears on the right edge of the editor showing a compressed overview of the file. Hover over the minimap to see an overlay indicator of the visible region.

---

## Architecture

### File Map

```
client/
  vendor/codemirror6.bundle.js   # Compiled CM6 bundle (1.1MB, all-in-one)
  js/
    editor-settings.js           # EditorSettings singleton (localStorage)
    editor-panel.js              # EditorPanel class (CM6 integration)
    app.js                       # Instantiates EditorPanel, file open flow
    filetree.js                  # File click handler triggers editor open
  css/
    style.css                    # ep-* classes (settings panel, context menu, status bar)
scripts/
  bundle-codemirror.js           # ES module entry point for esbuild
server/
  notes.js                      # NoteManager class (CRUD, file I/O)
  index.js                      # Express routes: /api/notes/*
```

### Script Load Order

```
codemirror6.bundle.js  ->  Sets window.CM6, dispatches 'cm6-ready'
editor-settings.js     ->  Creates window.TerminalDeck.editorSettings singleton
editor-panel.js        ->  Defines EditorPanel class (reads settings + CM6)
app.js                 ->  Instantiates EditorPanel when files are opened
```

### Bundle (`scripts/bundle-codemirror.js`)

Built with esbuild into a single IIFE:

```bash
npm run build:codemirror
# or:
npx esbuild scripts/bundle-codemirror.js --bundle --format=iife --minify \
  --outfile=client/vendor/codemirror6.bundle.js
```

The bundle exports everything on `window.CM6`:

- **Core**: `EditorView`, `EditorState`, `Compartment`, `keymap`, `minimalSetup`
- **View**: `lineNumbers`, `highlightActiveLineGutter`, `drawSelection`, `rectangularSelection`, `crosshairCursor`, `highlightSpecialChars`, `dropCursor`, `lineWrapping`
- **History**: `history`, `historyKeymap`, `undo`, `redo`, `undoDepth`, `redoDepth`
- **Commands**: `defaultKeymap`, `toggleComment`, `indentWithTab`, `indentMore`, `indentLess`, `selectAll`
- **Search**: `search`, `searchKeymap`, `openSearchPanel`, `gotoLine`, `selectNextOccurrence`, `highlightSelectionMatches`
- **Autocomplete**: `autocompletion`, `completionKeymap`, `closeBrackets`, `closeBracketsKeymap`, `completeAnyWord`
- **Language**: `indentUnit`, `foldAll`, `unfoldAll`, `foldKeymap`, `foldGutter`, `indentOnInput`, `bracketMatching`, `syntaxHighlighting`, `defaultHighlightStyle`
- **Vim**: `vim` (from `@replit/codemirror-vim`)
- **Minimap**: `showMinimap` (from `@replit/codemirror-minimap`)
- **Themes**: `{ oneDark, dracula, monokai, nord, solarizedDark, githubDark, materialDark, konsole }`
- **Languages**: `{ javascript, python, css, html, php, json, yaml, rust, cpp, java, sql, xml, markdown }`

Uses `minimalSetup` instead of `basicSetup` to avoid extension duplication — each extension is added explicitly via Compartments for runtime control.

### Settings System (`editor-settings.js`)

Singleton at `window.TerminalDeck.editorSettings`. Persists to `localStorage` under key `td-editor-settings`.

```javascript
// Read
var theme = ns.editorSettings.get('theme');    // 'oneDark'

// Write (broadcasts to all editor panels)
ns.editorSettings.set('theme', 'dracula');

// Subscribe
var unsub = ns.editorSettings.onChange(function(key, value) {
  console.log(key, 'changed to', value);
});
unsub(); // unsubscribe
```

### Compartment Architecture (`editor-panel.js`)

The editor uses 9 CM6 `Compartment` instances for runtime reconfiguration without destroying the editor:

```
theme        ->  Theme extension (array of EditorView.theme + syntaxHighlighting)
tabSize      ->  EditorState.tabSize.of(n)
indentUnit   ->  indentUnit.of(' '.repeat(n) or '\t')
lineWrap     ->  EditorView.lineWrapping or []
vim          ->  vim() or []
autocomplete ->  autocompletion({...}) or []
minimap      ->  showMinimap.create({...}) or []
language     ->  javascript() / python() / etc. or []
fontSize     ->  EditorView.theme with fontSize override
```

When a setting changes, `_applySettingChange(key, value)` dispatches a `Compartment.reconfigure()` effect to the editor view.

### Data Flow: Opening a File

```
1. User clicks file in sidebar FileTree
2. app.js: _openFileInEditor(relativePath, fileName)
3. app.js: isTextFile(fileName) check
4. app.js: _openFileAsEditor(relativePath)
5. POST /api/notes { filePath: relativePath }
     -> server: NoteManager.openFile(relativePath)
     -> Creates config entry with absolute path
     -> Returns { id, name, file }
6. new EditorPanel({ id, name, file })
7. EditorPanel.mount() builds DOM + initializes CM6
8. _loadContent(): GET /api/notes/{id}
     -> server: NoteManager.getNote(id)
     -> Reads file from disk
     -> Returns { id, name, file, content }
9. Content injected into CM6, status -> "Saved"
```

### Data Flow: Saving

```
1. User types -> CM6 updateListener fires
2. _dirty = true, status -> "Unsaved"
3. _scheduleAutosave() sets 3-second debounce timer
4. Timer fires (or user presses Ctrl+S):
5. PUT /api/notes/{id} { content: "..." }
     -> server: NoteManager.saveNote(id, content)
     -> Ensures directory exists
     -> Writes file to disk
     -> Returns { success: true, saved: ISO8601 }
6. _dirty = false, status -> "Saved"
```

### Data Flow: Closing

```
1. User closes panel (X button or layout action)
2. If dirty: save() called and awaited
3. DELETE /api/notes/{id}?deleteFile=false
     -> server: Removes config entry
     -> File remains on disk (workspace files preserved)
4. EditorPanel.destroy():
     -> Unsubscribe from settings
     -> Dismiss settings panel and context menu
     -> Destroy CM6 EditorView
     -> Remove DOM
```

### API Endpoints

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/api/notes` | - | `[{ id, name, file, exists }]` |
| `POST` | `/api/notes` | `{ filePath }` | `{ id, name, file }` |
| `GET` | `/api/notes/:id` | - | `{ id, name, file, content }` |
| `PUT` | `/api/notes/:id` | `{ content }` | `{ success, saved }` |
| `DELETE` | `/api/notes/:id?deleteFile=false` | - | `{ success }` |

Server-side path safety: validates paths stay within allowed directories, resolves symlinks to prevent directory traversal.

---

## Known Bugs / Limitations

### Bugs

1. **Save errors are easy to miss**: Status bar shows "Save error" but there's no toast or prominent alert. User might not notice if autosave fails silently.

2. **Context menu submenu can overflow viewport**: The Transform submenu is positioned at `left: 100%` of the parent menu. If the parent is near the right edge, the submenu clips off-screen.

3. **Rapid file open race condition**: If a user opens the same file twice very quickly (faster than the POST roundtrip), two note entries could be created. Low impact since both point to the same file.

4. **Settings panel positioning on small screens**: The panel is 320px wide and positioned relative to the gear button. On very narrow viewports, it may not fit well.

### Not Implemented

1. **LSP / intelligent autocomplete**: Autocomplete uses `completeAnyWord` (word-based completion from the current document). No language server protocol, no snippet support, no cross-file symbols.

2. **New file creation from editor**: Server supports `POST /api/notes { name }` to create blank notes, but there's no UI for it. Files can only be opened from the file explorer.

3. **Server-side settings sync**: Settings are localStorage-only. Different browsers/devices get independent settings. No server endpoint for settings persistence.

4. **Mobile toolbar integration**: The mobile toolbar (Keys, Slash, Cmds, Sessions panels) only targets terminal panels. Editor panels have no mobile-specific input helpers.

5. **Minimap display mode config**: The minimap uses `displayText: 'blocks'` only. The `@replit/codemirror-minimap` plugin supports `'blocks'`, `'match'`, and `'color'` modes, but these aren't exposed in settings.

6. **Search history**: Find/Replace works but doesn't persist search history across sessions.

7. **Vim mode help text**: No built-in reference for Vim keybindings. Users are expected to already know Vim.

8. **File encoding detection**: All files are read/written as UTF-8. No support for other encodings.

9. **Read-only mode**: No way to open a file as read-only. All opened files are editable.

10. **Multiple cursor undo**: Undoing after a multi-cursor edit undoes all cursors' changes in one step (standard CM6 behavior, not a bug, but may surprise users).

### Potential Improvements

- Toast notifications for save errors
- Breadcrumb or file path display in status bar
- Split editor (side-by-side view of same file)
- Diff view for unsaved changes
- Go to definition (would require LSP)
- Snippet support
- Bracket pair colorization
- Indent guides
- Sticky scroll (pinned scope headers)
