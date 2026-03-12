const fs = require('fs');
const path = require('path');
const log = require('./log');

const DEFAULT_NOTES_DIR = '/workspace/.unity/notes';

class NoteManager {
  constructor(configManager, notesDir) {
    this._configManager = configManager;
    this._notesDir = notesDir || DEFAULT_NOTES_DIR;
  }

  _getNotes() {
    const config = this._configManager.getConfig();
    return (config && config.notes) || [];
  }

  _findNote(id) {
    return this._getNotes().find(function (n) { return n.id === id; }) || null;
  }

  _isPathSafe(file) {
    const logical = file.startsWith('/')
      ? path.resolve(file)
      : path.resolve(this._notesDir, file);

    // Logical path must be inside the allowed tree
    const allowedRoot = file.startsWith('/') ? '/workspace/' : this._notesDir;
    if (!logical.startsWith(allowedRoot) && logical !== this._notesDir) return false;

    // Resolve symlinks to catch links that escape the allowed directory
    try {
      const real = fs.realpathSync(logical);
      if (!real.startsWith(allowedRoot) && real !== this._notesDir) return false;
    } catch (err) {
      // File doesn't exist yet (new note) — logical check above is sufficient
    }

    return true;
  }

  _fullPath(file) {
    if (file.startsWith('/')) return file;
    return path.join(this._notesDir, file);
  }

  _ensureDir() {
    if (!fs.existsSync(this._notesDir)) {
      fs.mkdirSync(this._notesDir, { recursive: true });
    }
  }

  _saveConfig(notes) {
    const configPath = this._configManager.configPath;
    let existing = {};
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
      log.error('[notes] failed to read config for save:', err.message);
    }
    existing.notes = notes;
    try {
      fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
    } catch (err) {
      log.error('[notes] failed to write config:', err.message);
      return;
    }
    // Update the in-memory config
    this._configManager._config.notes = notes;
  }

  listNotes() {
    var notes = this._getNotes();
    var self = this;
    return notes.map(function (n) {
      var filePath = self._fullPath(n.file);
      return {
        id: n.id,
        name: n.name,
        file: n.file,
        exists: fs.existsSync(filePath)
      };
    });
  }

  getNote(id) {
    var note = this._findNote(id);
    if (!note) return null;

    if (!this._isPathSafe(note.file)) return null;

    var filePath = this._fullPath(note.file);
    var content = '';
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      // File doesn't exist yet — return empty content
    }

    return {
      id: note.id,
      name: note.name,
      file: note.file,
      content: content
    };
  }

  saveNote(id, content) {
    var note = this._findNote(id);
    if (!note) return null;

    if (!this._isPathSafe(note.file)) return null;

    this._ensureDir();
    var filePath = this._fullPath(note.file);
    try {
      fs.writeFileSync(filePath, content);
    } catch (err) {
      log.error('[notes] failed to write note file:', err.message);
      return null;
    }

    var timestamp = new Date().toISOString();
    return { success: true, saved: timestamp };
  }

  createNote(name) {
    var slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    var notes = this._getNotes().slice();
    var existingIds = new Set(notes.map(function (n) { return n.id; }));

    var id = slug;
    var counter = 2;
    while (existingIds.has(id)) {
      id = slug + '-' + counter;
      counter++;
    }

    var file = id + '.md';

    var newNote = { id: id, name: name, file: file };
    notes.push(newNote);

    this._ensureDir();
    var filePath = this._fullPath(file);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '');
    }

    this._saveConfig(notes);

    return newNote;
  }

  openFile(workspaceRelPath) {
    var absPath = path.resolve('/workspace', workspaceRelPath);
    if (!absPath.startsWith('/workspace/')) return null;

    // Resolve symlinks to prevent escaping /workspace via symlink targets
    try {
      var realPath = fs.realpathSync(absPath);
      if (!realPath.startsWith('/workspace/')) return null;
    } catch (err) {
      // File doesn't exist — logical check above is sufficient
    }

    // Return existing note if this file is already tracked
    var notes = this._getNotes();
    var existing = notes.find(function (n) { return n.file === absPath; });
    if (existing) return existing;

    var baseName = path.basename(workspaceRelPath).replace(/\.[^.]+$/, '') || path.basename(workspaceRelPath);
    var slug = baseName.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'file';

    var existingIds = new Set(notes.map(function (n) { return n.id; }));
    var id = slug;
    var counter = 2;
    while (existingIds.has(id)) {
      id = slug + '-' + counter;
      counter++;
    }

    var newNote = { id: id, name: path.basename(workspaceRelPath), file: absPath };
    var updatedNotes = notes.slice();
    updatedNotes.push(newNote);
    this._saveConfig(updatedNotes);

    return newNote;
  }

  deleteNote(id, deleteFile) {
    var note = this._findNote(id);
    if (!note) return null;

    var notes = this._getNotes().filter(function (n) { return n.id !== id; });

    // Only delete the underlying file for managed notes (relative paths inside
    // the notes dir).  Workspace files opened via the file explorer use absolute
    // paths and must not be deleted when the note entry is removed.
    if (deleteFile && !note.file.startsWith('/') && this._isPathSafe(note.file)) {
      var filePath = this._fullPath(note.file);
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        log.error('[notes] failed to delete file:', err.message);
      }
    }

    this._saveConfig(notes);

    return { success: true };
  }
}

module.exports = { NoteManager };
