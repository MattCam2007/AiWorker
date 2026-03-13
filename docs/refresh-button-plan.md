# Plan: Add Refresh Button to Code Editor

## Overview

Add functionality to reload the latest file content from disk into the editor. Currently, the refresh button in the panel header exists but does nothing for editor panels because `EditorPanel.prototype.refresh` is an empty placeholder.

## Current State

### Key Files

| File | Purpose |
|------|---------|
| `client/js/editor-panel.js` | Main CodeMirror 6 editor panel (1474 lines) |
| `client/js/layout.js` | Layout engine that creates panel headers with refresh button |

### Current Implementation

1. **Refresh Button Location** (`layout.js:291-299`)
   - A refresh button (↻) already exists in the panel header
   - It calls `connection.refresh()` on click
   - Works for terminals, but does nothing for editors

2. **Editor refresh() Method** (`editor-panel.js:256`)
   ```javascript
   EditorPanel.prototype.refresh = function () {};
   ```
   - Empty placeholder method
   - Exists to match `TerminalConnection` interface

3. **Content Loading** (`editor-panel.js:1363-1384`)
   - `_loadContent()` fetches file content from `/api/notes/{id}`
   - Only called once during mount
   - No mechanism to reload after initial load

## Implementation Plan

### Step 1: Implement the `refresh()` Method

**File:** `client/js/editor-panel.js`

**Location:** Replace line 256

**Current:**
```javascript
EditorPanel.prototype.refresh = function () {};
```

**New Implementation:**
```javascript
EditorPanel.prototype.refresh = function () {
  if (!this._cmView || this._destroyed) return;
  
  var self = this;
  
  if (this._dirty) {
    if (!confirm('You have unsaved changes. Reload from disk and discard changes?')) {
      return;
    }
  }
  
  this._updateStatus('Reloading...');
  
  fetch('/api/notes/' + encodeURIComponent(this.id))
    .then(function (res) {
      if (!res.ok) throw new Error('Failed to load file');
      return res.json();
    })
    .then(function (data) {
      if (self._destroyed || !self._cmView) return;
      
      var content = data.content || '';
      
      self._cmView.dispatch({
        changes: { from: 0, to: self._cmView.state.doc.length, insert: content }
      });
      
      self._lastSavedContent = content;
      self._dirty = false;
      self._initialLoad = false;
      self._updateStatus('Reloaded');
      
      if (self._onDirtyChange) self._onDirtyChange(false);
      self._updatePreview();
    })
    .catch(function (err) {
      console.error('[editor-panel] refresh failed:', err);
      self._updateStatus('Reload failed');
    });
};
```

### Step 2: Add Visual Feedback (Optional Enhancement)

**File:** `client/js/editor-panel.js`

Add a loading state indicator during refresh:

1. Add a `_loading` instance property in constructor
2. Disable editor during refresh operation
3. Show spinner in status bar

### Step 3: Update Documentation

**File:** `docs/code-editor.md`

Add documentation for the refresh feature:
- Explain what the refresh button does
- Note that it reloads from disk
- Warn about unsaved changes behavior

## Implementation Details

### Dirty Check Behavior

When the user clicks refresh:
1. If editor has unsaved changes (`_dirty === true`)
2. Show confirm dialog: "You have unsaved changes. Reload from disk and discard changes?"
3. If user cancels, abort the refresh
4. If user confirms, proceed with reload

### Status Updates

During refresh operation:
1. Status shows "Reloading..."
2. On success: "Reloaded" (briefly, then may change to "Saved")
3. On failure: "Reload failed"

### API Endpoint

Uses existing endpoint: `GET /api/notes/{id}`
- Returns `{ content: string, ... }`
- Already used by `_loadContent()`

### Error Handling

- Network errors: Log to console, show "Reload failed" status
- HTTP errors: Same handling
- Editor destroyed during fetch: Silently ignore

## Testing Checklist

- [ ] Refresh loads latest content from disk
- [ ] Confirm dialog appears when there are unsaved changes
- [ ] Confirm dialog cancel aborts the refresh
- [ ] Confirm dialog confirm proceeds with refresh
- [ ] Status updates correctly during operation
- [ ] No refresh when editor is destroyed
- [ ] Works for all supported file types
- [ ] Cursor position handling (optional: restore position after refresh)

## Future Enhancements (Out of Scope)

1. **File watching**: Auto-detect external changes and prompt user
2. **Diff view**: Show differences between editor content and disk
3. **Cursor preservation**: Maintain cursor position after refresh
4. **Undo stack**: Clear or preserve undo history after refresh
