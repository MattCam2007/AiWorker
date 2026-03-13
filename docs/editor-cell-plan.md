# EditorCell Implementation Plan

## Overview

Add a new `EditorCell` class — a tab-group container purpose-built for code editors. It parallels `FolderCell` (which groups terminals) but is specialized for `EditorPanel` instances. Multiple `EditorCell`s can exist simultaneously across different grid cells. The **last-active EditorCell** is tracked so new files open there by default (JetBrains-style routing).

---

## Architecture Summary

```
Grid Cell
  ├── standalone terminal (existing — unchanged)
  ├── FolderCell (existing — groups terminals with tabs)
  └── EditorCell (NEW — groups EditorPanels with tabs)
        ├── tab: app.js (EditorPanel)
        ├── tab: utils.py (EditorPanel)  ← active
        └── tab: style.css (EditorPanel)
```

An EditorCell with 1 tab **is** the single-file-in-a-cell experience. No separate code path needed.

### Key design decisions
- `EditorCell` is a **separate class** from `FolderCell` (Option A). They share no inheritance but follow the same interface contract so `LayoutEngine` can host both.
- File routing: newly opened files go to the **last-active EditorCell**. If none exists, a new EditorCell is created in the first empty cell.
- Each tab shows a dirty indicator (dot) and a per-tab close button.
- The tab bar and chrome visually match the terminal `FolderCell` tab bar (same CSS classes/structure with an `editor-cell-mode` modifier class).

---

## File inventory

| File | Action | What changes |
|------|--------|-------------|
| `client/js/editor-cell.js` | **CREATE** | New `EditorCell` class |
| `client/js/editor-cell.test.js` | **CREATE** | Tests for EditorCell (TDD — write first) |
| `client/js/layout.js` | EDIT | Add `assignEditorCell()`, `_switchEditorTab()`, `_makeEditorCellCallbacks()`, update `_clearCell()`, `minimizeTerminal()`, `_removeFromGrid()`, `refitAll()`, supersize save/restore |
| `client/js/layout.test.js` | EDIT | Add EditorCell integration tests |
| `client/js/app.js` | EDIT | Change `_openFileAsEditor()` to route to last-active EditorCell, track `_lastActiveEditorCell`, update `_closeFilePanel()` |
| `client/css/style.css` | EDIT | Add `.cell-editor-mode` styles (dirty dot, tab close button) |
| `client/index.html` | EDIT | Add `<script src="js/editor-cell.js">` tag |

---

## Phase 1: EditorCell data model (TDD)

### Step 1.1 — Write tests first: `client/js/editor-cell.test.js`

Create this file modeled exactly on `client/js/folder-cell.test.js`. Use the same test setup pattern:

```js
const { expect } = require('chai');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');

describe('EditorCell', function () {
  let dom, window, EditorCell;

  // Helper: create a mock EditorPanel (same shape as layout.test.js makeConnection)
  function makePanel(id, fileName) {
    return {
      id: id,
      type: 'editor',
      config: { name: fileName || id, file: '/workspace/' + (fileName || id) },
      attach: sinon.stub(),
      detach: sinon.stub(),
      refit: sinon.stub(),
      focus: sinon.stub(),
      isDirty: sinon.stub().returns(false),
      save: sinon.stub().returns(Promise.resolve()),
      destroy: sinon.stub()
    };
  }

  beforeEach(function () {
    dom = new JSDOM(
      '<!DOCTYPE html><html><body></body></html>',
      { url: 'http://localhost:3000' }
    );
    window = dom.window;
    global.window = window;
    global.document = window.document;

    delete require.cache[require.resolve('./editor-cell')];
    require('./editor-cell');
    EditorCell = window.TerminalDeck.EditorCell;
  });

  afterEach(function () {
    delete global.window;
    delete global.document;
    sinon.restore();
  });

  // ... tests below ...
});
```

Write these tests (each as a separate `it()` block):

**Constructor & getters:**
1. `EditorCell exists on window.TerminalDeck namespace` — `expect(EditorCell).to.be.a('function')`
2. `constructor with one panel sets it as active` — create with `[{id:'a', name:'A', panel: panelA}]`, assert `getActiveTabId() === 'a'`
3. `constructor with empty array sets activeId to null` — `getActiveTabId()` returns `null`
4. `getActivePanel returns the panel of the active tab` — assert returns `panelA`
5. `getActivePanel returns null for empty EditorCell`
6. `getTabs returns a copy of the tabs array` — mutating the returned array doesn't affect internal state
7. `getTabCount returns correct count`

