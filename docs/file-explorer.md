# File Explorer

The sidebar file explorer (`client/js/filetree.js`) is a lazy-loading file tree that supports full file management operations via a context menu.

## Features

- Browse directories under `/workspace` (lazy-loads on expand)
- Click a file to open it in an editor panel
- Right-click any file or folder to get a context menu with management actions
- Inline rename (no modal dialogs)
- Inline create (new file/folder input appears in-tree)
- Cut/copy/paste for move and copy operations
- Visual feedback: cut items are dimmed with `.ft-cut` class

## Context Menu

### File items

| Action | Description |
|--------|-------------|
| Rename | Inline rename input; Enter commits, Escape cancels |
| Delete | Confirms via `window.confirm`, then deletes |
| Cut | Marks item for move (dimmed); paste to complete |
| Copy | Marks item for copy; paste to complete |

### Folder items

| Action | Description |
|--------|-------------|
| New File | Inline input at top of folder; Enter creates, Escape cancels |
| New Folder | Same as New File but creates a directory |
| Rename | Inline rename |
| Delete | Recursive delete with confirmation |
| Cut | Marks folder for move |
| Copy | Marks folder for copy (recursive) |
| Paste | Visible only when clipboard is set; moves or copies into this folder |

## Keyboard Shortcuts

| Key | Effect |
|-----|--------|
| Escape | Dismiss context menu OR cancel inline rename/create input |
| Enter | Commit inline rename or create |

## API Endpoints

All mutations use `POST`. Bodies and responses are JSON.

| Endpoint | Body | Success | Errors |
|----------|------|---------|--------|
| `POST /api/fileops/create` | `{parent, name, type:'file'\|'dir'}` | 201 + entry | 400 (invalid), 403 (traversal), 409 (exists) |
| `POST /api/fileops/rename` | `{path, newName}` | 200 + entry | 400, 403, 404 |
| `POST /api/fileops/delete` | `{path}` | 200 `{success:true}` | 403, 404 |
| `POST /api/fileops/copy` | `{src, destDir}` | 200 + entry | 403, 404 |
| `POST /api/fileops/move` | `{src, destDir}` | 200 + entry | 403, 404 |

Entry shape: `{ name, path, type: 'file'|'dir' }` where `path` is relative to `/workspace`.

## Security

- All paths are resolved and validated against `/workspace` (path traversal returns 403)
- Symlink targets are checked to prevent escaping the workspace root
- Names reject: empty, `/`, `\`, null bytes, leading `.`

## Server Module

`server/fileops.js` exports `createFileOps(workspaceRoot)` — a factory that returns all file operation methods. Using a factory with an injected root makes the module fully testable against tmp directories.
