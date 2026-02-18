const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const DEFAULT_SETTINGS = {
  theme: {
    defaultColor: '#33ff33',
    background: '#0a0a0a',
    fontFamily: 'Fira Code, monospace',
    fontSize: 14
  },
  shell: '/bin/bash'
};

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

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

    return { settings: mergedSettings };
  }
}

module.exports = { ConfigManager };
