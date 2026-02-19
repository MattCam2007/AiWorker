(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  function App() {
    this._config = null;
    this._connections = {};
    this._engine = null;
    this._statusEl = null;
    this._controlWs = null;
    this._fileTree = null;
  }

  App.prototype.init = function () {
    var self = this;

    // Fetch config for theme, then load sessions and set up UI
    return fetch('/api/config')
      .then(function (res) { return res.json(); })
      .then(function (config) {
        self._config = config;
        self._applyTheme(config.settings.theme);
        self._createEngine();
        self._buildHeader();
        self._wireCreateDialog();
        self._initFileTree();
        self._wireSidebarToggle();
        self._connectControl();

        return self._loadSessions();
      })
      .then(function () {
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

  App.prototype._createEngine = function () {
    var self = this;
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    this._engine = new ns.LayoutEngine(grid, strip);
    this._engine._onCloseTerminal = function (id) {
      self._sendDestroyTerminal(id);
    };
    this._engine.setGrid('2x2');
  };

  App.prototype._buildHeader = function () {
    var self = this;
    var presetsContainer = document.getElementById('grid-presets');
    if (!presetsContainer) return;

    presetsContainer.innerHTML = '';

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
  };

  App.prototype._setActivePreset = function (activeBtn, container) {
    container.querySelectorAll('.preset-btn').forEach(function (btn) {
      btn.classList.remove('active');
    });
    activeBtn.classList.add('active');
  };

  // --- Control WebSocket ---

  App.prototype._connectControl = function () {
    var self = this;
    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var host = window.location.host || 'localhost:3000';
    var url = protocol + '//' + host + '/ws/control';

    this._controlWs = new WebSocket(url);

    this._controlWs.addEventListener('message', function (event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      switch (msg.type) {
        case 'sessions':
          self._handleSessionsUpdate(msg.sessions);
          break;
        case 'config_reload':
          self._handleConfigReload(msg.config);
          break;
        case 'activity':
          self._handleActivity(msg);
          break;
      }
    });

    this._controlWs.addEventListener('close', function () {
      // Reconnect after a short delay
      setTimeout(function () {
        self._connectControl();
      }, 2000);
    });
  };

  App.prototype._sendCreateTerminal = function (name, command) {
    if (this._controlWs && this._controlWs.readyState === WebSocket.OPEN) {
      this._controlWs.send(
        JSON.stringify({ type: 'create_terminal', name: name, command: command })
      );
    }
  };

  App.prototype._sendDestroyTerminal = function (id) {
    if (this._controlWs && this._controlWs.readyState === WebSocket.OPEN) {
      this._controlWs.send(JSON.stringify({ type: 'destroy_terminal', id: id }));
    }
  };

  // --- Session loading ---

  App.prototype._loadSessions = function () {
    var self = this;
    return fetch('/api/sessions')
      .then(function (res) { return res.json(); })
      .then(function (sessions) {
        self._applySessions(sessions);
      });
  };

  App.prototype._applySessions = function (sessions) {
    var self = this;
    sessions.forEach(function (s) {
      if (self._connections[s.id]) return;
      var conn = self._createConnection(s.id, s.name);
      self._connections[s.id] = conn;
      self._assignToFirstEmptyCell(s.id, conn);
    });
    this._updateEmptyState();

    // Refit after the browser completes a full rendering cycle.
    // Double-rAF ensures container geometry is finalized before measuring.
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (self._engine) self._engine.refitAll();
        });
      });
    }
  };

  App.prototype._createConnection = function (id, name) {
    var self = this;
    var conn = new ns.TerminalConnection(id, {
      name: name,
      theme: self._config.settings.theme
    });

    conn._onActivity = function (termId) {
      self._onActivity(termId);
    };
    conn._onStatusChange = function () {
      self._updateStatus();
    };

    return conn;
  };

  App.prototype._assignToFirstEmptyCell = function (id, conn) {
    if (!this._engine) return;

    // Try to find an empty grid cell
    for (var i = 0; i < this._engine._cells.length; i++) {
      var cell = this._engine._cells[i];
      var info = this._engine._cellMap.get(cell);
      if (info && !info.connection) {
        this._engine.assignTerminal(cell, id, conn);
        return;
      }
    }

    // No empty cell — add to strip
    this._engine._addToStrip(id, conn);
  };

  // --- Session updates from server ---

  App.prototype._handleSessionsUpdate = function (sessions) {
    var self = this;
    var currentIds = new Set(Object.keys(this._connections));
    var serverIds = new Set(sessions.map(function (s) { return s.id; }));

    // Create connections for new sessions
    sessions.forEach(function (s) {
      if (!currentIds.has(s.id)) {
        var conn = self._createConnection(s.id, s.name);
        self._connections[s.id] = conn;
        self._assignToFirstEmptyCell(s.id, conn);
      }
    });

    // Refit after the browser completes a full rendering cycle.
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (self._engine) self._engine.refitAll();
        });
      });
    }

    // Remove connections for gone sessions
    currentIds.forEach(function (id) {
      if (!serverIds.has(id)) {
        self._connections[id].destroy();
        if (self._engine) {
          self._engine._removeFromGrid(id);
          self._engine._removeFromStrip(id);
        }
        delete self._connections[id];
      }
    });

    this._updateEmptyState();
    this._updateStatus();
  };

  App.prototype._handleConfigReload = function (newConfig) {
    this._config = newConfig;
    this._applyTheme(newConfig.settings.theme);
  };

  // --- Create terminal dialog ---

  App.prototype._wireCreateDialog = function () {
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

        self._sendCreateTerminal(name, command);
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

  // --- Empty state ---

  App.prototype._updateEmptyState = function () {
    var grid = document.getElementById('grid-container');
    if (!grid) return;

    var existing = grid.querySelector('.empty-state');
    var hasConnections = Object.keys(this._connections).length > 0;

    if (!hasConnections && !existing) {
      var msg = document.createElement('div');
      msg.className = 'empty-state';
      msg.textContent = 'No terminals. Click + to create one.';
      grid.appendChild(msg);
    } else if (hasConnections && existing) {
      existing.remove();
    }
  };

  // --- Activity ---

  App.prototype._handleActivity = function (activityMsg) {
    var self = this;
    var statuses = activityMsg.statuses || {};

    Object.keys(statuses).forEach(function (id) {
      var active = statuses[id];

      if (self._engine && self._engine._stripItems.has(id)) {
        var entry = self._engine._stripItems.get(id);
        var dot = entry.element.querySelector('.strip-status');
        if (dot) {
          if (active) {
            dot.classList.add('status-active');
            dot.classList.remove('status-idle');
          } else {
            dot.classList.remove('status-active');
            dot.classList.add('status-idle');
          }
        }

        if (active) {
          entry.element.classList.add('strip-item-active');
          setTimeout(function () {
            entry.element.classList.remove('strip-item-active');
          }, 600);
        }
      }
    });
  };

  App.prototype._onActivity = function (id) {
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

  // --- Status indicator ---

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

  // --- File tree sidebar ---

  App.prototype._initFileTree = function () {
    var self = this;
    var container = document.getElementById('file-tree');
    if (!container || !ns.FileTree) return;

    this._fileTree = new ns.FileTree(container, {
      onFileClick: function (filePath, fileName) {
        self._openFileInEditor(filePath, fileName);
      }
    });
    this._fileTree.init();
  };

  App.prototype._wireSidebarToggle = function () {
    var self = this;
    var sidebar = document.getElementById('sidebar');
    var toggleBtn = document.getElementById('sidebar-toggle-btn');
    var closeBtn = document.getElementById('sidebar-close-btn');

    if (!sidebar || !toggleBtn) return;

    function toggle() {
      sidebar.classList.toggle('hidden');
      // Refit terminals after sidebar animation completes
      setTimeout(function () {
        if (self._engine) {
          self._engine._cells.forEach(function (cell) {
            var info = self._engine._cellMap.get(cell);
            if (info && info.connection) {
              info.connection.refit();
            }
          });
        }
      }, 250);
    }

    toggleBtn.addEventListener('click', toggle);
    if (closeBtn) {
      closeBtn.addEventListener('click', toggle);
    }
  };

  App.prototype._openFileInEditor = function (filePath, fileName) {
    this._sendCreateTerminal(fileName, 'vi /workspace/' + filePath);
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
