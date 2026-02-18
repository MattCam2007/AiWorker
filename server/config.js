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
  shell: '/bin/bash',
  defaultLayout: 'default'
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
    if (!config.terminals || !Array.isArray(config.terminals)) {
      throw new Error('Config must have a "terminals" array');
    }
    if (!config.layouts || typeof config.layouts !== 'object') {
      throw new Error('Config must have a "layouts" object');
    }

    // Validate unique terminal IDs
    const ids = new Set();
    for (const terminal of config.terminals) {
      if (ids.has(terminal.id)) {
        throw new Error(`Duplicate terminal ID: "${terminal.id}"`);
      }
      ids.add(terminal.id);
    }

    // Validate layout cell references
    for (const [layoutName, layout] of Object.entries(config.layouts)) {
      if (!layout.cells) continue;
      for (const row of layout.cells) {
        for (const cellId of row) {
          if (!ids.has(cellId)) {
            throw new Error(
              `Layout "${layoutName}" references nonexistent terminal ID: "${cellId}"`
            );
          }
        }
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

    const terminals = config.terminals.map((t) => ({
      autoStart: false,
      workingDir: '/home',
      ...t
    }));

    return {
      settings: mergedSettings,
      terminals,
      layouts: config.layouts
    };
  }
}

module.exports = { ConfigManager };