**Tab switching:**
8. `setActiveTab updates active and returns prev/next` — switch from 'a' to 'b', assert `result.prev.id === 'a'`, `result.prev.panel === panelA`, `result.next.id === 'b'`, `result.next.panel === panelB`
9. `setActiveTab returns null when already active` — same tab
10. `setActiveTab updates getActiveTabId`

**Adding tabs:**
11. `addTab appends a new tab` — assert `getTabs()` length increases
12. `addTab sets active if EditorCell was empty` — add to empty, assert `getActiveTabId()` is the added tab
13. `addTab does NOT change active if EditorCell already has tabs` — add second tab, assert active is still first
14. `addTab with activate=true sets the new tab as active` — add with flag, assert active changed

**Removing tabs:**
15. `removeTab of inactive tab does not change active` — remove non-active, assert active unchanged
16. `removeTab of active tab selects next adjacent tab` — remove active (index 0 of 3), assert new active is what was at index 1
17. `removeTab of sole tab returns newActiveId null`
18. `removeTab returns wasActive: false for nonexistent id`

**Tab name updates:**
19. `updateTabName updates the name field`

**Finding tabs:**
20. `findTabByFile returns tab id for matching file path` — add panels with different file paths, assert correct id returned
21. `findTabByFile returns null when no match`

**Dirty state:**
22. `hasDirtyTabs returns true when any panel.isDirty() is true` — set one panel's isDirty to return true
23. `hasDirtyTabs returns false when all panels are clean`

**Renderer (header):**
24. `renderHeader creates tabs container with correct number of tabs`
25. `renderHeader marks active tab with cell-header-tab-active class`
26. `renderHeader shows dirty indicator on dirty tabs` — set panel.isDirty to return true, assert tab has `.cell-header-tab-dirty` element
27. `renderHeader tab click calls onTabClick with correct id`
28. `renderHeader shows close button per tab`
29. `renderHeader tab close button calls onTabClose with correct id`
30. `renderHeader shows standard cell buttons (supersize, minimize, close)`
31. `renderHeader shows exit-supersize when isSupersized returns true`
32. `updateActiveTab changes active class without full re-render`
33. `updateDirtyIndicators updates dirty dots without full re-render`
34. `re-render replaces content cleanly after addTab`

### Step 1.2 — Implement `client/js/editor-cell.js`

Create this file. Follow the **exact same IIFE + prototype pattern** as `folder-cell.js`. Attach to `window.TerminalDeck.EditorCell`.

```js
(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  function EditorCell(tabEntries) {
    // tabEntries: array of { id, name, panel }
    // (panel is an EditorPanel instance)
    this._tabs = (tabEntries || []).map(function (e) {
      return { id: e.id, name: e.name, panel: e.panel };
    });
    this._activeId = this._tabs.length > 0 ? this._tabs[0].id : null;
  }

  // ... prototype methods below ...

  ns.EditorCell = EditorCell;
})();
```

