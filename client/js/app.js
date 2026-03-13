(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  // --- Init ---

  function App() {
    this.instanceId = null;
    this._config = null;
    this._connections = {};  // id -> TerminalConnection or EditorPanel
    this._engine = null;
    this._statusEl = null;
    this._controlWs = null;
    this._fileTree = null;
    this._claudeFileTree = null;
    this._opencodeFileTree = null;
    this._terminalList = null;
    this._todayTasks = null;
    this._commandPalette = null;
    this._notificationsMuted = false;
    this._ctrlActive = false;
    this._altActive = false;
    this._toolbarMode = 'keys';
    this._cmdsHistory = [];
    this._cmdsFuse = null;
    this._terminalContexts = {}; // terminalId -> raw command name from tmux
    this._currentContext = 'generic'; // resolved context category for active terminal
    this._folders = [];
    this._sessionFolders = {};
    this._folderCells = {}; // folderId -> FolderCell currently displayed in a grid cell
  }

  App.prototype._initInstanceId = function () {
    var params = new URLSearchParams(window.location.search);
    var id = params.get('instance');
    if (!id) {
      try { id = window.localStorage.getItem('terminaldeck-instanceId'); } catch {}
    }
    if (!id) {
      try {
        id = crypto.randomUUID();
      } catch {
        id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      }
    }
    this.instanceId = id;
    ns._instanceId = id;
    try { window.localStorage.setItem('terminaldeck-instanceId', id); } catch {}
    if (!params.get('instance')) {
      params.set('instance', id);
      try { window.history.replaceState(null, '', '?' + params.toString()); } catch {}
    }
  };

  App.prototype.init = function () {
    var self = this;

    this._initInstanceId();
    this._suppressMobileContextMenus();

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
        self._initClaudeFileTree();
        self._initOpencodeFileTree();
        self._initTodayTasks();
        self._initTerminalList();
        self._initSidebarSections();
        self._wireSidebarToggle();
        self._wireOrientationChange();
        self._initMobileToolbar();
        self._initCommandPalette();
        self._initNotifications();
        self._connectControl();

        return self._loadFolders();
      })
      .then(function () {
        return self._loadSessions();
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
      if (conn && conn.type === 'editor') {
        self._closeFilePanel(id);
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

    this._engine._onOpenFolderInCell = function (cell, folderId) {
      self._openFolderInCell(folderId, cell);
    };

    this._engine._onCreateTerminalInFolder = function (folderId) {
      self._showCreateDialog(folderId);
    };

    this._engine._onEditFolder = function (folderId) {
      self._showFolderSettingsDialog(folderId);
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
    var url = protocol + '//' + host + '/ws/control?t=' + encodeURIComponent(ns._serverToken || '') +
      '&instance=' + encodeURIComponent(this.instanceId || ns._instanceId || '');

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
        case 'folders':
          self._folders = msg.folders || [];
          if (self._engine) self._engine._folders = self._folders;
          self._sessionFolders = msg.sessionFolders || {};
          // Re-resolve colors for terminals that inherit from folders
          Object.keys(self._connections).forEach(function (id) {
            var conn = self._connections[id];
            if (!conn || conn.type === 'editor') return;
            var rawBg = conn.config.headerBg;
            var rawColor = conn.config.headerColor;
            if (rawBg === 'inherit' || rawColor === 'inherit') {
              var resolved = self._resolveTerminalColors(id, rawBg, rawColor);
              conn.config.resolvedHeaderBg = resolved.bg;
              conn.config.resolvedHeaderColor = resolved.color;
              if (self._engine) {
                self._engine.updateHeader(id, conn.config.name, resolved.bg, resolved.color);
              }
            }
          });
          // Update colors on any open folder tab groups
          if (self._engine) {
            self._folders.forEach(function (folder) {
              if (self._folderCells && self._folderCells[folder.id]) {
                self._engine.updateFolderColors(folder.id, folder.headerBg || null, folder.headerColor || null, folder.headerHighlight || null);
              }
            });
          }
          self._syncTerminalList();
          break;
        case 'config_reload':
          self._handleConfigReload(msg.config);
          break;
        case 'activity':
          self._handleActivity(msg);
          break;
        case 'history_update':
          self._handleHistoryUpdate(msg);
          break;
        case 'task_complete':
          self._handleTaskComplete(msg);
          break;
        case 'pane_context':
          self._handlePaneContext(msg);
          break;
        case 'tasks_update':
          if (self._todayTasks) self._todayTasks.refresh();
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

  App.prototype._sendCreateTerminal = function (name, command, headerBg, headerColor, folderId, cwd, startCommand) {
    if (this._controlWs && this._controlWs.readyState === WebSocket.OPEN) {
      this._controlWs.send(
        JSON.stringify({
          type: 'create_terminal',
          name: name,
          command: command,
          headerBg: headerBg || null,
          headerColor: headerColor || null,
          folderId: folderId || null,
          cwd: cwd || null,
          startCommand: startCommand || null
        })
      );
    }
  };

  App.prototype._sendDestroyTerminal = function (id) {
    if (this._controlWs && this._controlWs.readyState === WebSocket.OPEN) {
      this._controlWs.send(JSON.stringify({ type: 'destroy_terminal', id: id }));
    }
  };

  App.prototype._closeFilePanel = function (id) {
    var conn = this._connections[id];
    if (!conn) return;
    var name = (conn.config && conn.config.name) || id;
    if (conn.isDirty && conn.isDirty()) {
      if (!confirm('Close "' + name + '"? Unsaved changes will be saved first.')) return;
    }

    var self = this;
    var savePromise = (conn.isDirty && conn.isDirty() && conn.save)
      ? conn.save()
      : Promise.resolve();

    savePromise.then(function () {
      return fetch('/api/notes/' + encodeURIComponent(id) + '?deleteFile=false', {
        method: 'DELETE'
      });
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Close failed: ' + res.status);
        return res.json();
      })
      .then(function () {
        conn.destroy();
        if (self._engine) {
          self._engine._removeFromGrid(id);
          self._engine._removeFromMinimized(id);
        }
        delete self._connections[id];
        self._syncTerminalList();
        self._updateEmptyState();
      })
      .catch(function (err) {
        console.error('[app] close file panel error:', err);
      });
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

  App.prototype._sendCreateFolder = function (name, parentId) {
    if (this._controlWs && this._controlWs.readyState === WebSocket.OPEN) {
      this._controlWs.send(JSON.stringify({ type: 'create_folder', name: name, parentId: parentId || null }));
    }
  };

  App.prototype._sendUpdateFolder = function (id, updates) {
    if (this._controlWs && this._controlWs.readyState === WebSocket.OPEN) {
      this._controlWs.send(JSON.stringify(Object.assign({ type: 'update_folder', id: id }, updates)));
    }
  };

  // Resolve 'inherit' color values by walking up the folder hierarchy.
  // Returns { bg, color } with actual hex values or null.
  App.prototype._resolveTerminalColors = function (terminalId, rawBg, rawColor) {
    var bg = rawBg || null;
    var color = rawColor || null;
    if (bg !== 'inherit' && color !== 'inherit') {
      return { bg: bg, color: color };
    }
    var folderId = this._sessionFolders[terminalId] || null;
    var resolvedBg = bg === 'inherit' ? null : bg;
    var resolvedColor = color === 'inherit' ? null : color;
    while (folderId) {
      var folder = null;
      for (var i = 0; i < this._folders.length; i++) {
        if (this._folders[i].id === folderId) { folder = this._folders[i]; break; }
      }
      if (!folder) break;
      if (bg === 'inherit' && !resolvedBg && folder.headerBg) resolvedBg = folder.headerBg;
      if (color === 'inherit' && !resolvedColor && folder.headerColor) resolvedColor = folder.headerColor;
      if (resolvedBg && resolvedColor) break;
      folderId = folder.parentId || null;
    }
    return { bg: resolvedBg || null, color: resolvedColor || null };
  };

  App.prototype._sendDeleteFolder = function (id) {
    if (this._controlWs && this._controlWs.readyState === WebSocket.OPEN) {
      this._controlWs.send(JSON.stringify({ type: 'delete_folder', id: id }));
    }
  };

  App.prototype._sendMoveTerminal = function (terminalId, folderId) {
    if (this._controlWs && this._controlWs.readyState === WebSocket.OPEN) {
      this._controlWs.send(JSON.stringify({ type: 'move_terminal', id: terminalId, folderId: folderId || null }));
    }
  };

  // --- Session Management ---

  App.prototype._loadFolders = function () {
    var self = this;
    return fetch('/api/folders?instance=' + encodeURIComponent(this.instanceId || ''))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        self._folders = data.folders || [];
        if (self._engine) self._engine._folders = self._folders;
        self._sessionFolders = data.sessionFolders || {};
      })
      .catch(function (err) {
        console.error('[app] loadFolders error:', err);
      });
  };

  App.prototype._loadSessions = function () {
    var self = this;
    return fetch('/api/sessions?instance=' + encodeURIComponent(this.instanceId || ''))
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
    var resolved = self._resolveTerminalColors(id, headerBg || null, headerColor || null);
    var conn = new ns.TerminalConnection(id, {
      name: name,
      theme: self._config.settings.theme,
      headerBg: headerBg || null,
      headerColor: headerColor || null,
      resolvedHeaderBg: resolved.bg,
      resolvedHeaderColor: resolved.color
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

        // If folder is open in a grid cell, add as tab instead of new cell
        var folderId = self._sessionFolders[s.id] || null;
        var addedToFolder = false;
        if (folderId && self._folderCells[folderId]) {
          var fc = self._folderCells[folderId];
          fc.addTerminal(s.id, s.name, conn);
          // Re-render the header for the cell hosting this folder
          for (var ci = 0; ci < self._engine._cells.length; ci++) {
            var ci_cell = self._engine._cells[ci];
            var ci_info = self._engine._cellMap.get(ci_cell);
            if (ci_info && ci_info.folderCell === fc) {
              var ci_header = ci_cell.querySelector('.cell-header');
              fc.renderHeader(ci_header, self._engine._makeFolderCallbacks(ci_cell, fc));
              addedToFolder = true;
              break;
            }
          }
        }
        if (!addedToFolder) {
          self._assignToFirstEmptyCell(s.id, conn);
        }
      } else {
        // Update existing connection config and header
        var conn = self._connections[s.id];
        conn.config.name = s.name;
        conn.config.headerBg = s.headerBg || null;
        conn.config.headerColor = s.headerColor || null;
        var resolved = self._resolveTerminalColors(s.id, s.headerBg, s.headerColor);
        conn.config.resolvedHeaderBg = resolved.bg;
        conn.config.resolvedHeaderColor = resolved.color;
        if (self._engine) {
          self._engine.updateHeader(s.id, s.name, resolved.bg, resolved.color);
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
        // Don't remove editor panels — they're managed separately
        if (conn && conn.type === 'editor') return;
        conn.destroy();

        // Remove from any folder cell it belongs to
        Object.keys(self._folderCells).forEach(function (fid) {
          var fc = self._folderCells[fid];
          var tabs = fc.getTerminals();
          for (var ti = 0; ti < tabs.length; ti++) {
            if (tabs[ti].id === id) {
              // Let minimizeTerminal or _clearCell handle the active case;
              // for inactive tabs just remove from folderCell
              if (fc.getActiveTerminalId() !== id) {
                fc.removeTerminal(id);
                // Re-render header
                for (var ci = 0; ci < self._engine._cells.length; ci++) {
                  var ci_cell = self._engine._cells[ci];
                  var ci_info = self._engine._cellMap.get(ci_cell);
                  if (ci_info && ci_info.folderCell === fc) {
                    var ci_h = ci_cell.querySelector('.cell-header');
                    fc.renderHeader(ci_h, self._engine._makeFolderCallbacks(ci_cell, fc));
                    break;
                  }
                }
              }
              break;
            }
          }
        });

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

  App.prototype._showCreateDialog = function (inFolderId) {
    var self = this;
    var dialog = document.getElementById('ephemeral-dialog');
    var backdrop = document.getElementById('ephemeral-backdrop');
    if (!dialog) return;

    // Build dialog contents
    dialog.innerHTML = '';
    var title = document.createElement('div');
    title.className = 'ephemeral-title';
    if (inFolderId) {
      var folderName = '';
      for (var fi = 0; fi < (self._folders || []).length; fi++) {
        if (self._folders[fi].id === inFolderId) { folderName = self._folders[fi].name; break; }
      }
      title.textContent = folderName ? 'New Terminal in \u201C' + folderName + '\u201D' : 'New Terminal in Folder';
    } else {
      title.textContent = 'New Terminal';
    }
    dialog.appendChild(title);

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
    var selectedBg = 'inherit';
    var selectedColor = 'inherit';
    var terminalOnlyEls = [];

    if (this._engine) {
      var bgLabel = document.createElement('label');
      bgLabel.className = 'edit-label';
      bgLabel.textContent = 'Header Background';
      dialog.appendChild(bgLabel);
      terminalOnlyEls.push(bgLabel);

      var bgSwatches = this._engine._createColorSwatches('inherit', true, function (color) {
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

      var textSwatches = this._engine._createColorSwatches('inherit', true, function (color) {
        selectedColor = color;
      });
      dialog.appendChild(textSwatches);
      terminalOnlyEls.push(textSwatches);
    }

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
      var command = cmdInput.value.trim();
      // Look up folder's startCommand if creating in a folder
      var folderStartCmd = null;
      if (inFolderId && self._folders) {
        for (var fsi = 0; fsi < self._folders.length; fsi++) {
          if (self._folders[fsi].id === inFolderId && self._folders[fsi].startCommand) {
            folderStartCmd = self._folders[fsi].startCommand;
            break;
          }
        }
      }
      self._sendCreateTerminal(name, command, selectedBg, selectedColor, inFolderId || null, null, folderStartCmd);
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

  // --- Folder Settings Dialog ---

  App.prototype._showFolderSettingsDialog = function (folderId) {
    var self = this;
    var folder = null;
    for (var i = 0; i < (this._folders || []).length; i++) {
      if (this._folders[i].id === folderId) { folder = this._folders[i]; break; }
    }
    if (!folder) return;

    var dialog = document.getElementById('ephemeral-dialog');
    var backdrop = document.getElementById('ephemeral-backdrop');
    if (!dialog) return;

    dialog.innerHTML = '';
    var title = document.createElement('div');
    title.className = 'ephemeral-title';
    title.textContent = 'Folder Settings';
    dialog.appendChild(title);

    // Name field
    var nameLabel = document.createElement('label');
    nameLabel.className = 'edit-label';
    nameLabel.textContent = 'Name';
    dialog.appendChild(nameLabel);

    var nameInput = document.createElement('input');
    nameInput.className = 'edit-name-input';
    nameInput.type = 'text';
    nameInput.value = folder.name || '';
    dialog.appendChild(nameInput);

    // Start Command field
    var cmdLabel = document.createElement('label');
    cmdLabel.className = 'edit-label';
    cmdLabel.textContent = 'Start Command';
    dialog.appendChild(cmdLabel);

    var cmdInput = document.createElement('input');
    cmdInput.className = 'edit-name-input';
    cmdInput.type = 'text';
    cmdInput.placeholder = 'Command to run when a new terminal is created';
    cmdInput.value = folder.startCommand || '';
    dialog.appendChild(cmdInput);

    var cmdHint = document.createElement('div');
    cmdHint.className = 'ephemeral-hint';
    cmdHint.textContent = 'Runs automatically in new terminals created in this folder.';
    dialog.appendChild(cmdHint);

    // Color swatches
    var selectedBg = folder.headerBg || null;
    var selectedColor = folder.headerColor || null;
    var selectedHighlight = folder.headerHighlight || null;

    if (this._engine) {
      var bgLabel = document.createElement('label');
      bgLabel.className = 'edit-label';
      bgLabel.textContent = 'Header Background';
      dialog.appendChild(bgLabel);
      var bgSwatches = this._engine._createColorSwatches(selectedBg, false, function (color) {
        selectedBg = color;
      });
      dialog.appendChild(bgSwatches);

      var textLabel = document.createElement('label');
      textLabel.className = 'edit-label';
      textLabel.textContent = 'Header Text';
      dialog.appendChild(textLabel);
      var textSwatches = this._engine._createColorSwatches(selectedColor, false, function (color) {
        selectedColor = color;
      });
      dialog.appendChild(textSwatches);

      var hlLabel = document.createElement('label');
      hlLabel.className = 'edit-label';
      hlLabel.textContent = 'Header Highlight';
      dialog.appendChild(hlLabel);
      var hlSwatches = this._engine._createColorSwatches(selectedHighlight, false, function (color) {
        selectedHighlight = color;
      });
      dialog.appendChild(hlSwatches);
    }

    // Buttons
    var btnRow = document.createElement('div');
    btnRow.className = 'edit-btn-row';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'edit-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeDialog();
    });
    btnRow.appendChild(cancelBtn);

    var saveBtn = document.createElement('button');
    saveBtn.className = 'edit-save';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var newName = nameInput.value.trim();
      if (!newName) {
        nameInput.style.borderColor = 'var(--td-danger)';
        nameInput.focus();
        return;
      }
      var startCmd = cmdInput.value.trim() || null;
      var updates = {
        name: newName,
        startCommand: startCmd,
        headerBg: selectedBg,
        headerColor: selectedColor,
        headerHighlight: selectedHighlight
      };
      // Live-update folder colors in open tab groups
      if (self._engine) self._engine.updateFolderColors(folderId, selectedBg, selectedColor, selectedHighlight);
      self._sendUpdateFolder(folderId, updates);
      closeDialog();
    });
    btnRow.appendChild(saveBtn);

    dialog.appendChild(btnRow);

    // Enter key submits
    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
    });
    cmdInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
    });

    // Show dialog
    dialog.classList.remove('hidden');
    if (backdrop) backdrop.classList.remove('hidden');
    nameInput.focus();
    nameInput.select();

    function closeDialog() {
      dialog.classList.add('hidden');
      if (backdrop) backdrop.classList.add('hidden');
      dialog.innerHTML = '';
    }

    if (backdrop) {
      var onBackdropClick = function () {
        closeDialog();
        backdrop.removeEventListener('click', onBackdropClick);
      };
      backdrop.addEventListener('click', onBackdropClick);
    }

    var onEsc = function (e) {
      if (e.key === 'Escape') {
        closeDialog();
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
    var self = this;

    var termContainer = document.getElementById('terminal-list');
    if (termContainer && ns.TerminalList) {
      this._terminalList = new ns.TerminalList(termContainer);
      this._terminalList.onMinimize = function (id) {
        if (self._engine) self._engine.minimizeTerminal(id);
      };
      this._terminalList.onClose = function (id) {
        var conn = self._connections[id];
        if (conn && conn.type === 'editor') {
          self._closeFilePanel(id);
        } else {
          self._sendDestroyTerminal(id);
        }
      };
      this._terminalList.onSelect = function (id) {
        self._handleTerminalListSelect(id);
      };
      this._terminalList.onCreateFolder = function (name, parentId) {
        self._sendCreateFolder(name, parentId);
      };
      this._terminalList.onRenameFolder = function (id, name) {
        self._sendUpdateFolder(id, { name: name });
      };
      this._terminalList.onDeleteFolder = function (id) {
        self._sendDeleteFolder(id);
      };
      this._terminalList.onToggleFolder = function (id, collapsed) {
        self._sendUpdateFolder(id, { collapsed: collapsed });
      };
      this._terminalList.onMoveTerminal = function (terminalId, folderId) {
        self._sendMoveTerminal(terminalId, folderId);
      };
      this._terminalList.onUpdateFolderColors = function (id, headerBg, headerColor, headerHighlight) {
        // Live-update any open tab group for this folder
        if (self._engine) self._engine.updateFolderColors(id, headerBg, headerColor, headerHighlight);
        self._sendUpdateFolder(id, { headerBg: headerBg, headerColor: headerColor, headerHighlight: headerHighlight });
      };
      this._terminalList.onNewTerminalInFolder = function (folderId) {
        self._showCreateDialog(folderId);
      };
      this._terminalList.onOpenFolderInGrid = function (folderId) {
        var cell = self._findFirstEmptyCell() || (self._engine && self._engine._cells[0]);
        if (cell) self._openFolderInCell(folderId, cell);
      };
      this._terminalList.onEditFolder = function (folderId) {
        self._showFolderSettingsDialog(folderId);
      };
    }

    // "New folder" button in the Terminals section header
    var newFolderBtn = document.getElementById('new-folder-btn');
    if (newFolderBtn) {
      newFolderBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var name = prompt('Folder name:');
        if (name && name.trim()) {
          self._sendCreateFolder(name.trim(), null);
        }
      });
    }

  };

  App.prototype._initSidebarSections = function () {
    var isMobileNow = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
    var mobileExpanded = { today: true, terminals: true };
    var defaultCollapsed = { claude: true, opencode: true };

    var headers = document.querySelectorAll('.section-header');
    headers.forEach(function (header) {
      var section = header.dataset.section;
      if ((isMobileNow && !mobileExpanded[section]) || defaultCollapsed[section]) {
        var content = header.nextElementSibling;
        if (content) content.classList.add('collapsed');
        header.classList.add('collapsed');
      }
      header.addEventListener('click', function () {
        var content = header.nextElementSibling;
        if (content) content.classList.toggle('collapsed');
        header.classList.toggle('collapsed');
      });
    });
  };

  App.prototype._syncTerminalList = function () {
    if (!this._engine) return;

    var self = this;
    var terminalItems = [];

    // Build a map of terminalId -> "Cell N (tab)" for inactive folder tabs
    var folderTabLocations = {};
    for (var ci = 0; ci < this._engine._cells.length; ci++) {
      var cell = this._engine._cells[ci];
      var cellInfo = this._engine._cellMap.get(cell);
      if (cellInfo && cellInfo.folderCell) {
        var fc = cellInfo.folderCell;
        var cellLabel = 'Cell ' + (ci + 1);
        fc.getTerminals().forEach(function (t) {
          if (t.id !== cellInfo.terminalId) {
            folderTabLocations[t.id] = cellLabel + ' (tab)';
          }
        });
      }
    }

    Object.keys(this._connections).forEach(function (id) {
      var conn = self._connections[id];
      var name = conn.config.name || id;
      var location = 'Minimized';
      var active = conn.isActive();
      var isEditor = conn.type === 'editor';

      for (var i = 0; i < self._engine._cells.length; i++) {
        var cell = self._engine._cells[i];
        var info = self._engine._cellMap.get(cell);
        if (info && info.terminalId === id) {
          location = 'Cell ' + (i + 1);
          break;
        }
      }

      // Override location for inactive folder tabs
      if (location === 'Minimized' && folderTabLocations[id]) {
        location = folderTabLocations[id];
      }

      var displayName = name;
      if (isEditor && conn.isDirty && conn.isDirty()) displayName = name + ' *';
      terminalItems.push({ id: id, name: displayName, location: location, active: active, panelType: isEditor ? 'editor' : 'terminal' });
    });

    if (this._terminalList) {
      this._terminalList.setFolderData(this._folders, this._sessionFolders);
      this._terminalList.render(terminalItems);
    }

    if (this._toolbarMode === 'sessions') {
      this._refreshSessionsPanel();
    }
  };

  App.prototype._handleTerminalListSelect = function (id) {
    if (!this._engine) return;

    // Clear bell indicator on selection
    if (this._terminalList) this._terminalList.clearBell(id);

    // Close sidebar on mobile so user sees the terminal
    if (this._isMobile() && this._closeSidebar) {
      this._closeSidebar();
    }

    // Check if terminal is active in a grid cell
    for (var i = 0; i < this._engine._cells.length; i++) {
      var cell = this._engine._cells[i];
      var info = this._engine._cellMap.get(cell);
      if (info && info.terminalId === id) {
        this._highlightCell(cell);
        return;
      }
    }

    // Check if terminal is an inactive tab in a folder cell
    for (var fi = 0; fi < this._engine._cells.length; fi++) {
      var fcell = this._engine._cells[fi];
      var finfo = this._engine._cellMap.get(fcell);
      if (finfo && finfo.folderCell) {
        var tabs = finfo.folderCell.getTerminals();
        for (var ti = 0; ti < tabs.length; ti++) {
          if (tabs[ti].id === id) {
            this._engine._switchFolderTab(fcell, id);
            this._highlightCell(fcell);
            return;
          }
        }
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

  // --- Folder Cells ---

  App.prototype._openFolderInCell = function (folderId, cell) {
    if (!this._engine || !ns.FolderCell) return;

    // Find all terminals in this folder
    var self = this;
    var entries = [];
    Object.keys(this._connections).forEach(function (id) {
      if (self._sessionFolders[id] === folderId) {
        var conn = self._connections[id];
        if (!conn || conn.type === 'editor') return;
        entries.push({ id: id, name: conn.config.name || id, connection: conn });
      }
    });

    if (entries.length === 0) return; // no-op for empty folder

    // Find folder name
    var folderName = folderId;
    for (var fi = 0; fi < this._folders.length; fi++) {
      if (this._folders[fi].id === folderId) {
        folderName = this._folders[fi].name;
        break;
      }
    }

    // Move terminals from other grid cells to minimized before gathering
    entries.forEach(function (e) {
      for (var ci = 0; ci < self._engine._cells.length; ci++) {
        var ci_cell = self._engine._cells[ci];
        var ci_info = self._engine._cellMap.get(ci_cell);
        if (ci_info && ci_info.terminalId === e.id && ci_cell !== cell) {
          e.connection.detach();
          self._engine._addToMinimized(e.id, e.connection);
          self._engine._clearCell(ci_cell);
          break;
        }
      }
    });

    var folderData = null;
    for (var fdi = 0; fdi < this._folders.length; fdi++) {
      if (this._folders[fdi].id === folderId) { folderData = this._folders[fdi]; break; }
    }
    var folderColors = folderData ? {
      headerBg: folderData.headerBg || null,
      headerColor: folderData.headerColor || null,
      headerHighlight: folderData.headerHighlight || null
    } : {};
    var fc = new ns.FolderCell(folderId, folderName, entries, folderColors);
    this._folderCells[folderId] = fc;
    this._engine.assignFolder(cell, fc);
    this._syncTerminalList();
  };

  App.prototype._findFirstEmptyCell = function () {
    if (!this._engine) return null;
    for (var i = 0; i < this._engine._cells.length; i++) {
      var info = this._engine._cellMap.get(this._engine._cells[i]);
      if (info && !info.connection) return this._engine._cells[i];
    }
    return null;
  };

  // --- Today Tasks ---

  App.prototype._initTodayTasks = function () {
    var listEl = document.getElementById('tt-list');
    var addInput = document.getElementById('tt-add-input');
    var dateLabelEl = document.getElementById('today-date-label');
    var navLeftEl = document.getElementById('tt-nav-left');
    var navRightEl = document.getElementById('tt-nav-right');
    if (!listEl || !ns.TodayTasks) return;
    this._todayTasks = new ns.TodayTasks(listEl, addInput, dateLabelEl, navLeftEl, navRightEl);
    this._todayTasks.init();
  };

  // --- File Tree ---

  App.prototype._initFileTree = function () {
    var self = this;
    var container = document.getElementById('file-tree');
    if (!container || !ns.FileTree) return;

    this._fileTree = new ns.FileTree(container, {
      onFileClick: function (filePath, fileName) {
        self._openFileInEditor(filePath, fileName);
      },
      onOpenTerminal: function (dirPath) {
        var name = dirPath ? dirPath.split('/').filter(Boolean).pop() : 'workspace';
        self._sendCreateTerminal(name || 'workspace', null, null, null, null, dirPath || null);
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

  // --- Claude File Tree ---

  App.prototype._initClaudeFileTree = function () {
    var self = this;
    var container = document.getElementById('claude-file-tree');
    if (!container || !ns.FileTree) return;

    this._claudeFileTree = new ns.FileTree(container, {
      apiBase: '/api/claude-files',
      onFileClick: function (filePath, fileName) {
        self._openFileInEditor(filePath, fileName);
      },
      onOpenTerminal: function (dirPath) {
        var name = dirPath ? dirPath.split('/').filter(Boolean).pop() : '.claude';
        var claudeRoot = (self._config && self._config.claudeRoot) || '';
        var absCwd = claudeRoot && dirPath ? claudeRoot + '/' + dirPath : claudeRoot || null;
        self._sendCreateTerminal(name || '.claude', null, null, null, null, absCwd);
      }
    });
    this._claudeFileTree.init();

    var refreshBtn = document.getElementById('claude-file-tree-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        refreshBtn.classList.add('ft-refreshing');
        self._claudeFileTree.refresh().then(function () {
          refreshBtn.classList.remove('ft-refreshing');
        }).catch(function () {
          refreshBtn.classList.remove('ft-refreshing');
        });
      });
    }
  };

  // --- Opencode File Tree ---

  App.prototype._initOpencodeFileTree = function () {
    var self = this;
    var container = document.getElementById('opencode-file-tree');
    if (!container || !ns.FileTree) return;

    this._opencodeFileTree = new ns.FileTree(container, {
      apiBase: '/api/opencode-files',
      onFileClick: function (filePath, fileName) {
        self._openFileInEditor(filePath, fileName);
      },
      onOpenTerminal: function (dirPath) {
        var name = dirPath ? dirPath.split('/').filter(Boolean).pop() : 'opencode';
        var opencodeRoot = (self._config && self._config.opencodeRoot) || '';
        var absCwd = opencodeRoot && dirPath ? opencodeRoot + '/' + dirPath : opencodeRoot || null;
        self._sendCreateTerminal(name || 'opencode', null, null, null, null, absCwd);
      }
    });
    this._opencodeFileTree.init();

    var refreshBtn = document.getElementById('opencode-file-tree-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        refreshBtn.classList.add('ft-refreshing');
        self._opencodeFileTree.refresh().then(function () {
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

  App.prototype._suppressMobileContextMenus = function () {
    var mq = window.matchMedia && window.matchMedia('(max-width: 767px)');
    if (!mq) return;
    function handler(e) { e.preventDefault(); }
    function apply(matches) {
      document.removeEventListener('contextmenu', handler);
      if (matches) document.addEventListener('contextmenu', handler);
    }
    apply(mq.matches);
    if (mq.addEventListener) {
      mq.addEventListener('change', function (e) { apply(e.matches); });
    } else if (mq.addListener) {
      mq.addListener(function (e) { apply(e.matches); });
    }
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

    // --- Sidebar resize handle ---
    var handle = document.getElementById('sidebar-resize-handle');
    if (handle && !self._isMobile()) {
      var startX, startW;

      handle.addEventListener('mousedown', function (e) {
        e.preventDefault();
        startX = e.clientX;
        startW = sidebar.getBoundingClientRect().width;
        sidebar.classList.add('resizing');
        handle.classList.add('active');

        function onMouseMove(e) {
          var newW = startW + (e.clientX - startX);
          if (newW < 180) newW = 180;
          var maxW = window.innerWidth * 0.5;
          if (newW > maxW) newW = maxW;
          sidebar.style.setProperty('--sidebar-width', newW + 'px');
        }

        function onMouseUp() {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          sidebar.classList.remove('resizing');
          handle.classList.remove('active');
          refit();
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    }
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

    // Open .md files in the dedicated markdown editor
    if (fileName.toLowerCase().endsWith('.md')) {
      this._openFileAsNote(filePath);
      return;
    }

    // Open other text files in the CodeMirror editor
    if (ns.isTextFile && ns.isTextFile(fileName)) {
      this._openFileAsEditor(filePath);
      return;
    }

    this._sendCreateTerminal(fileName, 'vi /workspace/' + filePath);
  };

  App.prototype._openFileAsNote = function (filePath) {
    var self = this;
    var absPath = '/workspace/' + filePath;

    // Re-focus if already open
    var existingId = null;
    Object.keys(this._connections).forEach(function (id) {
      var conn = self._connections[id];
      if (conn.type === 'note' && conn.config && conn.config.file === absPath) {
        existingId = id;
      }
    });
    if (existingId) {
      this._handleTerminalListSelect(existingId);
      return;
    }

    fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: filePath }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Server returned ' + res.status);
        return res.json();
      })
      .then(function (note) {
        if (!note || !note.id) throw new Error('Invalid note response');
        if (self._connections[note.id]) {
          self._handleTerminalListSelect(note.id);
          return;
        }
        var panel = new ns.NotePanel(note);
        panel._onDirtyChange = function () { self._syncTerminalList(); };
        self._connections[note.id] = panel;
        self._assignToFirstEmptyCell(note.id, panel);
        self._updateEmptyState();
        self._syncTerminalList();
      })
      .catch(function (err) {
        console.error('[app] openFileAsNote failed:', err);
      });
  };

  App.prototype._openFileAsEditor = function (filePath) {
    var self = this;
    var absPath = '/workspace/' + filePath;

    // Re-focus if already open
    var existingId = null;
    Object.keys(this._connections).forEach(function (id) {
      var conn = self._connections[id];
      if (conn.type === 'editor' && conn.config && conn.config.file === absPath) {
        existingId = id;
      }
    });
    if (existingId) {
      this._handleTerminalListSelect(existingId);
      return;
    }

    // Re-use the notes API – it stores file path + id, handles arbitrary files
    fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: filePath }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Server returned ' + res.status);
        return res.json();
      })
      .then(function (file) {
        if (!file || !file.id) throw new Error('Invalid response');

        if (self._connections[file.id]) {
          self._handleTerminalListSelect(file.id);
          return;
        }

        var panel = new ns.EditorPanel(file);
        panel._onDirtyChange = function () { self._syncTerminalList(); };
        self._connections[file.id] = panel;
        self._assignToFirstEmptyCell(file.id, panel);
        self._updateEmptyState();
        self._syncTerminalList();
      })
      .catch(function (err) {
        console.error('[app] openFileAsEditor failed:', err);
      });
  };

  // --- Mobile Toolbar ---

  // Deactivate the Ctrl modifier and remove visual highlight.
  // Called from both toolbar click handler and TerminalConnection when
  // a keyboard keystroke consumes the Ctrl state.
  App.prototype._deactivateCtrl = function () {
    this._ctrlActive = false;
    var ctrlBtn = document.querySelector('#mobile-toolbar [data-key="ctrl"]');
    if (ctrlBtn) ctrlBtn.classList.remove('ctrl-active');
  };

  App.prototype._deactivateAlt = function () {
    this._altActive = false;
    var altBtn = document.querySelector('#mobile-toolbar [data-key="alt"]');
    if (altBtn) altBtn.classList.remove('ctrl-active');
  };

  App.prototype._TOOLBAR_KEYS = {
    'esc':         '\x1b',
    'tab':         '\t',
    'up':          '\x1b[A',
    'down':        '\x1b[B',
    'left':        '\x1b[D',
    'right':       '\x1b[C',
    'pipe':        '|',
    'dash':        '-',
    'tilde':       '~',
    'slash':       '/',
    'colon':       ':',
    'bang':        '!',
    'lparen':      '(',
    'rparen':      ')',
    'lbracket':    '[',
    'rbracket':    ']',
    'lbrace':      '{',
    'rbrace':      '}',
    'lt':          '<',
    'gt':          '>',
    '1':           '1',
    '2':           '2',
    '3':           '3',
    '4':           '4',
    '5':           '5',
    'enter':       '\r',
    'pgup':        '\x1b[5~',
    'pgdn':        '\x1b[6~',
    'home':        '\x1b[H',
    'end':         '\x1b[F'
  };

  App.prototype._initMobileToolbar = function () {
    var toolbar = document.getElementById('mobile-toolbar');
    if (!toolbar) return;

    var self = this;

    // CRITICAL: Prevent focus theft.
    // Without this, tapping any button steals focus from xterm.js,
    // causing keyboard dismiss → viewport resize → SIGWINCH → readline corruption.
    // Exception: INPUT elements must be focusable (search/cmds inputs).
    toolbar.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'INPUT') return;
      e.preventDefault();
    });


    toolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('.mobile-toolbar-btn');
      if (!btn) return;

      var key = btn.dataset.key;
      if (!key) return;

      // Handle Ctrl toggle
      if (key === 'ctrl') {
        self._ctrlActive = !self._ctrlActive;
        btn.classList.toggle('ctrl-active', self._ctrlActive);
        return;
      }

      // Handle Alt toggle
      if (key === 'alt') {
        self._altActive = !self._altActive;
        btn.classList.toggle('ctrl-active', self._altActive);
        return;
      }

      var data;
      if (self._ctrlActive) {
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

        self._deactivateCtrl();
      } else if (self._altActive) {
        // Alt sends ESC prefix followed by the key
        data = '\x1b' + (self._TOOLBAR_KEYS[key] || key);
        self._deactivateAlt();
      } else {
        data = self._TOOLBAR_KEYS[key] || key;
      }

      self._sendToActiveTerminal(data);
    });

    // --- Swipe up/down to cycle toolbar states ---
    // States: 'collapsed' (handle only) -> 'normal' (2 rows) -> 'expanded' (4 rows)
    // Swipe up promotes, swipe down demotes.
    self._toolbarState = 'normal';

    var handle = toolbar.querySelector('.mobile-toolbar-handle');
    if (handle) {
      var touchStartY = null;
      var SWIPE_THRESHOLD = 30;

      handle.addEventListener('touchstart', function (e) {
        if (e.touches.length === 1) {
          touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      handle.addEventListener('touchmove', function (e) {
        if (touchStartY === null || e.touches.length !== 1) return;
        var dy = touchStartY - e.touches[0].clientY;

        if (dy > SWIPE_THRESHOLD) {
          // Swiped up — promote
          if (self._toolbarState === 'collapsed') {
            self._setToolbarState('normal');
          } else if (self._toolbarState === 'normal') {
            self._setToolbarState('expanded');
          }
          touchStartY = null;
        } else if (dy < -SWIPE_THRESHOLD) {
          // Swiped down — demote
          if (self._toolbarState === 'expanded') {
            self._setToolbarState('normal');
          } else if (self._toolbarState === 'normal') {
            self._setToolbarState('collapsed');
          }
          touchStartY = null;
        }
      }, { passive: true });

      handle.addEventListener('touchend', function () {
        touchStartY = null;
      }, { passive: true });

      // Click/tap on handle: cycle collapsed -> normal -> expanded -> collapsed
      handle.addEventListener('click', function () {
        if (self._toolbarState === 'collapsed') {
          self._setToolbarState('normal');
        } else if (self._toolbarState === 'normal') {
          self._setToolbarState('expanded');
        } else {
          self._setToolbarState('collapsed');
        }
      });
    }

    // --- Keyboard toggle ---
    // Default: keyboard hidden on mobile; user taps ⌨ to show it.
    this._keyboardHidden = true;
    ns.TerminalConnection.keyboardHidden = true;
    var kbToggle = document.getElementById('mt-kb-toggle');
    if (kbToggle) {
      kbToggle.classList.add('kb-hidden');
      kbToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        self._keyboardHidden = !self._keyboardHidden;
        ns.TerminalConnection.keyboardHidden = self._keyboardHidden;
        kbToggle.classList.toggle('kb-hidden', self._keyboardHidden);
        self._applyKeyboardHidden();
      });
    }

    // --- Mode tabs and panels ---
    this._initMobileToolbarModes();
    this._initSlashPanel();
    this._initCmdsPanel();
    this._initSessionsPanel();

  };

  App.prototype._setToolbarState = function (state) {
    var toolbar = document.getElementById('mobile-toolbar');
    if (!toolbar) return;

    this._toolbarState = state;

    toolbar.classList.toggle('expanded', state === 'expanded');
    toolbar.classList.toggle('collapsed', state === 'collapsed');
    document.body.classList.toggle('toolbar-expanded', state === 'expanded');
    document.body.classList.toggle('toolbar-collapsed', state === 'collapsed');

    // Refit terminals after the transition completes
    var self = this;
    setTimeout(function () {
      if (self._engine) self._engine.refitAll();
    }, 250);
  };

  // --- Mobile Toolbar: helper to get active terminal connection ---

  App.prototype._getActiveTerminalConnection = function () {
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

    if (activeConn && activeConn.type === 'editor') return null;
    return activeConn;
  };

  // --- Mobile Toolbar: Mode Switching ---

  App.prototype._initMobileToolbarModes = function () {
    var self = this;
    var toolbar = document.getElementById('mobile-toolbar');
    if (!toolbar) return;

    var tabs = toolbar.querySelectorAll('.mt-mode-tab[data-mode]');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        self._setToolbarMode(tab.dataset.mode);
      });
    });
  };

  App.prototype._setToolbarMode = function (mode) {
    var toolbar = document.getElementById('mobile-toolbar');
    if (!toolbar) return;

    var prev = this._toolbarMode;
    this._toolbarMode = mode;

    // Update tab active state
    var tabs = toolbar.querySelectorAll('.mt-mode-tab');
    tabs.forEach(function (tab) {
      tab.classList.toggle('mt-mode-tab-active', tab.dataset.mode === mode);
    });

    // Update panel visibility
    var panels = toolbar.querySelectorAll('.mt-panel');
    panels.forEach(function (panel) {
      panel.classList.toggle('mt-panel-active', panel.dataset.panel === mode);
    });

    // Activate new mode
    if (mode === 'cmds') {
      this._activateCmdsMode();
    } else if (mode === 'sessions') {
      this._refreshSessionsPanel();
    }
  };

  // --- Mobile Toolbar: Slash Commands Panel ---

  App.prototype._initSlashPanel = function () {
    // Render the default generic menu; context updates will swap it out
    this._rebuildSlashPanel('generic');
  };

  // --- Mobile Toolbar: Cmds Mode ---

  App.prototype._initCmdsPanel = function () {
    var self = this;
    var input = document.getElementById('mt-cmds-input');
    if (!input) return;

    input.addEventListener('input', function () {
      self._filterCmdsPanel(input.value);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        self._setToolbarMode('keys');
      }
    });
  };

  App.prototype._activateCmdsMode = function () {
    var self = this;
    // Load fresh history
    fetch('/api/history')
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to fetch history');
        return res.json();
      })
      .then(function (history) {
        self._cmdsHistory = history;
        self._cmdsFuse = typeof window.Fuse === 'function'
          ? new window.Fuse(history, { threshold: 0.4, distance: 100 })
          : null;
        self._renderCmdsList(history);
      })
      .catch(function () {
        self._cmdsHistory = [];
        self._renderCmdsList([]);
      });

    var input = document.getElementById('mt-cmds-input');
    if (input) {
      input.value = '';
      setTimeout(function () { input.focus(); }, 50);
    }
  };

  App.prototype._filterCmdsPanel = function (query) {
    if (!query || !query.trim()) {
      this._renderCmdsList(this._cmdsHistory);
      return;
    }
    if (this._cmdsFuse) {
      var results = this._cmdsFuse.search(query);
      this._renderCmdsList(results.map(function (r) { return r.item; }));
    }
  };

  App.prototype._renderCmdsList = function (items) {
    var list = document.getElementById('mt-cmds-list');
    if (!list) return;
    list.innerHTML = '';

    var self = this;
    items.forEach(function (cmd) {
      var el = document.createElement('button');
      el.className = 'mt-cmds-item';
      el.textContent = cmd;
      el.addEventListener('click', function () {
        self._typeAndSubmit(cmd);
      });
      list.appendChild(el);
    });
  };

  // --- Mobile Toolbar: Sessions Mode ---

  App.prototype._initSessionsPanel = function () {
    var self = this;
    var newBtn = document.getElementById('mt-sessions-new');
    if (newBtn) {
      newBtn.addEventListener('click', function () {
        self._showCreateDialog();
      });
    }
  };

  App.prototype._refreshSessionsPanel = function () {
    var list = document.getElementById('mt-sessions-list');
    if (!list) return;
    list.innerHTML = '';

    var self = this;
    var ids = Object.keys(this._connections);

    // Find which terminal is currently focused
    var activeId = null;
    if (this._engine) {
      for (var i = 0; i < this._engine._cells.length; i++) {
        var cell = this._engine._cells[i];
        var info = this._engine._cellMap.get(cell);
        if (info && info.connection && cell.contains(document.activeElement)) {
          activeId = info.terminalId;
          break;
        }
      }
    }

    ids.forEach(function (id) {
      var conn = self._connections[id];
      if (conn.type === 'editor') return; // Skip editor panels

      var item = document.createElement('div');
      item.className = 'mt-session-item';
      if (id === activeId) item.classList.add('mt-session-item-active');

      var dot = document.createElement('span');
      dot.className = 'mt-session-dot';
      if (conn.isActive()) dot.classList.add('mt-session-dot-connected');

      var name = document.createElement('span');
      name.className = 'mt-session-name';
      name.textContent = conn.config.name || id;

      var kill = document.createElement('button');
      kill.className = 'mt-session-kill';
      kill.textContent = '\u00d7';
      kill.title = 'Kill session';
      kill.addEventListener('click', function (e) {
        e.stopPropagation();
        self._sendDestroyTerminal(id);
      });

      item.appendChild(dot);
      item.appendChild(name);
      item.appendChild(kill);

      // Tap to switch to this terminal
      item.addEventListener('click', function () {
        // Find or assign a cell for this terminal
        if (self._engine) {
          // Check if it's already in a cell
          var found = false;
          for (var j = 0; j < self._engine._cells.length; j++) {
            var c = self._engine._cells[j];
            var ci = self._engine._cellMap.get(c);
            if (ci && ci.terminalId === id) {
              conn.focus();
              found = true;
              break;
            }
          }
          if (!found) {
            // Put it in the first available cell
            self._assignToFirstEmptyCell(id, conn);
            if (self._engine) self._engine.refitAll();
          }
        }
        // Refresh the panel to update active state
        self._refreshSessionsPanel();
        // Update context menu for the newly focused terminal
        self._updateContextMenu(id);
      });

      list.appendChild(item);
    });
  };

  // Type a string into the active terminal character-by-character, then
  // press Enter.  Each character is sent as a separate WebSocket message so
  // the PTY sees individual writes — exactly like real keyboard input.
  // This avoids the problem where bulk text + \r in a single write gets
  // treated as literal newlines by TUI apps (e.g. Claude Code).
  App.prototype._typeAndSubmit = function (text) {
    var self = this;
    var chars = (text + '\r').split('');
    var i = 0;
    (function next() {
      if (i < chars.length) {
        self._sendToActiveTerminal(chars[i++]);
        setTimeout(next, 10);
      }
    })();
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

    // Mobile toolbar only works with terminals, not editor panels
    if (activeConn.type === 'editor') return;

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

    if (!this._keyboardHidden) {
      activeConn.focus();
    }
  };

  // Toggle virtual keyboard visibility.  The static flag on TerminalConnection
  // gates focus() and a per-textarea focus listener handles xterm.js internals.
  App.prototype._applyKeyboardHidden = function () {
    if (this._keyboardHidden) {
      // Blur whatever is focused right now to dismiss the keyboard
      if (document.activeElement) document.activeElement.blur();
    } else {
      // Show keyboard by focusing the active terminal
      var conn = this._getActiveTerminalConnection();
      if (conn) conn.focus();
    }
  };

  // --- Command Palette ---

  App.prototype._initCommandPalette = function () {
    var container = document.getElementById('command-palette');
    if (!container || !ns.CommandPalette) return;

    var self = this;
    this._commandPalette = new ns.CommandPalette(container);

    this._commandPalette.onSelect = function (command) {
      self._typeAndSubmit(command);
    };

    // Mobile: swipe-right from left edge opens command palette
    this._initCommandPaletteSwipe();
  };

  App.prototype._handleHistoryUpdate = function (msg) {
    if (this._commandPalette && msg.history) {
      this._commandPalette.updateHistory(msg.history);
    }
    // Also update the mobile cmds panel
    if (msg.history) {
      this._cmdsHistory = msg.history;
      this._cmdsFuse = typeof window.Fuse === 'function'
        ? new window.Fuse(msg.history, { threshold: 0.4, distance: 100 })
        : null;
      if (this._toolbarMode === 'cmds') {
        var input = document.getElementById('mt-cmds-input');
        var query = input ? input.value : '';
        if (query.trim()) {
          this._filterCmdsPanel(query);
        } else {
          this._renderCmdsList(msg.history);
        }
      }
    }
  };

  App.prototype._initCommandPaletteSwipe = function () {
    var self = this;
    var startX = 0;
    var startY = 0;
    var tracking = false;

    document.addEventListener('touchstart', function (e) {
      var touch = e.touches[0];
      // Only track swipes starting from the right edge (last 30px)
      if (touch.clientX > window.innerWidth - 30) {
        startX = touch.clientX;
        startY = touch.clientY;
        tracking = true;
      }
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!tracking) return;

      var touch = e.touches[0];
      var dx = touch.clientX - startX;
      var dy = Math.abs(touch.clientY - startY);

      // Require horizontal swipe to the left, minimum 50px, more horizontal than vertical
      if (dx < -50 && dy < Math.abs(dx)) {
        tracking = false;
        if (self._commandPalette) {
          self._commandPalette.open();
        }
      }
    }, { passive: true });

    document.addEventListener('touchend', function () {
      tracking = false;
    }, { passive: true });
  };

  // --- Notifications ---

  App.prototype._initNotifications = function () {
    var self = this;
    this._audioCtx = null;

    // Request browser notification permission
    if (typeof Notification !== 'undefined' && Notification.requestPermission) {
      Notification.requestPermission();
    }

    // Unlock AudioContext on first user interaction (required by browser autoplay policy)
    function ensureAudioCtx() {
      if (self._audioCtx) return;
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      self._audioCtx = new AudioCtx();
      if (self._audioCtx.state === 'suspended') {
        self._audioCtx.resume();
      }
    }
    document.addEventListener('click', ensureAudioCtx, { once: true });
    document.addEventListener('keydown', ensureAudioCtx, { once: true });

    // Clear pending-notification pulse + bell indicators when a terminal cell gains focus
    document.addEventListener('focusin', function (e) {
      if (!self._engine) return;
      for (var i = 0; i < self._engine._cells.length; i++) {
        var cell = self._engine._cells[i];
        if (!cell.contains(e.target)) continue;
        if (cell.classList.contains('cell-task-pending')) {
          cell.classList.remove('cell-task-pending');
        }
        // Clear bell indicators and sidebar bells for the now-focused terminal
        var info = self._engine._cellMap.get(cell);
        if (info) {
          var focusedId = info.terminalId;
          if (focusedId) {
            // Clear tab bell (folder cells)
            var tabBell = cell.querySelector('.cell-header-tab[data-terminal-id="' + focusedId + '"] .cell-header-tab-bell');
            if (tabBell) tabBell.remove();
            // Clear header name bell (non-folder cells)
            var nameBell = cell.querySelector('.cell-header-name-bell');
            if (nameBell) nameBell.remove();
            // Clear sidebar bell
            if (self._terminalList) self._terminalList.clearBell(focusedId);
          }
        }
        break;
      }
    });

    // Wire bell toggle button
    var toggleBtn = document.getElementById('notification-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        ensureAudioCtx();
        self._toggleNotificationMute();
        toggleBtn.classList.toggle('notification-muted', self._notificationsMuted);
        toggleBtn.querySelector('.bell-on').style.display = self._notificationsMuted ? 'none' : '';
        toggleBtn.querySelector('.bell-off').style.display = self._notificationsMuted ? '' : 'none';
      });
    }
  };

  App.prototype._toggleNotificationMute = function () {
    this._notificationsMuted = !this._notificationsMuted;
  };

  App.prototype._handleTaskComplete = function (msg) {
    var terminalId = msg.terminalId;

    // Play audio ding (unless muted)
    if (!this._notificationsMuted) {
      this._playDing();
    }

    // Browser notification when tab is hidden (unless muted)
    if (!this._notificationsMuted && document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      var name = terminalId;
      var conn = this._connections[terminalId];
      if (conn && conn.config && conn.config.name) {
        name = conn.config.name;
      }
      new Notification('TerminalDeck — Task Complete', {
        body: 'Command finished in ' + name,
        tag: 'td-task-' + terminalId
      });
    }

    // Visual flash on the terminal's grid cell
    this._flashTerminalCell(terminalId);

    // Show bell indicator in the sidebar terminal list
    if (this._terminalList) {
      this._terminalList.showBell(terminalId);
    }

    // Show bell indicator on the folder tab (if terminal is in a folder cell)
    this._flashFolderTab(terminalId);
  };

  App.prototype._playDing = function () {
    try {
      var ctx = this._audioCtx;
      if (!ctx) return;
      // Resume if browser suspended the context (e.g. after tab backgrounding)
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      var notif = (this._config && this._config.settings && this._config.settings.notification) || {};
      var freq = notif.frequency || 830;
      var dur = notif.duration || 0.3;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + dur);
    } catch (e) {
      // Audio playback failure is non-critical
    }
  };

  App.prototype._flashTerminalCell = function (terminalId) {
    if (!this._engine) return;

    for (var i = 0; i < this._engine._cells.length; i++) {
      var cell = this._engine._cells[i];
      var info = this._engine._cellMap.get(cell);
      if (!info) continue;

      // Direct match (non-folder cell, or active tab in folder cell)
      var directMatch = info.terminalId === terminalId;
      // Folder cell containing this terminal as an inactive tab
      var folderMatch = !directMatch && info.folderCell &&
        info.folderCell.getTerminals().some(function (t) { return t.id === terminalId; });

      if (directMatch || folderMatch) {
        var isActive = cell.contains(document.activeElement);

        // Always do the one-shot flash
        cell.classList.remove('cell-task-complete');
        void cell.offsetWidth;
        cell.classList.add('cell-task-complete');
        setTimeout(function (c) {
          c.classList.remove('cell-task-complete');
        }, 1000, cell);

        // If the terminal isn't focused, keep the border pulsing until the user activates it
        if (!isActive) {
          cell.classList.add('cell-task-pending');

          // For non-folder cells, add a bell to the cell header name
          if (directMatch && !info.folderCell) {
            var nameEl = cell.querySelector('.cell-header-name');
            if (nameEl && !nameEl.querySelector('.cell-header-name-bell')) {
              var bell = document.createElement('span');
              bell.className = 'cell-header-name-bell';
              bell.textContent = '\uD83D\uDD14'; // 🔔
              nameEl.appendChild(bell);
            }
          }
        }
        break;
      }
    }
  };

  App.prototype._flashFolderTab = function (terminalId) {
    if (!this._engine) return;

    for (var i = 0; i < this._engine._cells.length; i++) {
      var cell = this._engine._cells[i];
      var info = this._engine._cellMap.get(cell);
      if (!info || !info.folderCell) continue;

      var tabs = info.folderCell.getTerminals();
      var found = false;
      for (var ti = 0; ti < tabs.length; ti++) {
        if (tabs[ti].id === terminalId) { found = true; break; }
      }
      if (!found) continue;

      // Find the tab button for this terminal and add a bell indicator
      var tabBtn = cell.querySelector('.cell-header-tab[data-terminal-id="' + terminalId + '"]');
      if (tabBtn && !tabBtn.querySelector('.cell-header-tab-bell')) {
        var bell = document.createElement('span');
        bell.className = 'cell-header-tab-bell';
        bell.textContent = '\uD83D\uDD14'; // 🔔
        tabBtn.appendChild(bell);
      }
      break;
    }
  };

  App.prototype._wireBeforeUnload = function () {
    var self = this;
    window.addEventListener('beforeunload', function (e) {
      var hasDirty = Object.keys(self._connections).some(function (id) {
        var conn = self._connections[id];
        return conn.type === 'editor' && conn.isDirty && conn.isDirty();
      });
      if (hasDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  };

  // --- Context-Aware Toolbar ---

  // Maps tmux pane_current_command values to context categories.
  // Edit docs/context-menus.md for the canonical reference.
  var CONTEXT_MAP = {
    'bash':    'shell',  'zsh':     'shell',  'sh':      'shell',
    'fish':    'shell',  'dash':    'shell',  'ash':     'shell',
    'ssh':     'shell',
    'claude':  'claude',
    'vim':     'vim',    'nvim':    'vim',    'vi':      'vim',
    'nano':    'nano',
    'less':    'pager',  'more':    'pager',  'man':     'pager',
    'python':  'python', 'python3': 'python', 'ipython': 'python',
    'node':    'node',
    'htop':    'monitor','top':     'monitor','btop':    'monitor'
  };

  // Tab labels for each context.
  var CONTEXT_LABELS = {
    shell:   'Shell',
    claude:  'Claude',
    vim:     'Vim',
    nano:    'Nano',
    pager:   'Pager',
    python:  'Python',
    node:    'Node',
    monitor: 'Monitor',
    generic: 'Cmds'
  };

  // Menu definitions for each context.
  // Each button: { label, text, type }
  //   type 'submit' -> text + Enter
  //   type 'slash'  -> text + Enter, displayed with '/' prefix via CSS
  //   type 'raw'    -> text only, no Enter
  //   type 'ctrl'   -> sends raw escape sequence (text IS the sequence)
  //
  // Rows 1-2 always visible, rows 3-4 shown when toolbar is expanded.
  // Edit this object freely — it is the only place you need to change menus.
  var CONTEXT_MENUS = {
    shell: [
      { label: 'git status',  text: 'git status',           type: 'submit' },
      { label: 'git diff',    text: 'git diff',             type: 'submit' },
      { label: 'git log',     text: 'git log --oneline -10',type: 'submit' },
      { label: 'ls -la',      text: 'ls -la',               type: 'submit' },
      { label: 'cd ..',       text: 'cd ..',                type: 'submit' },
      { label: 'clear',       text: 'clear',                type: 'submit' },
      { label: 'pwd',         text: 'pwd',                  type: 'submit' },
      { label: 'exit',        text: 'exit',                 type: 'submit' },
      // expanded rows
      { label: 'git add -A',  text: 'git add -A',           type: 'submit' },
      { label: 'git commit',  text: 'git commit',           type: 'submit' },
      { label: 'git push',    text: 'git push',             type: 'submit' },
      { label: 'git pull',    text: 'git pull',             type: 'submit' },
      { label: 'docker ps',   text: 'docker ps',            type: 'submit' },
      { label: 'npm run',     text: 'npm run ',             type: 'raw'    },
      { label: 'make',        text: 'make',                 type: 'submit' },
      { label: 'grep -r',     text: 'grep -r "" .',         type: 'raw'    }
    ],
    claude: [
      { label: 'clear',       text: '/clear',               type: 'slash'  },
      { label: 'compact',     text: '/compact',             type: 'slash'  },
      { label: 'status',      text: '/status',              type: 'slash'  },
      { label: 'help',        text: '/help',                type: 'slash'  },
      { label: 'commit',      text: '/commit',              type: 'slash'  },
      { label: 'review',      text: '/review',              type: 'slash'  },
      { label: 'fast',        text: '/fast',                type: 'slash'  },
      { label: 'exit',        text: '/exit',                type: 'slash'  },
      // expanded rows
      { label: 'commit & push', text: 'commit and push',   type: 'submit' },
      { label: 'run tests',   text: 'run tests',            type: 'submit' },
      { label: 'git status',  text: 'git status',           type: 'submit' },
      { label: 'git log',     text: 'git log --oneline -10',type: 'submit' },
      { label: 'explain error',text: 'explain this error',  type: 'submit' },
      { label: 'fix bug',     text: 'fix the bug',          type: 'submit' },
      { label: 'summarize',   text: 'summarize changes',    type: 'submit' },
      { label: 'undo',        text: 'undo last change',     type: 'submit' }
    ],
    vim: [
      { label: ':w',          text: ':w',                   type: 'submit' },
      { label: ':q',          text: ':q',                   type: 'submit' },
      { label: ':wq',         text: ':wq',                  type: 'submit' },
      { label: ':q!',         text: ':q!',                  type: 'submit' },
      { label: 'i',           text: 'i',                    type: 'raw'    },
      { label: 'v',           text: 'v',                    type: 'raw'    },
      { label: '/',           text: '/',                    type: 'raw'    },
      { label: 'u',           text: 'u',                    type: 'raw'    },
      // expanded rows
      { label: ':wqa',        text: ':wqa',                 type: 'submit' },
      { label: 'dd',          text: 'dd',                   type: 'raw'    },
      { label: 'yy',          text: 'yy',                   type: 'raw'    },
      { label: 'p',           text: 'p',                    type: 'raw'    },
      { label: 'gg',          text: 'gg',                   type: 'raw'    },
      { label: 'G',           text: 'G',                    type: 'raw'    },
      { label: ':s/',         text: ':s/',                  type: 'raw'    },
      { label: ':%s/',        text: ':%s/',                 type: 'raw'    }
    ],
    pager: [
      { label: 'q',           text: 'q',                    type: 'raw'    },
      { label: '/',           text: '/',                    type: 'raw'    },
      { label: 'n',           text: 'n',                    type: 'raw'    },
      { label: 'N',           text: 'N',                    type: 'raw'    },
      { label: 'g',           text: 'g',                    type: 'raw'    },
      { label: 'G',           text: 'G',                    type: 'raw'    },
      { label: 'space',       text: ' ',                    type: 'raw'    },
      { label: 'b',           text: 'b',                    type: 'raw'    },
      // expanded rows
      { label: 'h',           text: 'h',                    type: 'raw'    },
      { label: 'd',           text: 'd',                    type: 'raw'    },
      { label: 'u',           text: 'u',                    type: 'raw'    },
      { label: 'F',           text: 'F',                    type: 'raw'    }
    ],
    python: [
      { label: 'exit()',      text: 'exit()',               type: 'submit' },
      { label: 'help()',      text: 'help()',               type: 'submit' },
      { label: 'import ',     text: 'import ',              type: 'raw'    },
      { label: 'dir()',       text: 'dir()',                type: 'submit' },
      { label: 'print()',     text: 'print()',              type: 'raw'    },
      { label: 'type()',      text: 'type()',               type: 'raw'    },
      { label: 'len()',       text: 'len()',                type: 'raw'    },
      { label: 'list()',      text: 'list()',               type: 'raw'    },
      // expanded rows
      { label: 'try:',        text: 'try:',                 type: 'submit' },
      { label: 'for i in',    text: 'for i in ',            type: 'raw'    },
      { label: 'def ',        text: 'def ',                 type: 'raw'    },
      { label: 'class ',      text: 'class ',               type: 'raw'    }
    ],
    node: [
      { label: '.exit',       text: '.exit',                type: 'submit' },
      { label: '.help',       text: '.help',                type: 'submit' },
      { label: '.break',      text: '.break',               type: 'submit' },
      { label: '.clear',      text: '.clear',               type: 'submit' },
      { label: 'require()',   text: 'require()',            type: 'raw'    },
      { label: 'console.log()',text: 'console.log()',       type: 'raw'    },
      { label: 'typeof ',     text: 'typeof ',              type: 'raw'    },
      { label: 'JSON.str()',  text: 'JSON.stringify()',     type: 'raw'    },
      // expanded rows
      { label: 'process.exit()',text: 'process.exit()',     type: 'submit' },
      { label: 'async ',      text: 'async ',               type: 'raw'    },
      { label: 'const ',      text: 'const ',               type: 'raw'    },
      { label: 'function ',   text: 'function ',            type: 'raw'    }
    ],
    nano: [
      { label: 'Ctrl+O save', text: '\x0f',                type: 'ctrl'   },
      { label: 'Ctrl+X exit', text: '\x18',                type: 'ctrl'   },
      { label: 'Ctrl+W find', text: '\x17',                type: 'ctrl'   },
      { label: 'Ctrl+K cut',  text: '\x0b',                type: 'ctrl'   },
      { label: 'Ctrl+U paste',text: '\x15',                type: 'ctrl'   },
      { label: 'Ctrl+G help', text: '\x07',                type: 'ctrl'   },
      { label: 'Ctrl+C pos',  text: '\x03',                type: 'ctrl'   },
      { label: 'Ctrl+_ goto', text: '\x1f',                type: 'ctrl'   }
    ],
    monitor: [
      { label: 'q',           text: 'q',                    type: 'raw'    },
      { label: '/',           text: '/',                    type: 'raw'    },
      { label: 'k',           text: 'k',                    type: 'raw'    },
      { label: 'F5',          text: '\x1b[15~',             type: 'ctrl'   },
      { label: 'F6',          text: '\x1b[17~',             type: 'ctrl'   },
      { label: 'F9',          text: '\x1b[20~',             type: 'ctrl'   },
      { label: 'space',       text: ' ',                    type: 'raw'    },
      { label: 'u',           text: 'u',                    type: 'raw'    }
    ],
    generic: [
      { label: 'Ctrl+C',      text: '\x03',                type: 'ctrl'   },
      { label: 'Ctrl+D',      text: '\x04',                type: 'ctrl'   },
      { label: 'Ctrl+Z',      text: '\x1a',                type: 'ctrl'   },
      { label: 'q',           text: 'q',                    type: 'raw'    },
      { label: 'exit',        text: 'exit',                 type: 'submit' },
      { label: 'quit',        text: 'quit',                 type: 'submit' },
      { label: 'help',        text: 'help',                 type: 'submit' },
      { label: ':q',          text: ':q',                   type: 'submit' }
    ]
  };

  App.prototype._handlePaneContext = function (msg) {
    var self = this;
    var contexts = msg.contexts || {};
    // Merge incoming changes into our state
    Object.keys(contexts).forEach(function (id) {
      self._terminalContexts[id] = contexts[id];
    });
    // If the active terminal was in the update, refresh the panel
    var activeConn = this._getActiveTerminalConnection();
    if (activeConn && activeConn.id && (activeConn.id in contexts)) {
      this._updateContextMenu(activeConn.id);
    }
  };

  // Call when active terminal changes or context changes to sync the panel.
  App.prototype._updateContextMenu = function (terminalId) {
    var rawCmd = this._terminalContexts[terminalId] || '';
    var context = CONTEXT_MAP[rawCmd] || 'generic';
    if (context === this._currentContext) return;
    this._currentContext = context;
    this._rebuildSlashPanel(context);
  };

  // Rebuild the slash panel grid with the buttons for a given context.
  App.prototype._rebuildSlashPanel = function (context) {
    var self = this;
    var grid = document.getElementById('mt-slash-grid');
    if (!grid) return;

    var buttons = CONTEXT_MENUS[context] || CONTEXT_MENUS.generic;
    grid.innerHTML = '';

    buttons.forEach(function (btn, idx) {
      var el = document.createElement('button');
      el.className = 'mt-slash-btn';
      // Rows 3+ (idx >= 8) are expanded-only
      if (idx >= 8) el.classList.add('mt-slash-extra');
      // Slash type gets CSS '/' prefix
      if (btn.type === 'slash') el.dataset.slash = btn.text;

      el.textContent = btn.label;

      el.addEventListener('click', function () {
        if (btn.type === 'submit' || btn.type === 'slash') {
          self._typeAndSubmit(btn.text);
        } else {
          // 'raw' and 'ctrl': send without Enter
          self._typeRaw(btn.text);
        }
      });

      grid.appendChild(el);
    });

    // Update the tab label to reflect context
    var slashTab = document.querySelector('.mt-mode-tab[data-mode="slash"]');
    if (slashTab) {
      slashTab.textContent = CONTEXT_LABELS[context] || 'Cmds';
    }
  };

  // Send text to the active terminal WITHOUT appending Enter.
  // Used for raw keys (vim motions, pager navigation, partial input).
  App.prototype._typeRaw = function (text) {
    var self = this;
    var chars = text.split('');
    var i = 0;
    (function next() {
      if (i < chars.length) {
        self._sendToActiveTerminal(chars[i++]);
        setTimeout(next, 10);
      }
    })();
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
