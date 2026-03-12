(function () {
  'use strict';
  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  var STORAGE_KEY = 'td-editor-settings';

  var DEFAULTS = {
    theme: 'oneDark',
    tabSize: 2,
    useTabs: false,
    lineWrap: false,
    vimMode: false,
    autocomplete: true,
    minimap: false,
    fontSize: 14,
  };

  function EditorSettings() {
    this._listeners = [];
    this._settings = {};
    // Deep copy defaults
    for (var k in DEFAULTS) {
      this._settings[k] = DEFAULTS[k];
    }
    this._load();
  }

  EditorSettings.prototype._load = function () {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        var parsed = JSON.parse(stored);
        for (var k in DEFAULTS) {
          if (parsed.hasOwnProperty(k)) {
            this._settings[k] = parsed[k];
          }
        }
      }
    } catch (e) { /* ignore corrupt data */ }
  };

  EditorSettings.prototype._save = function () {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._settings));
    } catch (e) { /* ignore quota errors */ }
  };

  EditorSettings.prototype.get = function (key) {
    return this._settings[key];
  };

  EditorSettings.prototype.set = function (key, value) {
    if (this._settings[key] === value) return;
    this._settings[key] = value;
    this._save();
    for (var i = 0; i < this._listeners.length; i++) {
      try { this._listeners[i](key, value); } catch (e) { console.error('[editor-settings] listener error:', e); }
    }
  };

  EditorSettings.prototype.getAll = function () {
    var copy = {};
    for (var k in this._settings) copy[k] = this._settings[k];
    return copy;
  };

  EditorSettings.prototype.onChange = function (fn) {
    this._listeners.push(fn);
    var listeners = this._listeners;
    return function () {
      var idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  };

  EditorSettings.prototype.reset = function () {
    for (var k in DEFAULTS) {
      this.set(k, DEFAULTS[k]);
    }
  };

  EditorSettings.prototype.getDefaults = function () {
    var copy = {};
    for (var k in DEFAULTS) copy[k] = DEFAULTS[k];
    return copy;
  };

  // Singleton instance
  ns.editorSettings = new EditorSettings();
  ns.EditorSettings = EditorSettings;
  ns.EDITOR_DEFAULTS = DEFAULTS;
}());
