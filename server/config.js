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

  getShortcuts(cwd) {
    const config = this._config;
    if (!config || !config.shortcuts) {
      return [];
    }

    const { global: globalShortcuts, projects } = config.shortcuts;
    const result = [];

    // Find matching project shortcuts (use longest path match)
    if (cwd && projects) {
      let bestMatch = '';
      for (const projPath of Object.keys(projects)) {
        if ((cwd === projPath || cwd.startsWith(projPath + '/')) && projPath.length > bestMatch.length) {
          bestMatch = projPath;
        }
      }
      if (bestMatch && projects[bestMatch]) {
        for (const shortcut of projects[bestMatch]) {
          result.push({ ...shortcut, source: 'project' });
        }
      }
    }

    // Append global shortcuts
    if (globalShortcuts) {
      for (const shortcut of globalShortcuts) {
        result.push({ ...shortcut, source: 'global' });
      }
    }

    return result;
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

    // Validate shortcuts section
    if (config.shortcuts !== undefined) {
      if (typeof config.shortcuts !== 'object' || config.shortcuts === null || Array.isArray(config.shortcuts)) {
        throw new Error('"shortcuts" must be an object');
      }
      if (config.shortcuts.global !== undefined && !Array.isArray(config.shortcuts.global)) {
        throw new Error('shortcuts.global must be an array');
      }
      if (config.shortcuts.projects !== undefined) {
        if (typeof config.shortcuts.projects !== 'object' || config.shortcuts.projects === null || Array.isArray(config.shortcuts.projects)) {
          throw new Error('shortcuts.projects must be an object');
        }
        for (const [projPath, projShortcuts] of Object.entries(config.shortcuts.projects)) {
          if (!Array.isArray(projShortcuts)) {
            throw new Error(`project "${projPath}" shortcuts must be an array`);
          }
          projShortcuts.forEach((s) => this._validateShortcut(s));
        }
      }
      if (config.shortcuts.global) {
        config.shortcuts.global.forEach((s) => this._validateShortcut(s));
      }
    }
  }

  _validateShortcut(shortcut) {
    if (!shortcut.name) {
      throw new Error('shortcut must have a "name" field');
    }
    if (typeof shortcut.name !== 'string') {
      throw new Error('shortcut "name" must be a string');
    }
    if (!shortcut.command) {
      throw new Error('shortcut must have a "command" field');
    }
    if (typeof shortcut.command !== 'string') {
      throw new Error('shortcut "command" must be a string');
    }
    if (shortcut.aliases !== undefined) {
      if (!Array.isArray(shortcut.aliases)) {
        throw new Error('shortcut "aliases" must be an array');
      }
      for (const alias of shortcut.aliases) {
        if (typeof alias !== 'string') {
          throw new Error('each alias must be a string');
        }
      }
    }
    if (shortcut.icon !== undefined && typeof shortcut.icon !== 'string') {
      throw new Error('shortcut "icon" must be a string');
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

    const shortcuts = {
      global: (config.shortcuts && config.shortcuts.global) || [],
      projects: (config.shortcuts && config.shortcuts.projects) || {}
    };

    return { settings: mergedSettings, shortcuts };
  }
}

module.exports = { ConfigManager };
