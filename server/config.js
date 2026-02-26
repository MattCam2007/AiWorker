const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { deepEqual } = require('./utils');

const DEFAULT_SETTINGS = {
  theme: {
    defaultColor: '#33ff33',
    background: '#0a0a0a',
    fontFamily: 'Fira Code, monospace',
    fontSize: 14
  },
  shell: '/bin/bash'
};

class ConfigManager extends EventEmitter {
  constructor(configPath) {
    super();
    this.configPath = configPath || './config/terminaldeck.json';
    this._config = null;
    this._watcher = null;
    this._debounceTimer = null;
  }

  load() {
    try {
      this._config = this._loadAndValidate();
    } catch (err) {
      if (this._config) {
        return this._config;
      }
      throw err;
    }
    return this._config;
  }

  _loadAndValidate() {
    const raw = fs.readFileSync(this.configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    this._validate(parsed);
    return this._applyDefaults(parsed);
  }

  getConfig() {
    return this._config;
  }

  watch() {
    if (this._watcher) return;

    this._watcher = fs.watch(this.configPath, () => {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => {
        try {
          const oldConfig = this._config;
          const newConfig = this._loadAndValidate();
          this._config = newConfig;
          if (!deepEqual(oldConfig, this._config)) {
            this.emit('change', this._config, oldConfig);
          }
        } catch (err) {
          this.emit('error', err);
        }
      }, 500);
    });
  }

  stopWatching() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
    clearTimeout(this._debounceTimer);
  }

  _validate(config) {
    if (config.settings && typeof config.settings !== 'object') {
      throw new Error('"settings" must be an object');
    }
    if (config.settings) {
      const s = config.settings;
      if (s.theme !== undefined && (typeof s.theme !== 'object' || s.theme === null || Array.isArray(s.theme))) {
        throw new Error('settings.theme must be an object');
      }
      if (s.theme) {
        if (s.theme.fontSize !== undefined && (typeof s.theme.fontSize !== 'number' || s.theme.fontSize < 6 || s.theme.fontSize > 72)) {
          throw new Error('settings.theme.fontSize must be a number between 6 and 72');
        }
        if (s.theme.fontFamily !== undefined && typeof s.theme.fontFamily !== 'string') {
          throw new Error('settings.theme.fontFamily must be a string');
        }
        if (s.theme.background !== undefined && typeof s.theme.background !== 'string') {
          throw new Error('settings.theme.background must be a string');
        }
        if (s.theme.defaultColor !== undefined && typeof s.theme.defaultColor !== 'string') {
          throw new Error('settings.theme.defaultColor must be a string');
        }
      }
      if (s.shell !== undefined && typeof s.shell !== 'string') {
        throw new Error('settings.shell must be a string');
      }
    }
    // Validate notes section
    if (config.notes !== undefined) {
      if (!Array.isArray(config.notes)) {
        throw new Error('"notes" must be an array');
      }
      const noteIds = new Set();
      for (const note of config.notes) {
        if (!note.id || typeof note.id !== 'string') {
          throw new Error('Each note must have a string "id"');
        }
        if (!note.name || typeof note.name !== 'string') {
          throw new Error('Each note must have a string "name"');
        }
        if (!note.file || typeof note.file !== 'string') {
          throw new Error('Each note must have a string "file"');
        }
        if (noteIds.has(note.id)) {
          throw new Error('Duplicate note id: ' + note.id);
        }
        noteIds.add(note.id);
      }
    }
  }

  _applyDefaults(config) {
    const settings = config.settings || {};

    const theme = {
      ...DEFAULT_SETTINGS.theme,
      ...(settings.theme || {})
    };

    const mergedSettings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      theme
    };

    const result = { settings: mergedSettings };
    if (config.notes) {
      result.notes = config.notes;
    }
    return result;
  }
}

module.exports = { ConfigManager };