**Data model methods** (mirror FolderCell's API shape, but use `panel` instead of `connection` and `tab` instead of `terminal`):

| Method | Signature | Behavior |
|--------|-----------|----------|
| `getActiveTabId` | `() → string|null` | Returns `this._activeId` |
| `getActivePanel` | `() → EditorPanel|null` | Finds tab with `id === _activeId`, returns its `.panel` |
| `getTabs` | `() → Array` | Returns `this._tabs.slice()` (defensive copy) |
| `getTabCount` | `() → number` | Returns `this._tabs.length` |
| `setActiveTab` | `(tabId) → {prev, next}|null` | Same semantics as `FolderCell.setActiveTab`. Returns null if already active. Returns `{prev: {id, panel}, next: {id, panel}}` |
| `addTab` | `(id, name, panel, activate)` | Push to `_tabs`. If `_activeId` is null OR `activate === true`, set `_activeId = id` |
| `removeTab` | `(id) → {wasActive, newActiveId}` | Same semantics as `FolderCell.removeTerminal`. If removing active, pick adjacent tab. |
| `updateTabName` | `(id, name)` | Updates the `name` field of the matching tab |
| `findTabByFile` | `(filePath) → string|null` | Iterates `_tabs`, returns `id` of first tab whose `panel.config.file === filePath`. Returns null if none. |
| `hasDirtyTabs` | `() → boolean` | Returns true if any tab's `panel.isDirty()` returns true |

**Renderer method — `renderHeader(headerEl, callbacks)`:**

This method must produce HTML that **visually matches** the FolderCell tab bar. Use the same CSS class names where possible, with an additional modifier class for editor-specific elements.

```
Header structure (DOM):
  <div class="cell-header-tabs">            ← scrollable tab container
    <button class="cell-header-tab [cell-header-tab-active]" data-tab-id="xxx">
      <span class="cell-header-tab-name">filename.js</span>
      <span class="cell-header-tab-dirty" style="display:none">●</span>   ← dirty dot
      <span class="cell-header-tab-close">×</span>                         ← per-tab close
    </button>
    ...more tabs...
  </div>
  <span class="cell-header-spacer"></span>
  <button class="cell-header-more">⋮</button>
  <button class="cell-header-supersize">⤢</button>   (or exit-supersize)
  <button class="cell-header-minimize">–</button>
  <button class="cell-header-close">×</button>        ← closes active tab
```

Callbacks object shape (passed in by LayoutEngine):
```js
{
  onTabClick: function(tabId) {},       // switch active tab
  onTabClose: function(tabId) {},       // close one tab
  onMore: function(x, y) {},            // context menu
  onSupersize: function() {},           // toggle supersize
  isSupersized: function() {},          // returns boolean
  onMinimize: function() {},            // minimize entire editor cell
  onClose: function() {}                // close active tab (header × button)
}
```

Event wiring inside `renderHeader`:
- Tab button `click` → `callbacks.onTabClick(tabId)`
- Tab button `contextmenu` → `callbacks.onTabContextMenu(tabId, x, y, tabEl)` (for rename/close context menu)
- Tab `.cell-header-tab-close` `click` → `e.stopPropagation(); callbacks.onTabClose(tabId)`
- More button `click` → `callbacks.onMore(x, y)`
- Supersize button `click` → `callbacks.onSupersize()`
- Minimize button `click` → `callbacks.onMinimize()`
- Header close button `click` → `callbacks.onClose()`

**Additional renderer helpers:**

| Method | Behavior |
|--------|----------|
| `updateActiveTab(headerEl)` | Toggles `cell-header-tab-active` class on tabs without full re-render. Same as `FolderCell.updateActiveTab` but uses `data-tab-id` instead of `data-terminal-id`. |
| `updateDirtyIndicators(headerEl)` | Iterates tabs, shows/hides `.cell-header-tab-dirty` based on `panel.isDirty()`. Call this on dirty state changes instead of full re-render. |

### Step 1.3 — Run tests, verify they pass

```bash
npx mocha client/js/editor-cell.test.js
```

All 34 tests should pass.

---

## Phase 2: LayoutEngine integration (TDD)

### Step 2.1 — Write tests first: add to `client/js/layout.test.js`

Add a new `describe('EditorCell integration')` block at the bottom of `layout.test.js`, inside the existing outer `describe`. Use the same setup pattern as the FolderCell integration tests already in that file.

Helper needed at the top of the new describe block:
```js
function makeEditorCell(window, tabEntries) {
  var EditorCell = window.TerminalDeck.EditorCell;
  return new EditorCell(tabEntries);
}
```

Each test's `beforeEach` must also `require('./editor-cell')` (same pattern as the FolderCell tests that `require('./folder-cell')`).

**Tests to write:**

1. `assignEditorCell attaches active panel and sets editorCell in cellMap` — call `engine.assignEditorCell(cell, ec)`, assert `cellMap.get(cell)` has `{connection: activePanel, terminalId: activeTabId, editorCell: ec}`, and `activePanel.attach` was called once.

2. `assignEditorCell removes editor tabs from minimized` — add two panels to minimized, then assignEditorCell containing those panels. Assert `_minimized.size === 0`.

3. `assignEditorCell renders header with tabs` — assert header has `.cell-header-tabs` and correct number of `.cell-header-tab` elements.

4. `assignEditorCell adds cell-editor-mode class` — assert `cell.classList.contains('cell-editor-mode')`.

5. `_switchEditorTab detaches old and attaches new panel` — call `engine._switchEditorTab(cell, 'b')`, assert panel A detached, panel B attached, cellMap updated.

6. `_switchEditorTab with current active id is a no-op` — assert no detach called.

7. `_switchEditorTab with non-editorCell cell is a no-op` — doesn't throw.

8. `minimizeTerminal on active editor tab switches to next` — assign EditorCell with A and B, minimize A, assert B becomes active, A in minimized.

9. `minimizeTerminal on last editor tab clears cell` — assign EditorCell with only A, minimize A, assert cell is empty.

10. `_clearCell on editor cell moves all panels to minimized` — assign EditorCell with A and B, clearCell, assert both in minimized and cell is empty.

11. `grid resize preserves editor cell at stable position` — assign to cell[0] in 2x1, switch to 2x2, assert cell[0] still has the editorCell.

12. `refitAll refits only active editor panel` — assign EditorCell with A (active) and B, call refitAll, assert A.refit called, B.refit not called.

13. `_removeFromGrid removes editor tab and switches to next` — should remove from editorCell, not clear whole cell.

14. `_removeFromGrid removes last editor tab and clears cell` — removing sole tab clears the cell.

### Step 2.2 — Implement LayoutEngine changes in `client/js/layout.js`

**2.2.1 — Update `_clearCell` (line ~119)**

Add an `editorCell` branch alongside the existing `folderCell` branch. After the existing `if (info.folderCell) { ... }` block, add:

```js
if (info.editorCell) {
  var self = this;
  info.editorCell.getTabs().forEach(function (t) {
    if (t.panel) {
      if (t.id === info.terminalId) {
        t.panel.detach();
      }
      self._addToMinimized(t.id, t.panel);
    }
  });
}
```

Also null out `info.editorCell` alongside `info.folderCell`:
```js
info.editorCell = null;
```

And add `cell.classList.remove('cell-editor-mode')` alongside the existing `cell.classList.remove('cell-folder-mode')`.

**2.2.2 — Add `assignEditorCell(cell, editorCell)` method**

Add after `assignFolder` (line ~706). Follow the **exact same pattern** as `assignFolder`:

```js
LayoutEngine.prototype.assignEditorCell = function (cell, editorCell) {
  var self = this;
  var mount = cell.querySelector('.cell-terminal');
  var header = cell.querySelector('.cell-header');

  cell.classList.remove('cell-empty');
  cell.classList.add('cell-editor-mode');

  var activeId = editorCell.getActiveTabId();
  var activePanel = editorCell.getActivePanel();

  this._cellMap.set(cell, {
    connection: activePanel,
    terminalId: activeId,
    editorCell: editorCell,
    folderCell: null
  });

  // Remove all editor tabs from minimized
  editorCell.getTabs().forEach(function (t) {
    self._removeFromMinimized(t.id);
  });

  editorCell.renderHeader(header, this._makeEditorCellCallbacks(cell, editorCell));

  if (activePanel) {
    activePanel.attach(mount);
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          activePanel.refit();
          activePanel.focus();
        });
      });
    }
  }

  if (this._onLayoutChange) this._onLayoutChange();
};
```

**2.2.3 — Add `_switchEditorTab(cell, tabId)` method**

Add right after `assignEditorCell`. Follow the **exact same pattern** as `_switchFolderTab`:

```js
LayoutEngine.prototype._switchEditorTab = function (cell, tabId) {
  var info = this._cellMap.get(cell);
  if (!info || !info.editorCell) return;
  var editorCell = info.editorCell;

  var result = editorCell.setActiveTab(tabId);
  if (!result) return; // already active

  var mount = cell.querySelector('.cell-terminal');
  var header = cell.querySelector('.cell-header');

  if (result.prev.panel) {
    result.prev.panel.detach();
  }

  this._cellMap.set(cell, {
    connection: result.next.panel,
    terminalId: result.next.id,
    editorCell: editorCell,
    folderCell: null
  });

  if (result.next.panel) {
    result.next.panel.attach(mount);
  }

  editorCell.updateActiveTab(header);

  var self = this;
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (result.next.panel) {
          result.next.panel.refit();
          result.next.panel.focus();
        }
      });
    });
  }

  if (this._onLayoutChange) this._onLayoutChange();
};
```

**2.2.4 — Add `_makeEditorCellCallbacks(cell, editorCell)` method**

Add right after `_switchEditorTab`. Follow the pattern of `_makeFolderCallbacks` (line ~376):

```js
LayoutEngine.prototype._makeEditorCellCallbacks = function (cell, editorCell) {
  var self = this;
  return {
    onTabClick: function (tabId) {
      self._switchEditorTab(cell, tabId);
    },
    onTabClose: function (tabId) {
      if (self._onCloseTerminal) self._onCloseTerminal(tabId);
    },
    onMore: function (x, y) {
      // future: editor-specific context menu
    },
    onSupersize: function () {
      if (self._supersizeState) {
        self.exitSupersize();
      } else {
        var activeId = editorCell.getActiveTabId();
        if (activeId) self.supersize(activeId);
      }
    },
    isSupersized: function () {
      return !!self._supersizeState;
    },
    onMinimize: function () {
      self.minimizeEditorCell(cell, editorCell);
    },
    onClose: function () {
      var activeId = editorCell.getActiveTabId();
      if (activeId && self._onCloseTerminal) self._onCloseTerminal(activeId);
    },
    onTabContextMenu: function (tabId, x, y, tabEl) {
      self._showEditorTabContextMenu(tabId, x, y, tabEl, cell, editorCell);
    }
  };
};
```

**2.2.5 — Add `minimizeEditorCell(cell, editorCell)` method**

Same pattern as `minimizeFolderCell` if it exists, or inline:

```js
LayoutEngine.prototype.minimizeEditorCell = function (cell, editorCell) {
  var self = this;
  editorCell.getTabs().forEach(function (t) {
    if (t.panel) {
      if (t.id === editorCell.getActiveTabId()) t.panel.detach();
      self._addToMinimized(t.id, t.panel);
    }
  });
  this._clearCell(cell);
  if (this._onMinimizeTerminal) this._onMinimizeTerminal();
  if (this._onLayoutChange) this._onLayoutChange();
};
```

**2.2.6 — Add `_showEditorTabContextMenu(tabId, x, y, tabEl, cell, editorCell)`**

Basic context menu with: Rename, Close, Close Others. Follow the pattern of `_showTabContextMenu` (the existing folder tab context menu). This can be a simpler initial version:

```js
LayoutEngine.prototype._showEditorTabContextMenu = function (tabId, x, y, tabEl, cell, editorCell) {
  var self = this;
  var existing = document.querySelector('.td-editor-tab-menu');
  if (existing) existing.remove();

  var menu = document.createElement('div');
  menu.className = 'ep-context-menu td-editor-tab-menu';

  function addItem(label, action, danger) {
    var el = document.createElement('div');
    el.className = 'ep-ctx-item' + (danger ? ' ep-ctx-item-danger' : '');
    el.innerHTML = '<span class="ep-ctx-item-label">' + label + '</span>';
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      dismiss();
      action();
    });
    menu.appendChild(el);
  }

  function dismiss() {
    if (menu.parentNode) menu.parentNode.removeChild(menu);
    document.removeEventListener('mousedown', outsideClick, true);
  }

  var outsideClick = function (e) {
    if (!menu.contains(e.target)) dismiss();
  };

  addItem('Close', function () {
    if (self._onCloseTerminal) self._onCloseTerminal(tabId);
  });

  addItem('Close Others', function () {
    editorCell.getTabs().forEach(function (t) {
      if (t.id !== tabId && self._onCloseTerminal) {
        self._onCloseTerminal(t.id);
      }
    });
  }, true);

  menu.style.position = 'fixed';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  document.body.appendChild(menu);
  setTimeout(function () {
    document.addEventListener('mousedown', outsideClick, true);
  }, 0);
};
```

**2.2.7 — Update `minimizeTerminal` (line ~760)**

After the existing `if (info.folderCell) { ... }` block, add a parallel `else if (info.editorCell) { ... }` block:

```js
else if (info.editorCell) {
  var editorCell = info.editorCell;
  var conn = info.connection;
  conn.detach();
  self._addToMinimized(terminalId, conn);
  var removeResult = editorCell.removeTab(terminalId);

  if (removeResult.newActiveId) {
    var newPanel = editorCell.getActivePanel();
    var mount = cell.querySelector('.cell-terminal');
    var header = cell.querySelector('.cell-header');
    self._cellMap.set(cell, {
      connection: newPanel,
      terminalId: removeResult.newActiveId,
      editorCell: editorCell,
      folderCell: null
    });
    if (newPanel) newPanel.attach(mount);
    editorCell.renderHeader(header, self._makeEditorCellCallbacks(cell, editorCell));
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (newPanel) { newPanel.refit(); newPanel.focus(); }
        });
      });
    }
  } else {
    self._clearCell(cell);
  }
}
```

**2.2.8 — Update `_removeFromGrid` (line ~832)**

Add editorCell handling. Currently this method iterates cells and calls `_clearCell`. It needs to also handle removing a single tab from an EditorCell (not clearing the whole cell). Add before the existing logic:

```js
// Check if terminalId is a tab in an editorCell
self._cells.forEach(function (cell) {
  var info = self._cellMap.get(cell);
  if (info && info.editorCell) {
    var ec = info.editorCell;
    var tabs = ec.getTabs();
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].id === terminalId) {
        var wasActive = (terminalId === ec.getActiveTabId());
        var result = ec.removeTab(terminalId);
        if (wasActive && result.newActiveId) {
          // Switch to next tab
          var newPanel = ec.getActivePanel();
          var mount = cell.querySelector('.cell-terminal');
          var header = cell.querySelector('.cell-header');
          self._cellMap.set(cell, {
            connection: newPanel,
            terminalId: result.newActiveId,
            editorCell: ec,
            folderCell: null
          });
          if (newPanel) newPanel.attach(mount);
          ec.renderHeader(header, self._makeEditorCellCallbacks(cell, ec));
        } else if (!result.newActiveId) {
          self._clearCell(cell);
        }
        return; // found and handled
      }
    }
  }
});
```

**2.2.9 — Update `refitAll` (line varies)**

In the loop where it calls `conn.refit()` for each cell, it already works because it uses `info.connection` which points to the active panel. No change needed — the existing code handles it correctly since `info.connection` is set to the active EditorPanel.

**2.2.10 — Update `setGrid` grid transition logic**

In the grid transition mapping (line ~157+), cells with `editorCell` need to be preserved at stable positions, same as `folderCell`. The existing code already does this via `_cellMap` — it preserves `info` objects. But make sure the `info` copy includes `editorCell`:

Find the section where cell info is copied during grid transition (look for where `folderCell` is referenced in `setGrid`). Ensure `editorCell` is included in any object copying. The existing code likely uses the `_cellMap` entries directly, so this may already work. Verify by running the test from 2.1 #11.

**2.2.11 — Update supersize save/restore**

In `supersize()` and `exitSupersize()`, the code saves and restores cell info including `folderCell`. Add `editorCell` to those save/restore paths. Search for `folderCell` references in the supersize methods and add parallel `editorCell` handling.

### Step 2.3 — Run tests

```bash
npx mocha client/js/layout.test.js
```

All existing tests must still pass. All new EditorCell integration tests must pass.

---

## Phase 3: App-level file routing

### Step 3.1 — Add `_lastActiveEditorCell` tracking to `App`

In `app.js`, add to the `App` constructor (line ~8):

```js
this._lastActiveEditorCell = null;   // { cell: DOMElement, editorCell: EditorCell }
this._editorCells = {};               // editorCell instance tracking (for cleanup)
```

### Step 3.2 — Update `_openFileAsEditor` (line ~1625)

Replace the current implementation that creates a standalone EditorPanel and calls `_assignToFirstEmptyCell`. New logic:

```js
App.prototype._openFileAsEditor = function (filePath) {
  var self = this;
  var absPath = '/workspace/' + filePath;

  // 1. Check if file is already open in ANY editor cell — focus it
  var existingId = this._findOpenEditorTab(absPath);
  if (existingId) {
    this._focusEditorTab(existingId);
    return;
  }

  // 2. Fetch file from server (same API call as before)
  fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath: filePath }),
  })
    .then(function (res) {
      if (!res.ok) throw new Error('Server returned ' + res.status);
      return res.json();
    })
    .then(function (file) {
      if (!file || !file.id) throw new Error('Invalid response');

      // Double-check: might have been opened while fetch was in flight
      if (self._connections[file.id]) {
        self._focusEditorTab(file.id);
        return;
      }

      var panel = new ns.EditorPanel(file);
      panel._onDirtyChange = function () {
        self._syncTerminalList();
        self._updateEditorDirtyIndicators();
      };
      self._connections[file.id] = panel;

      // 3. Route to last-active EditorCell, or create new one
      self._routeToEditorCell(file.id, file.name, panel);

      self._updateEmptyState();
      self._syncTerminalList();
    })
    .catch(function (err) {
      console.error('[app] openFileAsEditor failed:', err);
    });
};
```

### Step 3.3 — Add `_findOpenEditorTab(absPath)` helper

```js
App.prototype._findOpenEditorTab = function (absPath) {
  var self = this;
  // Check all editor cells for a tab with this file
  for (var i = 0; i < this._engine._cells.length; i++) {
    var cell = this._engine._cells[i];
    var info = this._engine._cellMap.get(cell);
    if (info && info.editorCell) {
      var tabId = info.editorCell.findTabByFile(absPath);
      if (tabId) return tabId;
    }
  }
  // Also check standalone editors (backward compat during transition)
  var keys = Object.keys(this._connections);
  for (var j = 0; j < keys.length; j++) {
    var conn = this._connections[keys[j]];
    if (conn.type === 'editor' && conn.config && conn.config.file === absPath) {
      return keys[j];
    }
  }
  return null;
};
```

### Step 3.4 — Add `_focusEditorTab(tabId)` helper

```js
App.prototype._focusEditorTab = function (tabId) {
  // Find which editor cell contains this tab and switch to it
  for (var i = 0; i < this._engine._cells.length; i++) {
    var cell = this._engine._cells[i];
    var info = this._engine._cellMap.get(cell);
    if (info && info.editorCell) {
      var tabs = info.editorCell.getTabs();
      for (var j = 0; j < tabs.length; j++) {
        if (tabs[j].id === tabId) {
          this._engine._switchEditorTab(cell, tabId);
          this._highlightCell(cell);
          this._lastActiveEditorCell = { cell: cell, editorCell: info.editorCell };
          return;
        }
      }
    }
  }
  // Fallback: might be a standalone editor in a plain cell
  this._handleTerminalListSelect(tabId);
};
```

### Step 3.5 — Add `_routeToEditorCell(fileId, fileName, panel)` — the core routing logic

```js
App.prototype._routeToEditorCell = function (fileId, fileName, panel) {
  // Strategy 1: Add to last-active EditorCell if it still exists in the grid
  if (this._lastActiveEditorCell) {
    var cell = this._lastActiveEditorCell.cell;
    var info = this._engine._cellMap.get(cell);
    if (info && info.editorCell === this._lastActiveEditorCell.editorCell) {
      // EditorCell is still alive in the grid — add tab and activate
      info.editorCell.addTab(fileId, fileName, panel, true);
      this._engine._switchEditorTab(cell, fileId);
      // Re-render header to show new tab
      var header = cell.querySelector('.cell-header');
      info.editorCell.renderHeader(header, this._engine._makeEditorCellCallbacks(cell, info.editorCell));
      this._engine._switchEditorTab(cell, fileId);
      return;
    }
    // Stale reference — clear it
    this._lastActiveEditorCell = null;
  }

  // Strategy 2: Create new EditorCell in first empty cell
  var editorCell = new ns.EditorCell([
    { id: fileId, name: fileName, panel: panel }
  ]);

  var targetCell = this._findFirstEmptyCell();
  if (targetCell) {
    this._engine.assignEditorCell(targetCell, editorCell);
    this._lastActiveEditorCell = { cell: targetCell, editorCell: editorCell };
  } else {
    // No empty cell — minimize
    this._engine._addToMinimized(fileId, panel);
  }
};
```

### Step 3.6 — Add `_findFirstEmptyCell()` helper (if not already present)

Check if this method exists. If not, extract it from `_assignToFirstEmptyCell`:

```js
App.prototype._findFirstEmptyCell = function () {
  if (!this._engine) return null;
  for (var i = 0; i < this._engine._cells.length; i++) {
    var cell = this._engine._cells[i];
    var info = this._engine._cellMap.get(cell);
    if (info && !info.connection) return cell;
  }
  return null;
};
```

### Step 3.7 — Add `_updateEditorDirtyIndicators()` helper

Called when any editor's dirty state changes:

```js
App.prototype._updateEditorDirtyIndicators = function () {
  if (!this._engine) return;
  for (var i = 0; i < this._engine._cells.length; i++) {
    var cell = this._engine._cells[i];
    var info = this._engine._cellMap.get(cell);
    if (info && info.editorCell) {
      var header = cell.querySelector('.cell-header');
      info.editorCell.updateDirtyIndicators(header);
    }
  }
};
```

### Step 3.8 — Update `_closeFilePanel` (line ~292)

The existing `_closeFilePanel` does: save → DELETE API → destroy → remove from grid. Update it to also remove the tab from its EditorCell:

After the line `self._engine._removeFromGrid(id);` the existing call will now handle editor cell tab removal (from phase 2.2.8). No additional changes needed here — `_removeFromGrid` already handles removing a single tab from an EditorCell.

### Step 3.9 — Update `_handleTerminalListSelect` (line ~1203)

Add EditorCell awareness. After the existing loop that checks `info.terminalId === id`, add a check for editor cell tabs:

```js
// Check if terminal is a tab in an editor cell
for (var i = 0; i < this._engine._cells.length; i++) {
  var cell = this._engine._cells[i];
  var info = this._engine._cellMap.get(cell);
  if (info && info.editorCell) {
    var tabs = info.editorCell.getTabs();
    for (var j = 0; j < tabs.length; j++) {
      if (tabs[j].id === id) {
        this._engine._switchEditorTab(cell, id);
        this._highlightCell(cell);
        this._lastActiveEditorCell = { cell: cell, editorCell: info.editorCell };
        return;
      }
    }
  }
}
```

Add this **before** the existing minimized-terminal restore logic (which comes after the active-in-cell check).

### Step 3.10 — Track last-active on any editor tab switch

In `_createEngine` (line ~115), when wiring up the LayoutEngine, add a new callback:

```js
this._engine._onEditorTabActivated = function (cell, editorCell) {
  self._lastActiveEditorCell = { cell: cell, editorCell: editorCell };
};
```

Then in `_switchEditorTab` in layout.js, call this callback at the end:

```js
if (this._onEditorTabActivated) this._onEditorTabActivated(cell, editorCell);
```

---

## Phase 4: CSS

### Step 4.1 — Add editor cell styles to `client/css/style.css`

Add these rules after the existing `.cell-folder-mode` block (around line 1262). They intentionally mirror the folder-mode styles:

```css
/* --- Editor Cell Mode --- */

.cell-editor-mode .cell-header {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 2px;
  background: var(--ec-bg, var(--td-header-bg, #1a1a2e));
  color: var(--ec-text, var(--td-header-color, #ccc));
}

.cell-editor-mode .cell-header-tabs {
  display: flex;
  overflow-x: auto;
  flex: 1;
  gap: 0;
  min-width: 0;
}

.cell-editor-mode .cell-header-tabs::-webkit-scrollbar {
  display: none;
}

.cell-editor-mode .cell-header-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: none;
  background: transparent;
  color: var(--ec-text, var(--td-header-color, #999));
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
}

.cell-editor-mode .cell-header-tab-active {
  color: var(--ec-hl, #fff);
  border-bottom-color: var(--ec-hl, var(--td-accent, #4fc3f7));
}

.cell-editor-mode .cell-header-tab:hover:not(.cell-header-tab-active) {
  color: var(--ec-hl, #ddd);
  background: rgba(255,255,255,0.05);
}

.cell-editor-mode .cell-header-tab-dirty {
  color: #f9a825;
  font-size: 10px;
  margin-left: -2px;
}

.cell-editor-mode .cell-header-tab-close {
  opacity: 0;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
  color: inherit;
  background: none;
  border: none;
}

.cell-editor-mode .cell-header-tab:hover .cell-header-tab-close {
  opacity: 0.6;
}

.cell-editor-mode .cell-header-tab-close:hover {
  opacity: 1 !important;
  color: #e57373;
}

.cell-editor-mode .cell-header-minimize,
.cell-editor-mode .cell-header-close,
.cell-editor-mode .cell-header-more,
.cell-editor-mode .cell-header-supersize,
.cell-editor-mode .cell-header-exit-supersize {
  color: var(--ec-text, #999);
}

.cell-editor-mode .cell-header-minimize:hover,
.cell-editor-mode .cell-header-more:hover,
.cell-editor-mode .cell-header-supersize:hover,
.cell-editor-mode .cell-header-exit-supersize:hover {
  color: var(--ec-hl, #fff);
}

.cell-editor-mode .cell-header-spacer {
  flex: 0;
}
```

---

## Phase 5: HTML script tag

### Step 5.1 — Add script tag to `client/index.html`

Find the existing `<script src="js/folder-cell.js"></script>` tag. Add immediately after it:

```html
<script src="js/editor-cell.js"></script>
```

This must come **before** `layout.js` and `app.js` since both reference `EditorCell`.

---

## Phase 6: Final integration test

### Step 6.1 — Run all tests

```bash
npx mocha client/js/editor-cell.test.js client/js/folder-cell.test.js client/js/layout.test.js
```

All must pass.

### Step 6.2 — Manual smoke test checklist

1. Open a text file from file tree → opens in a new EditorCell in first empty cell
2. Open a second file → adds as a tab in the same EditorCell
3. Click tabs to switch between files
4. Edit a file → dirty dot appears on tab
5. Save (Ctrl+S) → dirty dot disappears
6. Close a tab via the × button on the tab → remaining tabs still work
7. Close the last tab → cell becomes empty
8. Open files in a 2x2 grid with terminals in some cells → EditorCell takes first empty cell
9. Supersize an editor cell → works, exit restores tabs
10. Minimize an editor cell → all tabs go to minimized, can restore
11. Open a file that's already open in an editor cell → switches to that tab, highlights cell
12. Have 2 EditorCells in a 2x2 grid, click a tab in cell B, then open a new file → file opens in cell B (last-active routing)

---

## Implementation order summary

1. Write `editor-cell.test.js` (all 34 tests)
2. Write `editor-cell.js` (make tests pass)
3. Write EditorCell integration tests in `layout.test.js`
4. Edit `layout.js` (make integration tests pass)
5. Edit `app.js` (routing logic)
6. Edit `style.css` (editor cell styles)
7. Edit `index.html` (script tag)
8. Run all tests
9. Manual smoke test
