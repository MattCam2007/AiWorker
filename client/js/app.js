(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  // --- Init ---

  function App() {
    this._config = null;
    this._connections = {};  // id -> TerminalConnection or NotePanel
    this._engine = null;
    this._statusEl = null;
    this._controlWs = null;
    this._fileTree = null;
    this._terminalList = null;
  }

  App.prototype.init = function () {
    var self = this;

    // Fetch config for theme, then load sessions and set up UI
    return fetch('/api/config')
      .then(function (res) { return res.json(); })
      .then(function (config) {
        self._config = config;
        ns._serverToken = config.serverToken || '';
        self._applyTheme(config.settings.theme);
        self._createEngine();
        self._buildHeader();
        self._wireCreateDialog();
        self._initFileTree();
        self._initTerminalList();
        self._initSidebarSections();
        self._wireSidebarToggle();
        self._wireOrientationChange();
        self._initMobileToolbar();
        self._connectControl();

        return self._loadSessions();
      })
      .then(function () {
        return self._loadNotes();
      })
      .then(function () {
        self._updateStatus();
        self._wireBeforeUnload();
      })
      .catch(function (err) {
        console.error('[app] init error:', err);
        var statusEl = document.getElementById('connection-status');
        if (statusEl) {
          statusEl.className = 'status-indicator status-red';
        }
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
    this._engine = new ns.LayoutEngine(grid);
    this._engine._onCloseTerminal = function (id) {
      var conn = self._connections[id];
      if (conn && conn.type === 'note') {
        // For notes, close just minimizes (doesn't destroy)
        self._engine.minimizeTerminal(id);
      } else {
        self._sendDestroyTerminal(id);
      }
    };
    this._engine._onMinimizeTerminal = function () {
      self._syncTerminalList();
    };
    this._engine._onUpdateTerminal = function (id, name, headerBg, headerColor) {
      self._sendUpdateTerminal(id, name, headerBg, headerColor);
    };
    this._engine._onLayoutChange = function () {
      self._syncTerminalList();
    };
    this._engine._onCreateTerminal = function (cell) {
      self._pendingCell = cell;
      self._showCreateDialog();
    };

    // On mobile, force 1x1 grid; otherwise default to 2x2
    if (!this._engine.checkMobile()) {
      this._engine.setGrid('2x2');
    }
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
        self._engine.clearSupersize();
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
    var url = protocol + '//' + host + '/ws/control?t=' + encodeURIComponent(ns._serverToken || '');

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
        case 'note_saved':
          self._handleNoteSaved(msg);
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

  App.prototype._sendCreateTerminal = function (name, command, headerBg, headerColor) {
    if (this._controlWs && this._controlWs.readyState === WebSocket.OPEN) {
      this._controlWs.send(
        JSON.stringify({
          type: 'create_terminal',
          name: name,
          command: command,
          headerBg: headerBg || null,
          headerColor: headerColor || null
        })
      );
    }
  };

  App.prototype._sendDestroyTerminal = function (id) {
    if (this._controlWs && this._controlWs.readyState === WebSocket.OPEN) {
      this._controlWs.send(JSON.stringify({ type: 'destroy_terminal', id: id }));
    }
  };

  App.prototype._sendUpdateTerminal = function (id, name, headerBg, headerColor) {
    if (this._controlWs && this._controlWs.readyState === WebSocket.OPEN) {
      this._controlWs.send(JSON.stringify({
        type: 'update_terminal',
        id: id,
        name: name,
        headerBg: headerBg,
        headerColor: headerColor
      }));
    }
  };

  // --- Session Management ---

  App.prototype._loadSessions = function () {
    var self = this;
    return fetch('/api/sessions')
      .then(function (res) { return res.json(); })
      .then(function (sessions) {
        self._applySessions(sessions);
      })
      .catch(function (err) {
        console.error('[app] loadSessions error:', err);
      });
  };

  App.prototype._applySessions = function (sessions) {
    var self = this;
    sessions.forEach(function (s) {
      if (self._connections[s.id]) return;
      var conn = self._createConnection(s.id, s.name, s.headerBg, s.headerColor);
      self._connections[s.id] = conn;
      self._assignToFirstEmptyCell(s.id, conn);
    });
    this._updateEmptyState();
    this._syncTerminalList();

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

  App.prototype._createConnection = function (id, name, headerBg, headerColor) {
    var self = this;
    var conn = new ns.TerminalConnection(id, {
      name: name,
      theme: self._config.settings.theme,
      headerBg: headerBg || null,
      headerColor: headerColor || null
    });

    conn._onStatusChange = function () {
      self._updateStatus();
    };

    return conn;
  };

  App.prototype._assignToFirstEmptyCell = function (id, conn) {
    if (!this._engine) return;

    // If a specific cell was requested (from cell '+' button), use it
    if (this._pendingCell) {
      var pendingInfo = this._engine._cellMap.get(this._pendingCell);
      if (pendingInfo && !pendingInfo.connection) {
        var cell = this._pendingCell;
        this._pendingCell = null;
        this._engine.assignTerminal(cell, id, conn);
        return;
      }
      this._pendingCell = null;
    }

    // Try to find an empty grid cell
    for (var i = 0; i < this._engine._cells.length; i++) {
      var cell = this._engine._cells[i];
      var info = this._engine._cellMap.get(cell);
      if (info && !info.connection) {
        this._engine.assignTerminal(cell, id, conn);
        return;
      }
    }

    // No empty cell — minimize
    this._engine._addToMinimized(id, conn);
  };

  // --- Session Updates ---

  App.prototype._handleSessionsUpdate = function (sessions) {
    var self = this;
    var currentIds = new Set(Object.keys(this._connections));
    var serverIds = new Set(sessions.map(function (s) { return s.id; }));

    // Create connections for new sessions, update existing ones
    sessions.forEach(function (s) {
      if (!currentIds.has(s.id)) {
        var conn = self._createConnection(s.id, s.name, s.headerBg, s.headerColor);
        self._connections[s.id] = conn;
        self._assignToFirstEmptyCell(s.id, conn);
      } else {
        // Update existing connection config and header
        var conn = self._connections[s.id];
        conn.config.name = s.name;
        conn.config.headerBg = s.headerBg || null;
        conn.config.headerColor = s.headerColor || null;
        if (self._engine) {
          self._engine.updateHeader(s.id, s.name, s.headerBg, s.headerColor);
        }
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

    // Remove connections for gone sessions (but not notes)
    currentIds.forEach(function (id) {
      if (!serverIds.has(id)) {
        var conn = self._connections[id];
        // Don't remove note panels — they're managed separately
        if (conn && conn.type === 'note') return;
        conn.destroy();
        if (self._engine) {
          self._engine._removeFromGrid(id);
          self._engine._removeFromMinimized(id);
        }
        delete self._connections[id];
      }
    });

    this._updateEmptyState();
    this._updateStatus();
    this._syncTerminalList();
  };

  App.prototype._handleConfigReload = function (newConfig) {
    this._config = newConfig;
    this._applyTheme(newConfig.settings.theme);
  };

  // --- Create Dialog ---

  App.prototype._buildNameField = function () {
    var nameLabel = document.createElement('label');
    nameLabel.className = 'edit-label';
    nameLabel.textContent = 'Name';

    var nameInput = document.createElement('input');
    nameInput.className = 'edit-name-input';
    nameInput.type = 'text';
    nameInput.placeholder = 'Session name';
    nameInput.value = this._nextDefaultName();

    return { nameLabel: nameLabel, nameInput: nameInput };
  };

  App.prototype._buildCommandField = function () {
    var cmdLabelRow = document.createElement('div');
    cmdLabelRow.className = 'ephemeral-label-row';

    var cmdLabel = document.createElement('label');
    cmdLabel.className = 'edit-label';
    cmdLabel.textContent = 'Command';
    cmdLabelRow.appendChild(cmdLabel);

    var infoBtn = document.createElement('button');
    infoBtn.className = 'ephemeral-info-btn';
    infoBtn.type = 'button';
    infoBtn.textContent = 'i';
    infoBtn.title = 'Command help';
    cmdLabelRow.appendChild(infoBtn);

    var cmdInput = document.createElement('input');
    cmdInput.className = 'edit-name-input';
    cmdInput.type = 'text';
    cmdInput.placeholder = 'Optional';

    var infoTip = document.createElement('div');
    infoTip.className = 'ephemeral-info-tip hidden';
    infoTip.innerHTML =
      '<strong>Command</strong> sets the initial process for this terminal session. ' +
      'Leave blank to start your default shell.<br><br>' +
      '<strong>Examples:</strong><br>' +
      '<code>htop</code> &mdash; system monitor<br>' +
      '<code>python3</code> &mdash; Python REPL<br>' +
      '<code>tail -f /var/log/syslog</code> &mdash; follow a log<br>' +
      '<code>ssh user@host</code> &mdash; remote connection<br><br>' +
      'The command runs inside a tmux session. When the command exits, the terminal closes.';

    infoBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      infoTip.classList.toggle('hidden');
    });

    return { cmdInput: cmdInput, cmdLabelRow: cmdLabelRow, infoTip: infoTip };
  };

  App.prototype._wireCreateDialog = function () {
    var self = this;
    var addBtn = document.getElementById('add-terminal-btn');

    if (!addBtn) return;

    addBtn.addEventListener('click', function () {
      self._showCreateDialog();
    });
  };

  App.prototype._showCreateDialog = function () {
    var self = this;
    var dialog = document.getElementById('ephemeral-dialog');
    var backdrop = document.getElementById('ephemeral-backdrop');
    if (!dialog) return;

    // Build dialog contents
    dialog.innerHTML = '';
    var createType = 'terminal';

    var title = document.createElement('div');
    title.className = 'ephemeral-title';
    title.textContent = 'New Panel';
    dialog.appendChild(title);

    // Type selector
    var typeRow = document.createElement('div');
    typeRow.className = 'ephemeral-type-row';

    var terminalTypeBtn = document.createElement('button');
    terminalTypeBtn.className = 'ephemeral-type-btn ephemeral-type-active';
    terminalTypeBtn.textContent = 'Terminal';
    typeRow.appendChild(terminalTypeBtn);

    var noteTypeBtn = document.createElement('button');
    noteTypeBtn.className = 'ephemeral-type-btn';
    noteTypeBtn.textContent = 'Note';
    typeRow.appendChild(noteTypeBtn);

    dialog.appendChild(typeRow);

    // Name field
    var nameField = self._buildNameField();
    var nameLabel = nameField.nameLabel;
    var nameInput = nameField.nameInput;
    dialog.appendChild(nameLabel);
    dialog.appendChild(nameInput);

    // Command field with info icon (terminal only)
    var cmdField = self._buildCommandField();
    var cmdLabelRow = cmdField.cmdLabelRow;
    var cmdInput = cmdField.cmdInput;
    var infoTip = cmdField.infoTip;
    dialog.appendChild(cmdLabelRow);
    dialog.appendChild(cmdInput);
    dialog.appendChild(infoTip);

    // Header background color (terminal only)
    var selectedBg = null;
    var selectedColor = null;
    var terminalOnlyEls = [];

    if (this._engine) {
      var bgLabel = document.createElement('label');
      bgLabel.className = 'edit-label';
      bgLabel.textContent = 'Header Background';
      dialog.appendChild(bgLabel);
      terminalOnlyEls.push(bgLabel);

      var bgSwatches = this._engine._createColorSwatches(null, function (color) {
        selectedBg = color;
      });
      dialog.appendChild(bgSwatches);
      terminalOnlyEls.push(bgSwatches);

      // Header text color
      var textLabel = document.createElement('label');
      textLabel.className = 'edit-label';
      textLabel.textContent = 'Header Text';
      dialog.appendChild(textLabel);
      terminalOnlyEls.push(textLabel);

      var textSwatches = this._engine._createColorSwatches(null, function (color) {
        selectedColor = color;
      });
      dialog.appendChild(textSwatches);
      terminalOnlyEls.push(textSwatches);
    }

    // Track terminal-only elements for visibility toggling
    terminalOnlyEls.push(cmdLabelRow, cmdInput, infoTip);

    function setType(type) {
      createType = type;
      if (type === 'terminal') {
        terminalTypeBtn.classList.add('ephemeral-type-active');
        noteTypeBtn.classList.remove('ephemeral-type-active');
        terminalOnlyEls.forEach(function (el) { el.style.display = ''; });
        nameInput.placeholder = 'Session name';
        nameInput.value = self._nextDefaultName();
      } else {
        noteTypeBtn.classList.add('ephemeral-type-active');
        terminalTypeBtn.classList.remove('ephemeral-type-active');
        terminalOnlyEls.forEach(function (el) { el.style.display = 'none'; });
        nameInput.placeholder = 'Note name';
        nameInput.value = 'New Note';
      }
      nameInput.focus();
      nameInput.select();
    }

    terminalTypeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setType('terminal');
    });
    noteTypeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setType('note');
    });

    // Buttons
    var btnRow = document.createElement('div');
    btnRow.className = 'edit-btn-row';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'edit-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeDialog();
      self._pendingCell = null;
    });
    btnRow.appendChild(cancelBtn);

    var createBtn = document.createElement('button');
    createBtn.className = 'edit-save';
    createBtn.textContent = 'Create';
    createBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var name = nameInput.value.trim();
      if (!name) {
        nameInput.style.borderColor = 'var(--td-danger)';
        nameInput.focus();
        return;
      }
      if (createType === 'note') {
        self._createNoteViaApi(name);
      } else {
        var command = cmdInput.value.trim();
        self._sendCreateTerminal(name, command, selectedBg, selectedColor);
      }
      closeDialog();
    });
    btnRow.appendChild(createBtn);

    dialog.appendChild(btnRow);

    // Enter key submits from either input
    function onEnter(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        createBtn.click();
      }
    }
    nameInput.addEventListener('keydown', onEnter);
    cmdInput.addEventListener('keydown', onEnter);

    // Show dialog
    dialog.classList.remove('hidden');
    if (backdrop) backdrop.classList.remove('hidden');
    nameInput.focus();
    nameInput.select();

    // Close helper
    function closeDialog() {
      dialog.classList.add('hidden');
      if (backdrop) backdrop.classList.add('hidden');
      dialog.innerHTML = '';
    }

    // Close on backdrop click
    if (backdrop) {
      var onBackdropClick = function () {
        closeDialog();
        self._pendingCell = null;
        backdrop.removeEventListener('click', onBackdropClick);
      };
      backdrop.addEventListener('click', onBackdropClick);
    }

    // Close on Escape
    var onEsc = function (e) {
      if (e.key === 'Escape') {
        closeDialog();
        self._pendingCell = null;
        document.removeEventListener('keydown', onEsc);
      }
    };
    document.addEventListener('keydown', onEsc);
  };

  // --- Default terminal name ---

  App.prototype._nextDefaultName = function () {
    var existing = Object.keys(this._connections);
    var max = 0;
    existing.forEach(function (id) {
      var conn = this._connections[id];
      var name = (conn.config && conn.config.name) || '';
      var m = name.match(/^Terminal\s+(\d+)$/);
      if (m) {
        var n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }.bind(this));
    return 'Terminal ' + (max + 1);
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
      msg.textContent = 'No panels. Click + to create a terminal or note.';
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
      if (self._terminalList) {
        self._terminalList.updateActivity(id, active);
      }
    });
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

  // --- Sidebar / UI ---

  App.prototype._initTerminalList = function () {
    var container = document.getElementById('terminal-list');
    if (!container || !ns.TerminalList) return;

    var self = this;
    this._terminalList = new ns.TerminalList(container);

    this._terminalList.onMinimize = function (id) {
      if (self._engine) self._engine.minimizeTerminal(id);
    };

    this._terminalList.onClose = function (id) {
      var conn = self._connections[id];
      if (conn && conn.type === 'note') {
        // Notes minimize on close (they persist in config)
        if (self._engine) self._engine.minimizeTerminal(id);
      } else {
        self._sendDestroyTerminal(id);
      }
    };

    this._terminalList.onSelect = function (id) {
      self._handleTerminalListSelect(id);
    };
  };

  App.prototype._initSidebarSections = function () {
    var headers = document.querySelectorAll('.section-header');
    headers.forEach(function (header) {
      header.addEventListener('click', function () {
        var content = header.nextElementSibling;
        if (content) content.classList.toggle('collapsed');
        header.classList.toggle('collapsed');
      });
    });
  };

  App.prototype._syncTerminalList = function () {
    if (!this._terminalList || !this._engine) return;

    var self = this;
    var ids = Object.keys(this._connections);

    // Build a set of IDs currently in the list
    var listed = new Set(this._terminalList._items.keys());

    ids.forEach(function (id) {
      var conn = self._connections[id];
      var name = conn.config.name || id;
      var location = 'Minimized';
      var active = conn.isActive();
      var panelType = conn.type === 'note' ? 'note' : 'terminal';

      // Check if it's in a grid cell
      for (var i = 0; i < self._engine._cells.length; i++) {
        var cell = self._engine._cells[i];
        var info = self._engine._cellMap.get(cell);
        if (info && info.terminalId === id) {
          location = 'Cell ' + (i + 1);
          break;
        }
      }

      // Add dirty indicator for notes
      var displayName = name;
      if (panelType === 'note' && conn.isDirty && conn.isDirty()) {
        displayName = name + ' *';
      }

      self._terminalList.upsert(id, displayName, location, active, panelType);
      listed.delete(id);
    });

    // Remove stale entries
    listed.forEach(function (id) {
      self._terminalList.remove(id);
    });
  };

  App.prototype._handleTerminalListSelect = function (id) {
    if (!this._engine) return;

    // Close sidebar on mobile so user sees the terminal
    if (this._isMobile() && this._closeSidebar) {
      this._closeSidebar();
    }

    // Check if terminal is in a grid cell
    for (var i = 0; i < this._engine._cells.length; i++) {
      var cell = this._engine._cells[i];
      var info = this._engine._cellMap.get(cell);
      if (info && info.terminalId === id) {
        this._highlightCell(cell);
        return;
      }
    }

    // Terminal is minimized — restore to first empty cell
    var conn = this._connections[id];
    if (!conn) return;

    for (var j = 0; j < this._engine._cells.length; j++) {
      var emptyCell = this._engine._cells[j];
      var emptyInfo = this._engine._cellMap.get(emptyCell);
      if (emptyInfo && !emptyInfo.connection) {
        this._engine._removeFromMinimized(id);
        this._engine.assignTerminal(emptyCell, id, conn);
        conn.refit();
        return;
      }
    }
  };

  App.prototype._highlightCell = function (cell) {
    cell.classList.remove('cell-highlight');
    // Force reflow to restart animation
    void cell.offsetWidth;
    cell.classList.add('cell-highlight');
    setTimeout(function () {
      cell.classList.remove('cell-highlight');
    }, 1500);
  };

  // --- File Tree ---

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

    var refreshBtn = document.getElementById('file-tree-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        refreshBtn.classList.add('ft-refreshing');
        self._fileTree.refresh().then(function () {
          refreshBtn.classList.remove('ft-refreshing');
        }).catch(function () {
          refreshBtn.classList.remove('ft-refreshing');
        });
      });
    }
  };

  App.prototype._isMobile = function () {
    return window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
  };

  App.prototype._wireSidebarToggle = function () {
    var self = this;
    var sidebar = document.getElementById('sidebar');
    var toggleBtn = document.getElementById('sidebar-toggle-btn');
    var closeBtn = document.getElementById('sidebar-close-btn');
    var backdrop = document.getElementById('sidebar-backdrop');

    if (!sidebar || !toggleBtn) return;

    function openSidebar() {
      sidebar.classList.remove('hidden');
      if (backdrop && self._isMobile()) backdrop.classList.remove('hidden');
      refit();
    }

    function closeSidebar() {
      sidebar.classList.add('hidden');
      if (backdrop) backdrop.classList.add('hidden');
      refit();
    }

    function toggle() {
      if (sidebar.classList.contains('hidden')) {
        openSidebar();
      } else {
        closeSidebar();
      }
    }

    function refit() {
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
    if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
    if (backdrop) backdrop.addEventListener('click', closeSidebar);

    // Expose closeSidebar for use by terminal list selection
    this._closeSidebar = closeSidebar;
  };

  App.prototype._wireOrientationChange = function () {
    var self = this;
    var mq = window.matchMedia && window.matchMedia('(max-width: 767px)');
    if (mq && mq.addEventListener) {
      mq.addEventListener('change', function () {
        if (self._engine) {
          self._engine.checkMobile();
          self._engine.refitAll();
        }
      });
    }
  };

  App.prototype._openFileInEditor = function (filePath, fileName) {
    // Reject paths with shell metacharacters or control characters to prevent command injection
    if (/[;|&`$(){}[\]!#~\n\r\0]/.test(filePath)) return;
    this._sendCreateTerminal(fileName, 'vi /workspace/' + filePath);
  };

  // --- Mobile Toolbar ---

  App.prototype._TOOLBAR_KEYS = {
    'esc':   '\x1b',
    'tab':   '\t',
    'up':    '\x1b[A',
    'down':  '\x1b[B',
    'left':  '\x1b[D',
    'right': '\x1b[C',
    'pipe':  '|',
    'dash':  '-',
    'tilde': '~',
    'slash': '/',
    'colon': ':',
    'pgup':  '\x1b[5~',
    'pgdn':  '\x1b[6~'
  };

  App.prototype._initMobileToolbar = function () {
    var toolbar = document.getElementById('mobile-toolbar');
    if (!toolbar) return;

    var self = this;
    var ctrlActive = false;

    // CRITICAL: Prevent focus theft.
    // Without this, tapping any button steals focus from xterm.js,
    // causing keyboard dismiss → viewport resize → SIGWINCH → readline corruption.
    toolbar.addEventListener('mousedown', function (e) {
      e.preventDefault();
    });

    toolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('.mobile-toolbar-btn');
      if (!btn) return;

      var key = btn.dataset.key;
      if (!key) return;

      // Handle Ctrl toggle
      if (key === 'ctrl') {
        ctrlActive = !ctrlActive;
        btn.classList.toggle('ctrl-active', ctrlActive);
        return;
      }

      var data;
      if (ctrlActive) {
        if (key.length === 1) {
          var code = key.toUpperCase().charCodeAt(0) - 64;
          if (code >= 1 && code <= 26) {
            data = String.fromCharCode(code);
          } else {
            data = self._TOOLBAR_KEYS[key] || key;
          }
        } else if (key === 'tab') {
          data = '\t';
        } else {
          data = self._TOOLBAR_KEYS[key] || key;
        }

        ctrlActive = false;
        var ctrlBtn = toolbar.querySelector('[data-key="ctrl"]');
        if (ctrlBtn) ctrlBtn.classList.remove('ctrl-active');
      } else {
        data = self._TOOLBAR_KEYS[key] || key;
      }

      self._sendToActiveTerminal(data);
    });

    // visualViewport positioning: keeps toolbar above the virtual keyboard
    if (window.visualViewport) {
      var reposition = function () {
        var vv = window.visualViewport;
        var bottomOffset = window.innerHeight - (vv.offsetTop + vv.height);
        toolbar.style.bottom = Math.max(0, bottomOffset) + 'px';
      };

      window.visualViewport.addEventListener('resize', reposition);
      window.visualViewport.addEventListener('scroll', reposition);
    }
  };

  App.prototype._sendToActiveTerminal = function (data) {
    var activeConn = null;

    if (this._engine) {
      for (var i = 0; i < this._engine._cells.length; i++) {
        var cell = this._engine._cells[i];
        var info = this._engine._cellMap.get(cell);
        if (info && info.connection) {
          if (!activeConn) activeConn = info.connection;
          if (cell.contains(document.activeElement)) {
            activeConn = info.connection;
            break;
          }
        }
      }
    }

    if (!activeConn) return;

    // Mobile toolbar only works with terminals, not note panels
    if (activeConn.type === 'note') return;

    var term = activeConn._terminal;
    var ws = activeConn._ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Flush pending IME composition text before sending toolbar data.
    //
    // On Android Chrome, every character goes through IME composition.
    // Characters accumulate in xterm.js's textarea and are NOT sent to
    // the PTY until compositionend fires (space, punctuation, or word
    // accept).  Toolbar keys sent directly via WebSocket bypass this
    // buffer, so bash doesn't see the uncommitted characters — e.g.
    // if the user typed "ls /hom" and "hom" is still in the IME buffer,
    // bash only has "ls /" when '\t' arrives, finds ambiguous matches,
    // and single-tab completion fails.
    //
    // Fix: detect an active composition, send the pending text to the
    // PTY first, then reset xterm.js's composition state so it doesn't
    // double-send when the browser eventually fires compositionend.
    var textarea = term && term.textarea;
    var ch = term && (term._compositionHelper
      || (term._core && term._core._compositionHelper));

    if (ch && ch.isComposing && textarea && textarea.value) {
      // Extract only the unsent composition text.
      // _compositionPosition.start marks where the composition began
      // in the textarea; _dataAlreadySent tracks any chars xterm.js
      // already forwarded during the composition.
      var start = ch._compositionPosition ? ch._compositionPosition.start : 0;
      var alreadySent = ch._dataAlreadySent ? ch._dataAlreadySent.length : 0;
      var pending = textarea.value.substring(start + alreadySent);

      if (pending) {
        ws.send(JSON.stringify({ type: 'input', data: pending }));
      }

      // Reset composition state so xterm.js doesn't re-send the same
      // text when compositionend eventually fires from the browser.
      textarea.value = '';
      ch._isComposing = false;
      ch._isSendingComposition = false;
      ch._dataAlreadySent = '';
      ch._compositionPosition = { start: 0, end: 0 };
      if (ch._compositionView) {
        ch._compositionView.classList.remove('active');
        ch._compositionView.textContent = '';
      }
    }

    ws.send(JSON.stringify({ type: 'input', data: data }));

    activeConn.focus();
  };

  // --- Notes ---

  App.prototype._loadNotes = function () {
    var self = this;
    return fetch('/api/notes')
      .then(function (res) { return res.json(); })
      .then(function (notes) {
        self._applyNotes(notes);
      })
      .catch(function (err) {
        console.error('[app] loadNotes error:', err);
      });
  };

  App.prototype._applyNotes = function (notes) {
    var self = this;
    notes.forEach(function (n) {
      if (self._connections[n.id]) return;
      var panel = new ns.NotePanel(n);
      panel._onDirtyChange = function () {
        self._syncTerminalList();
      };
      self._connections[n.id] = panel;
      self._assignToFirstEmptyCell(n.id, panel);
    });
    this._updateEmptyState();
    this._syncTerminalList();
  };

  App.prototype._handleNoteSaved = function (msg) {
    var conn = this._connections[msg.noteId];
    if (conn && conn.type === 'note' && conn._easyMDE) {
      // Another tab/client saved this note — reload if not dirty
      if (!conn.isDirty()) {
        conn._loadContent();
      }
    }
  };

  App.prototype._createNoteViaApi = function (name) {
    var self = this;
    return fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name })
    })
      .then(function (res) { return res.json(); })
      .then(function (note) {
        var panel = new ns.NotePanel(note);
        panel._onDirtyChange = function () {
          self._syncTerminalList();
        };
        self._connections[note.id] = panel;
        self._assignToFirstEmptyCell(note.id, panel);
        self._updateEmptyState();
        self._syncTerminalList();
        return note;
      });
  };

  App.prototype._wireBeforeUnload = function () {
    var self = this;
    window.addEventListener('beforeunload', function (e) {
      var hasDirty = Object.keys(self._connections).some(function (id) {
        var conn = self._connections[id];
        return conn.type === 'note' && conn.isDirty();
      });
      if (hasDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
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
