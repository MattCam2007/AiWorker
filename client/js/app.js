(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  function App() {
    this._config = null;
    this._connections = {};
    this._engine = null;
    this._statusEl = null;
  }

  App.prototype.init = function () {
    var self = this;
    return fetch('/api/config')
      .then(function (res) {
        return res.json();
      })
      .then(function (config) {
        self._config = config;
        self._applyTheme(config.settings.theme);
        self._createConnections(config);
        self._createEngine();
        self._buildHeader(config);
        self._applyDefaultLayout(config);
        self._wireEphemeralDialog();
        self._updateStatus();
      });
  };

  App.prototype._applyTheme = function (theme) {
    if (!theme) return;
    var root = document.documentElement;
    if (theme.background) root.style.setProperty('--td-bg', theme.background);
    if (theme.defaultColor) root.style.setProperty('--td-color', theme.defaultColor);
    if (theme.fontFamily) root.style.setProperty('--td-font-terminal', theme.fontFamily);
    if (theme.fontSize) root.style.setProperty('--td-font-size', theme.fontSize + 'px');
  };

  App.prototype._createConnections = function (config) {
    var self = this;
    config.terminals.forEach(function (term) {
      var conn = new ns.TerminalConnection(term.id, {
        name: term.name,
        theme: config.settings.theme
      });

      // Wire callbacks
      conn._onActivity = function (id) {
        self._onActivity(id);
      };
      conn._onStatusChange = function () {
        self._updateStatus();
      };
      conn._onSessions = function (sessions) {
        self._handleSessionsUpdate(sessions);
      };
      conn._onConfigReload = function (newConfig) {
        self._handleConfigReload(newConfig);
      };

      self._connections[term.id] = conn;
    });
  };

  App.prototype._createEngine = function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    this._engine = new ns.LayoutEngine(grid, strip);
  };

  App.prototype._buildHeader = function (config) {
    var self = this;
    var presetsContainer = document.getElementById('grid-presets');
    var namedContainer = document.getElementById('named-layouts');

    if (!presetsContainer || !namedContainer) return;

    // Clear existing
    presetsContainer.innerHTML = '';
    namedContainer.innerHTML = '';

    // Grid preset buttons
    var presets = Object.keys(ns.LayoutEngine.GRID_PRESETS);
    presets.forEach(function (spec) {
      var btn = document.createElement('button');
      btn.className = 'preset-btn';
      btn.textContent = spec;
      btn.dataset.preset = spec;
      btn.addEventListener('click', function () {
        self._engine.setGrid(spec);
        self._setActivePreset(btn, presetsContainer);
      });
      presetsContainer.appendChild(btn);
    });

    // Named layout buttons
    if (config.layouts) {
      Object.keys(config.layouts).forEach(function (name) {
        var btn = document.createElement('button');
        btn.className = 'layout-btn';
        btn.textContent = name;
        btn.dataset.layout = name;
        btn.addEventListener('click', function () {
          self._engine.applyLayout(config.layouts[name], self._connections);
          self._setActiveLayout(btn, namedContainer);
        });
        namedContainer.appendChild(btn);
      });
    }
  };

  App.prototype._setActivePreset = function (activeBtn, container) {
    container.querySelectorAll('.preset-btn').forEach(function (btn) {
      btn.classList.remove('active');
    });
    activeBtn.classList.add('active');
  };

  App.prototype._setActiveLayout = function (activeBtn, container) {
    container.querySelectorAll('.layout-btn').forEach(function (btn) {
      btn.classList.remove('active');
    });
    activeBtn.classList.add('active');
  };

  App.prototype._applyDefaultLayout = function (config) {
    var defaultName = config.settings.defaultLayout;
    var layout = config.layouts[defaultName];
    if (layout) {
      this._engine.applyLayout(layout, this._connections);
    }
  };

  App.prototype._wireEphemeralDialog = function () {
    var self = this;
    var addBtn = document.getElementById('add-terminal-btn');
    var dialog = document.getElementById('ephemeral-dialog');

    if (!addBtn || !dialog) return;

    addBtn.addEventListener('click', function () {
      dialog.classList.toggle('hidden');
    });

    var createBtn = dialog.querySelector('.ephemeral-create');
    var cancelBtn = dialog.querySelector('.ephemeral-cancel');
    var nameInput = dialog.querySelector('.ephemeral-name');
    var cmdInput = dialog.querySelector('.ephemeral-command');

    if (createBtn) {
      createBtn.addEventListener('click', function () {
        var name = nameInput ? nameInput.value.trim() : '';
        var command = cmdInput ? cmdInput.value.trim() : '';
        if (!name) return;

        self._sendEphemeralCreate(name, command);
        dialog.classList.add('hidden');
        if (nameInput) nameInput.value = '';
        if (cmdInput) cmdInput.value = '';
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        dialog.classList.add('hidden');
      });
    }
  };

  App.prototype._sendEphemeralCreate = function (name, command) {
    // Send via any active connection's WS
    var keys = Object.keys(this._connections);
    for (var i = 0; i < keys.length; i++) {
      var conn = this._connections[keys[i]];
      if (conn._ws && conn._ws.readyState === WebSocket.OPEN) {
        conn._ws.send(
          JSON.stringify({ type: 'create_ephemeral', name: name, command: command })
        );
        return;
      }
    }
  };

  App.prototype._sendEphemeralDestroy = function (id) {
    var keys = Object.keys(this._connections);
    for (var i = 0; i < keys.length; i++) {
      var conn = this._connections[keys[i]];
      if (conn._ws && conn._ws.readyState === WebSocket.OPEN) {
        conn._ws.send(JSON.stringify({ type: 'destroy_ephemeral', id: id }));
        return;
      }
    }
  };

  App.prototype._handleSessionsUpdate = function (sessions) {
    var self = this;
    var currentIds = new Set(Object.keys(this._connections));
    var serverIds = new Set(sessions.map(function (s) { return s.id; }));

    // Create connections for new sessions
    sessions.forEach(function (s) {
      if (!currentIds.has(s.id)) {
        var conn = new ns.TerminalConnection(s.id, {
          name: s.name,
          theme: self._config.settings.theme,
          ephemeral: true
        });
        conn._onStatusChange = function () {
          self._updateStatus();
        };
        conn._onSessions = function (sess) {
          self._handleSessionsUpdate(sess);
        };
        self._connections[s.id] = conn;

        // Add to strip
        if (self._engine) {
          self._engine._addToStrip(s.id, conn);
        }
      }
    });

    // Remove connections for gone sessions
    currentIds.forEach(function (id) {
      if (!serverIds.has(id) && self._connections[id].config.ephemeral) {
        self._connections[id].destroy();
        if (self._engine) {
          self._engine._removeFromStrip(id);
        }
        delete self._connections[id];
      }
    });

    this._updateStatus();
  };

  App.prototype._handleConfigReload = function (newConfig) {
    this._config = newConfig;
    this._applyTheme(newConfig.settings.theme);
    this._buildHeader(newConfig);
  };

  App.prototype._onActivity = function (id) {
    // Update strip preview if terminal is minimized
    if (this._engine && this._engine._stripItems.has(id)) {
      var entry = this._engine._stripItems.get(id);
      var preview = entry.element.querySelector('.strip-preview');
      if (preview && this._connections[id]) {
        preview.textContent = this._connections[id].getLastOutput();
      }
      entry.element.classList.add('strip-item-active');
      setTimeout(function () {
        entry.element.classList.remove('strip-item-active');
      }, 600);
    }
  };

  App.prototype._updateStatus = function () {
    this._statusEl = this._statusEl || document.getElementById('connection-status');
    if (!this._statusEl) return;

    var keys = Object.keys(this._connections);
    var active = 0;
    keys.forEach(function (k) {
      if (this._connections[k].isActive()) active++;
    }.bind(this));

    this._statusEl.className = 'status-indicator';
    if (active === keys.length && keys.length > 0) {
      this._statusEl.classList.add('status-green');
    } else if (active > 0) {
      this._statusEl.classList.add('status-yellow');
    } else {
      this._statusEl.classList.add('status-red');
    }
  };

  ns.App = App;

  // Auto-init on DOMContentLoaded (skip in test environments)
  if (typeof document !== 'undefined' && !ns._noAutoInit) {
    document.addEventListener('DOMContentLoaded', function () {
      var app = new App();
      app.init();
      ns.app = app;
    });
  }
})();
