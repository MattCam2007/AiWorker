const fs = require('fs');
const path = require('path');
const log = require('./log');

/**
 * FileManager — tracks which workspace files are open in editor panels.
 *
 * Each open file gets an entry in config.openFiles[].  The entry records
 * an id (slug derived from the filename) and the absolute path.  Content
 * is always read from / written to the real file on disk — nothing is
 * copied or relocated.
 */
class FileManager {
  constructor(configManager) {
    this._configManager = configManager;
  }

  // --- Config helpers ---

  _getEntries() {
    const config = this._configManager.getConfig();
    return (config && config.openFiles) || [];
  }

  _findEntry(id) {
    return this._getEntries().find(function (e) { return e.id === id; }) || null;
  }

  _saveConfig(entries) {
    const configPath = this._configManager.configPath;
    let existing = {};
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
      log.error('[files] failed to read config for save:', err.message);
    }
    existing.openFiles = entries;
    try {
      fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
    } catch (err) {
      log.error('[files] failed to write config:', err.message);
      return;
    }
    this._configManager._config.openFiles = entries;
  }

  // --- Path security ---

  _isPathSafe(absPath) {
    const resolved = path.resolve(absPath);
    if (!resolved.startsWith('/workspace/')) return false;

    try {
      const real = fs.realpathSync(resolved);
      if (!real.startsWith('/workspace/')) return false;
    } catch (err) {
      // File doesn't exist yet — logical check is sufficient
    }
    return true;
  }

  // --- Public API ---

  /** List all tracked open files. */
  listFiles() {
    var self = this;
    return this._getEntries().map(function (e) {
      return {
        id: e.id,
        name: e.name,
        file: e.file,
        exists: fs.existsSync(e.file)
      };
    });
  }

  /** Get a file's content by its tracking id. */
  getFile(id) {
    var entry = this._findEntry(id);
    if (!entry) return null;
    if (!this._isPathSafe(entry.file)) return null;

    var content = '';
    try {
      content = fs.readFileSync(entry.file, 'utf-8');
    } catch (err) {
      // File may have been deleted externally
    }

    return {
      id: entry.id,
      name: entry.name,
      file: entry.file,
      content: content
    };
  }

  /** Save content to a tracked file. */
  saveFile(id, content) {
    var entry = this._findEntry(id);
    if (!entry) return null;
    if (!this._isPathSafe(entry.file)) return null;

    // Ensure parent directory exists (file may have been created fresh)
    var dir = path.dirname(entry.file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      fs.writeFileSync(entry.file, content);
    } catch (err) {
      log.error('[files] failed to write file:', err.message);
      return null;
    }

    return { success: true, saved: new Date().toISOString() };
  }

  /**
   * Open a workspace file for editing.
   * Registers it in config so the editor panel can reference it by id.
   * Returns the existing entry if the file is already tracked.
   */
  openFile(workspaceRelPath) {
    var absPath = path.resolve('/workspace', workspaceRelPath);
    if (!this._isPathSafe(absPath)) return null;

    // Return existing entry if already tracked
    var entries = this._getEntries();
    var existing = entries.find(function (e) { return e.file === absPath; });
    if (existing) return existing;

    // Generate a unique slug id
    var baseName = path.basename(workspaceRelPath).replace(/\.[^.]+$/, '') || path.basename(workspaceRelPath);
    var slug = baseName.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'file';

    var existingIds = new Set(entries.map(function (e) { return e.id; }));
    var id = slug;
    var counter = 2;
    while (existingIds.has(id)) {
      id = slug + '-' + counter;
      counter++;
    }

    var entry = { id: id, name: path.basename(workspaceRelPath), file: absPath };
    var updated = entries.slice();
    updated.push(entry);
    this._saveConfig(updated);

    return entry;
  }

  /**
   * Close a file — removes it from the tracked list.
   * Never deletes the underlying file.
   */
  closeFile(id) {
    var entry = this._findEntry(id);
    if (!entry) return null;

    var entries = this._getEntries().filter(function (e) { return e.id !== id; });
    this._saveConfig(entries);

    return { success: true };
  }
}

module.exports = { FileManager };
