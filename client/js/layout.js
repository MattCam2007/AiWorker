(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  var GRID_PRESETS = {
    '1x1': { cols: 1, rows: 1 },
    '2x1': { cols: 2, rows: 1 },
    '1x2': { cols: 1, rows: 2 },
    '2x2': { cols: 2, rows: 2 },
    '2x3': { cols: 2, rows: 3 },
    '3x2': { cols: 3, rows: 2 },
    '3x1': { cols: 3, rows: 1 },
    '1x3': { cols: 1, rows: 3 }
  };

  // --- Initialization ---

  function LayoutEngine(gridContainer) {
    this._gridContainer = gridContainer;
    this._cells = [];
    this._cellMap = new Map(); // cell element -> { connection, terminalId, folderCell? }
    this._minimized = new Map(); // terminalId -> connection
    this._currentGrid = null;
    this._resizeObserver = null;
    this._onCreateTerminal = null;
    this._onCloseTerminal = null;
    this._onMinimizeTerminal = null;
    this._onUpdateTerminal = null;
    this._onLayoutChange = null;
    this._onOpenFolderInCell = null; // (cell, folderId) -> void
    this._onCreateTerminalInFolder = null; // (folderId) -> void
    this._onEditFolder = null; // (folderId) -> void
    this._folders = []; // folder data for popover
    this._supersizeState = null;
    this._supersizeTerminalId = null;
    this._colProportions = null;
    this._rowProportions = null;
    this._gutters = [];

    this._initResizeObserver();
    this._initKeyboardListeners();
  }

  LayoutEngine.GRID_PRESETS = GRID_PRESETS;

  LayoutEngine.prototype._initResizeObserver = function () {
    var self = this;
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(function () {
        self.refitAll();
        self._positionGutters();
      });
      this._resizeObserver.observe(this._gridContainer);
    }
  };

  // --- Keyboard ---

  LayoutEngine.prototype._initKeyboardListeners = function () {
    var self = this;
    this._keydownHandler = function (e) {
      if (e.key === 'Escape') {
        if (self._supersizeState) {
          self.exitSupersize();
        }
      }
    };
    document.addEventListener('keydown', this._keydownHandler);
  };

  LayoutEngine.prototype.destroy = function () {
    document.removeEventListener('keydown', this._keydownHandler);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this._removeGutters();
  };

  // --- Cell Management ---

  LayoutEngine.prototype._createEmptyCell = function () {
    var self = this;
    var cell = document.createElement('div');
    cell.className = 'grid-cell cell-empty';

    var header = document.createElement('div');
    header.className = 'cell-header';
    header.style.display = 'none';
    cell.appendChild(header);

    var addBtn = document.createElement('button');
    addBtn.className = 'cell-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Create terminal';
    (function (cellEl) {
      addBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (self._onCreateTerminal) self._onCreateTerminal(cellEl);
      });
    })(cell);
    cell.appendChild(addBtn);

    var mount = document.createElement('div');
    mount.className = 'cell-terminal';
    cell.appendChild(mount);

    // Click handler for swap/placement
    (function (cellEl) {
      cellEl.addEventListener('click', function (e) {
        if (e.target.closest('.cell-terminal') && self._cellMap.get(cellEl) && self._cellMap.get(cellEl).connection) {
          return;
        }
        self._handleCellClick(cellEl);
      });
    })(cell);

    return cell;
  };

  LayoutEngine.prototype._clearCell = function (cell) {
    var existing = cell.querySelector('.cell-popover, .cell-edit-popover');
    if (existing && existing._cleanup) existing._cleanup();

    var info = this._cellMap.get(cell);
    if (info) {
      // If this is a folder cell, move all folder terminals to _minimized
      if (info.folderCell) {
        var self = this;
        info.folderCell.getTerminals().forEach(function (t) {
          if (t.connection) {
            if (t.id === info.terminalId) {
              t.connection.detach();
            }
            self._addToMinimized(t.id, t.connection);
          }
        });
      }
      info.connection = null;
      info.terminalId = null;
      info.folderCell = null;
    }
    cell.classList.remove('cell-folder-mode');
    cell.classList.add('cell-empty');
    var header = cell.querySelector('.cell-header');
    if (header) {
      header.innerHTML = '';
      header.style.display = 'none';
      header.style.background = '';
      header.style.color = '';
      header.style.removeProperty('--fc-bg');
      header.style.removeProperty('--fc-text');
      header.style.removeProperty('--fc-hl');
    }
    var mount = cell.querySelector('.cell-terminal');
    if (mount) mount.innerHTML = '';
  };

  LayoutEngine.prototype.setGrid = function (spec) {
    var preset = GRID_PRESETS[spec];
    if (!preset) return;

    var newCols = preset.cols;
    var newRows = preset.rows;
    var newTotal = newCols * newRows;
    var self = this;

    // Determine old grid dimensions for (row, col) mapping
    var oldCols = 1;
    if (this._currentGrid && GRID_PRESETS[this._currentGrid]) {
      oldCols = GRID_PRESETS[this._currentGrid].cols;
    }

    // Map old (row, col) positions to their cell elements
    var oldPosMap = {};
    this._cells.forEach(function (cell, index) {
      var r = Math.floor(index / oldCols);
      var c = index % oldCols;
      oldPosMap[r + ',' + c] = cell;
    });

    this._currentGrid = spec;

    // Initialize equal column/row proportions and update CSS grid template
    this._colProportions = [];
    for (var p = 0; p < newCols; p++) this._colProportions.push(1);
    this._rowProportions = [];
    for (var p = 0; p < newRows; p++) this._rowProportions.push(1);
    this._applyProportions();

    // Build new cells array, reusing old cells at matching (row, col) positions
    var newCells = [];
    var reused = new Set();

    for (var i = 0; i < newTotal; i++) {
      var r = Math.floor(i / newCols);
      var c = i % newCols;
      var oldCell = oldPosMap[r + ',' + c];

      if (oldCell) {
        // Reuse existing cell — terminal stays attached, no detach/reattach
        reused.add(oldCell);
        newCells.push(oldCell);
      } else {
        // New position — create empty cell
        var cell = this._createEmptyCell();
        this._cellMap.set(cell, { connection: null, terminalId: null });
        newCells.push(cell);
      }
    }

    // Minimize terminals on old cells that don't fit in the new grid
    this._cells.forEach(function (cell) {
      if (!reused.has(cell)) {
        var info = self._cellMap.get(cell);
        if (info && info.connection) {
          if (info.folderCell) {
            // Move all folder terminals to minimized
            info.folderCell.getTerminals().forEach(function (t) {
              if (t.connection) {
                if (t.id === info.terminalId) t.connection.detach();
                self._addToMinimized(t.id, t.connection);
              }
            });
          } else {
            info.connection.detach();
            self._addToMinimized(info.terminalId, info.connection);
          }
        }
        self._cellMap.delete(cell);
        cell.remove();
      }
    });

    // Reorder DOM — appendChild moves existing children to the correct position
    for (var j = 0; j < newCells.length; j++) {
      this._gridContainer.appendChild(newCells[j]);
    }

    this._cells = newCells;

    // Refit all terminals to their new cell dimensions
    this.refitAll();
    this._updateGutters();
    if (this._onLayoutChange) this._onLayoutChange();
  };

  LayoutEngine.prototype.assignTerminal = function (cell, terminalId, connection, options) {
    var mount = cell.querySelector('.cell-terminal');
    var header = cell.querySelector('.cell-header');
    var skipAttach = options && options.skipAttach;

    cell.classList.remove('cell-empty');
    this._cellMap.set(cell, { connection: connection, terminalId: terminalId });

    // Show header with terminal name and close button
    var name = connection.config.name || terminalId;
    header.innerHTML = '';

    var nameSpan = document.createElement('span');
    nameSpan.className = 'cell-header-name';
    if (connection.type === 'editor' && ns.getFileIcon) {
      nameSpan.classList.add('cell-header-name--with-icon');
      var iconSpan = document.createElement('span');
      iconSpan.className = 'cell-header-file-icon';
      iconSpan.innerHTML = ns.getFileIcon(connection.config.name || '', 'file', false);
      nameSpan.appendChild(iconSpan);
      var textSpan = document.createElement('span');
      textSpan.className = 'cell-header-name-text';
      textSpan.textContent = name;
      nameSpan.appendChild(textSpan);
    } else {
      nameSpan.textContent = name;
    }
    header.appendChild(nameSpan);

    var spacer = document.createElement('span');
    spacer.className = 'cell-header-spacer';
    header.appendChild(spacer);

    var self = this;

    var editBtn = document.createElement('button');
    editBtn.className = 'cell-header-edit';
    editBtn.innerHTML = '&#x270E;';
    editBtn.title = 'Edit';
    editBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      self._showEditPopover(cell, terminalId, connection);
    });
    header.appendChild(editBtn);

    var refreshBtn = document.createElement('button');
    refreshBtn.className = 'cell-header-refresh';
    refreshBtn.innerHTML = '&#x21BB;';
    refreshBtn.title = 'Refresh display';
    refreshBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      connection.refresh();
    });
    header.appendChild(refreshBtn);

    if (this._supersizeState) {
      var exitSupersizeBtn = document.createElement('button');
      exitSupersizeBtn.className = 'cell-header-exit-supersize';
      exitSupersizeBtn.innerHTML = '&#x2921;';
      exitSupersizeBtn.title = 'Exit Supersize';
      exitSupersizeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        self.exitSupersize();
      });
      header.appendChild(exitSupersizeBtn);
    } else {
      var supersizeBtn = document.createElement('button');
      supersizeBtn.className = 'cell-header-supersize';
      supersizeBtn.innerHTML = '&#x2922;';
      supersizeBtn.title = 'Supersize';
      supersizeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        self.supersize(terminalId);
      });
      header.appendChild(supersizeBtn);
    }

    var minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'cell-header-minimize';
    minimizeBtn.innerHTML = '&ndash;';
    minimizeBtn.title = 'Minimize';
    minimizeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      self.minimizeTerminal(terminalId);
    });
    header.appendChild(minimizeBtn);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'cell-header-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (self._onCloseTerminal) self._onCloseTerminal(terminalId);
    });
    header.appendChild(closeBtn);

    header.style.display = '';

    // Apply stored header colors (use resolved value for 'inherit')
    var effectiveBg = connection.config.resolvedHeaderBg ||
      (connection.config.headerBg && connection.config.headerBg !== 'inherit' ? connection.config.headerBg : null);
    var effectiveColor = connection.config.resolvedHeaderColor ||
      (connection.config.headerColor && connection.config.headerColor !== 'inherit' ? connection.config.headerColor : null);
    if (effectiveBg) header.style.background = effectiveBg;
    if (effectiveColor) header.style.color = effectiveColor;

    if (!skipAttach) {
      // Attach to mount point
      connection.attach(mount);
    }

    this._removeFromMinimized(terminalId);

    // Schedule a deferred refit to catch any layout shifts from header
    // display changes.  Double-rAF ensures the browser has completed at
    // least one full rendering cycle.
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          connection.refit();
          connection.focus();
        });
      });
    }

    if (this._onLayoutChange) this._onLayoutChange();
  };

  // --- Folder Cell ---

  LayoutEngine.prototype._makeFolderCallbacks = function (cell, folderCell) {
    var self = this;
    return {
      onTabClick: function (terminalId) {
        self._switchFolderTab(cell, terminalId);
      },
      onMore: function (x, y) {
        self._showFolderMoreMenu(x, y, cell, folderCell);
      },
      onRefresh: function () {
        var conn = folderCell.getActiveConnection();
        if (conn && conn.refresh) conn.refresh();
      },
      onSupersize: function () {
        if (self._supersizeState) {
          self.exitSupersize();
        } else {
          var activeId = folderCell.getActiveTerminalId();
          if (activeId) self.supersize(activeId);
        }
      },
      isSupersized: function () {
        return !!self._supersizeState;
      },
      onMinimize: function () {
        self.minimizeFolderCell(cell, folderCell);
      },
      onClose: function () {
        var activeId = folderCell.getActiveTerminalId();
        if (activeId && self._onCloseTerminal) self._onCloseTerminal(activeId);
      },
      onTabContextMenu: function (terminalId, x, y, tabEl) {
        self._showTabContextMenu(terminalId, x, y, tabEl, cell, folderCell);
      }
    };
  };

  LayoutEngine.prototype._showFolderMoreMenu = function (x, y, cell, folderCell) {
    var self = this;

    // Dismiss any existing menu
    var existing = document.querySelector('.td-folder-more-menu');
    if (existing) existing.remove();

    var menu = document.createElement('div');
    menu.className = 'ep-context-menu td-folder-more-menu';

    function addItem(label, action) {
      var el = document.createElement('div');
      el.className = 'ep-ctx-item';
      el.innerHTML = '<span class="ep-ctx-item-label">' + label + '</span>';
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        dismiss();
        action();
      });
      menu.appendChild(el);
    }

    function addSep() {
      var d = document.createElement('div');
      d.className = 'ep-ctx-divider';
      menu.appendChild(d);
    }

    function dismiss() {
      if (menu.parentNode) menu.parentNode.removeChild(menu);
      document.removeEventListener('mousedown', outsideClick, true);
      document.removeEventListener('keydown', onKey, true);
    }

    addItem('Folder Settings', function () {
      if (self._onEditFolder) self._onEditFolder(folderCell.getFolderId());
    });

    addItem('Refresh Display', function () {
      var conn = folderCell.getActiveConnection();
      if (conn && conn.refresh) conn.refresh();
    });

    addItem('New Terminal Here', function () {
      if (self._onCreateTerminalInFolder) self._onCreateTerminalInFolder(folderCell.getFolderId());
    });

    addSep();

    if (self._supersizeState) {
      addItem('Exit Supersize', function () {
        self.exitSupersize();
      });
    }

    // Position
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);

    // Clamp to viewport
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var rect = menu.getBoundingClientRect();
    if (rect.right > vw) menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > vh) menu.style.top = (y - rect.height) + 'px';

    function outsideClick(e) {
      if (!menu.contains(e.target)) dismiss();
    }
    function onKey(e) {
      if (e.key === 'Escape') dismiss();
    }
    setTimeout(function () {
      document.addEventListener('mousedown', outsideClick, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  };

  LayoutEngine.prototype._showTabContextMenu = function (terminalId, x, y, tabEl, cell, folderCell) {
    var self = this;

    // Dismiss any existing tab context menu
    var existing = document.querySelector('.td-tab-ctx-menu');
    if (existing) existing.remove();

    var menu = document.createElement('div');
    menu.className = 'ep-context-menu td-tab-ctx-menu';

    function addItem(label, danger, action) {
      var el = document.createElement('div');
      el.className = 'ep-ctx-item' + (danger ? ' ep-ctx-item--danger' : '');
      el.innerHTML = '<span class="ep-ctx-item-label">' + label + '</span>';
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        dismiss();
        action();
      });
      menu.appendChild(el);
    }

    function addSep() {
      var d = document.createElement('div');
      d.className = 'ep-ctx-divider';
      menu.appendChild(d);
    }

    function dismiss() {
      if (menu.parentNode) menu.parentNode.removeChild(menu);
      document.removeEventListener('mousedown', outsideClick, true);
      document.removeEventListener('keydown', onKey, true);
    }

    addItem('Rename', false, function () {
      self._showTabRenamePopover(terminalId, tabEl, cell, folderCell);
    });

    addItem('New Terminal Here', false, function () {
      if (self._onCreateTerminalInFolder) self._onCreateTerminalInFolder(folderCell.getFolderId());
    });

    addSep();

    var terminals = folderCell.getTerminals();

    addItem('Close Tab', true, function () {
      if (self._onCloseTerminal) self._onCloseTerminal(terminalId);
    });

    if (terminals.length > 1) {
      addItem('Close Others', true, function () {
        // snapshot before any mutations
        var othersToClose = terminals.filter(function (t) { return t.id !== terminalId; });
        othersToClose.forEach(function (t) {
          if (self._onCloseTerminal) self._onCloseTerminal(t.id);
        });
      });
    }

    // Position — set initial position before appending so getBoundingClientRect works
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);

    // Clamp to viewport after measuring actual size
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var rect = menu.getBoundingClientRect();
    if (rect.right > vw) menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > vh) menu.style.top = (y - rect.height) + 'px';

    function outsideClick(e) {
      if (!menu.contains(e.target)) dismiss();
    }
    function onKey(e) {
      if (e.key === 'Escape') dismiss();
    }
    setTimeout(function () {
      document.addEventListener('mousedown', outsideClick, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  };

  LayoutEngine.prototype._showTabRenamePopover = function (terminalId, tabEl, cell, folderCell) {
    var self = this;

    var existing = document.querySelector('.td-tab-rename-pop');
    if (existing) existing.remove();

    var terminals = folderCell.getTerminals();
    var currentName = '';
    var currentConn = null;
    for (var i = 0; i < terminals.length; i++) {
      if (terminals[i].id === terminalId) {
        currentName = terminals[i].name;
        currentConn = terminals[i].connection;
        break;
      }
    }

    var pop = document.createElement('div');
    pop.className = 'td-tab-rename-pop';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'td-tab-rename-input';
    input.value = currentName;
    pop.appendChild(input);

    var btnRow = document.createElement('div');
    btnRow.className = 'td-tab-rename-btns';

    function dismiss() {
      if (pop.parentNode) pop.parentNode.removeChild(pop);
      document.removeEventListener('mousedown', outsideClick, true);
    }

    function save() {
      var newName = input.value.trim();
      if (newName && newName !== currentName) {
        folderCell.updateTerminalName(terminalId, newName);
        // Update tab label immediately
        var tabsEl = cell.querySelector('.cell-header-tabs');
        if (tabsEl) {
          var tabs = tabsEl.querySelectorAll('.cell-header-tab');
          tabs.forEach(function (t) {
            if (t.dataset.terminalId === terminalId) t.textContent = newName;
          });
        }
        var existingBg = currentConn && currentConn.config ? currentConn.config.headerBg : undefined;
        var existingColor = currentConn && currentConn.config ? currentConn.config.headerColor : undefined;
        if (self._onUpdateTerminal) self._onUpdateTerminal(terminalId, newName, existingBg, existingColor);
      }
      dismiss();
    }

    var saveBtn = document.createElement('button');
    saveBtn.textContent = 'Rename';
    saveBtn.className = 'td-tab-rename-save';
    saveBtn.addEventListener('click', save);
    btnRow.appendChild(saveBtn);

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'td-tab-rename-cancel';
    cancelBtn.addEventListener('click', dismiss);
    btnRow.appendChild(cancelBtn);

    pop.appendChild(btnRow);
    document.body.appendChild(pop);

    // Position below the tab
    var tabRect = tabEl.getBoundingClientRect();
    pop.style.left = tabRect.left + 'px';
    pop.style.top = (tabRect.bottom + 4) + 'px';
    var popRect = pop.getBoundingClientRect();
    if (popRect.right > window.innerWidth) {
      pop.style.left = (window.innerWidth - popRect.width - 8) + 'px';
    }

    input.select();
    input.focus();

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') dismiss();
    });

    function outsideClick(e) {
      if (!pop.contains(e.target)) dismiss();
    }
    setTimeout(function () {
      document.addEventListener('mousedown', outsideClick, true);
    }, 0);
  };

  LayoutEngine.prototype.assignFolder = function (cell, folderCell) {
    var self = this;
    var mount = cell.querySelector('.cell-terminal');
    var header = cell.querySelector('.cell-header');

    cell.classList.remove('cell-empty');
    cell.classList.add('cell-folder-mode');

    var activeId = folderCell.getActiveTerminalId();
    var activeConn = folderCell.getActiveConnection();

    this._cellMap.set(cell, {
      connection: activeConn,
      terminalId: activeId,
      folderCell: folderCell
    });

    // Remove all folder terminals from minimized
    folderCell.getTerminals().forEach(function (t) {
      self._removeFromMinimized(t.id);
    });

    folderCell.renderHeader(header, this._makeFolderCallbacks(cell, folderCell));

    if (activeConn) {
      activeConn.attach(mount);
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            activeConn.refit();
            activeConn.focus();
          });
        });
      }
    }

    if (this._onLayoutChange) this._onLayoutChange();
  };

  LayoutEngine.prototype._switchFolderTab = function (cell, terminalId) {
    var info = this._cellMap.get(cell);
    if (!info || !info.folderCell) return;
    var folderCell = info.folderCell;

    var result = folderCell.setActiveTab(terminalId);
    if (!result) return; // already active

    var mount = cell.querySelector('.cell-terminal');
    var header = cell.querySelector('.cell-header');

    // Detach old connection
    if (result.prev.conn) {
      result.prev.conn.detach();
    }

    // Update cellMap
    this._cellMap.set(cell, {
      connection: result.next.conn,
      terminalId: result.next.id,
      folderCell: folderCell
    });

    // Attach new connection
    if (result.next.conn) {
      result.next.conn.attach(mount);
    }

    // Update active tab styling
    folderCell.updateActiveTab(header);

    // Clear bell indicator on the tab that was just activated
    var tabBell = header.querySelector('.cell-header-tab[data-terminal-id="' + terminalId + '"] .cell-header-tab-bell');
    if (tabBell) tabBell.remove();

    var self = this;
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (result.next.conn) {
            result.next.conn.refit();
            result.next.conn.focus();
          }
        });
      });
    }

    if (this._onLayoutChange) this._onLayoutChange();
  };

  // --- Minimized Terminals ---

  LayoutEngine.prototype.minimizeTerminal = function (terminalId) {
    var self = this;
    var found = false;
    this._cells.forEach(function (cell) {
      var info = self._cellMap.get(cell);
      if (!info || info.terminalId !== terminalId) return;

      if (info.folderCell) {
        // Active tab in a folder cell — remove from folder and switch or clear
        var folderCell = info.folderCell;
        var conn = info.connection;
        conn.detach();
        self._addToMinimized(terminalId, conn);
        var removeResult = folderCell.removeTerminal(terminalId);

        if (removeResult.newActiveId) {
          var newConn = folderCell.getActiveConnection();
          var mount = cell.querySelector('.cell-terminal');
          var header = cell.querySelector('.cell-header');
          self._cellMap.set(cell, {
            connection: newConn,
            terminalId: removeResult.newActiveId,
            folderCell: folderCell
          });
          if (newConn) newConn.attach(mount);
          folderCell.renderHeader(header, self._makeFolderCallbacks(cell, folderCell));
          if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                if (newConn) { newConn.refit(); newConn.focus(); }
              });
            });
          }
        } else {
          self._clearCell(cell);
        }
      } else {
        var conn = info.connection;
        conn.detach();
        info.connection = null;
        info.terminalId = null;
        cell.classList.add('cell-empty');
        var header = cell.querySelector('.cell-header');
        if (header) {
          header.innerHTML = '';
          header.style.display = 'none';
        }
        var mount = cell.querySelector('.cell-terminal');
        if (mount) mount.innerHTML = '';
        self._addToMinimized(terminalId, conn);
      }
      found = true;
    });
    if (found) {
      this.refitAll();
      if (this._onMinimizeTerminal) this._onMinimizeTerminal(terminalId);
      if (this._onLayoutChange) this._onLayoutChange();
    }
  };

  LayoutEngine.prototype.minimizeFolderCell = function (cell, folderCell) {
    this._clearCell(cell);
    this.refitAll();
    if (this._onLayoutChange) this._onLayoutChange();
  };

  LayoutEngine.prototype._addToMinimized = function (terminalId, connection) {
    if (!this._minimized.has(terminalId)) {
      this._minimized.set(terminalId, connection);
    }
  };

  LayoutEngine.prototype._removeFromGrid = function (terminalId) {
    var self = this;
    this._cells.forEach(function (cell) {
      var info = self._cellMap.get(cell);
      if (info && info.terminalId === terminalId) {
        self._clearCell(cell);
      }
    });
  };

  LayoutEngine.prototype._removeFromMinimized = function (terminalId) {
    this._minimized.delete(terminalId);
  };

  // --- Popovers ---

  LayoutEngine.prototype._handleCellClick = function (cell) {
    var cellInfo = this._cellMap.get(cell);
    if (!cellInfo || !cellInfo.connection) {
      this._showCellPopover(cell);
    }
  };

  LayoutEngine.prototype._showCellPopover = function (cell) {
    // Create a simple popover listing minimized terminals and available folders
    var existing = cell.querySelector('.cell-popover');
    if (existing) {
      existing.remove();
      return;
    }

    var hasFolders = this._folders && this._folders.length > 0;
    if (this._minimized.size === 0 && !hasFolders) return;

    var popover = document.createElement('div');
    popover.className = 'cell-popover';

    var self = this;
    this._minimized.forEach(function (conn, termId) {
      var btn = document.createElement('button');
      btn.className = 'popover-item';
      btn.textContent = conn.config.name || termId;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        popover.remove();
        self._removeFromMinimized(termId);
        self.assignTerminal(cell, termId, conn);
        conn.refit();
      });
      popover.appendChild(btn);
    });

    // Folders section
    if (hasFolders) {
      var folderSection = document.createElement('div');
      folderSection.className = 'popover-section';
      var folderLabel = document.createElement('div');
      folderLabel.className = 'popover-section-label';
      folderLabel.textContent = 'Folders';
      folderSection.appendChild(folderLabel);

      this._folders.forEach(function (folder) {
        var btn = document.createElement('button');
        btn.className = 'popover-item popover-folder-item';
        btn.textContent = '\uD83D\uDCC1 ' + folder.name;
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          popover.remove();
          if (self._onOpenFolderInCell) self._onOpenFolderInCell(cell, folder.id);
        });
        folderSection.appendChild(btn);
      });
      popover.appendChild(folderSection);
    }

    cell.appendChild(popover);

    // Close on outside click
    setTimeout(function () {
      if (typeof document === 'undefined') return;
      var closePopover = function (e) {
        if (!popover.contains(e.target)) {
          popover.remove();
          document.removeEventListener('click', closePopover);
        }
      };
      popover._cleanup = function () { document.removeEventListener('click', closePopover); };
      document.addEventListener('click', closePopover);
    }, 0);
  };

  LayoutEngine.prototype._showEditPopover = function (cell, terminalId, connection) {
    // Remove existing popover
    var existing = cell.querySelector('.cell-edit-popover');
    if (existing) {
      existing.remove();
      return;
    }

    var header = cell.querySelector('.cell-header');
    var origBg = header.style.background || '';
    var origColor = header.style.color || '';

    var popover = document.createElement('div');
    popover.className = 'cell-edit-popover';

    // Name input
    var nameLabel = document.createElement('label');
    nameLabel.className = 'edit-label';
    nameLabel.textContent = 'Name';
    popover.appendChild(nameLabel);

    var nameInput = document.createElement('input');
    nameInput.className = 'edit-name-input';
    nameInput.type = 'text';
    nameInput.value = connection.config.name || terminalId;
    popover.appendChild(nameInput);

    // Background color
    var bgLabel = document.createElement('label');
    bgLabel.className = 'edit-label';
    bgLabel.textContent = 'Header Background';
    popover.appendChild(bgLabel);

    var selectedBg = connection.config.headerBg || null;
    var bgSwatches = this._createColorSwatches(selectedBg, true, function (color) {
      selectedBg = color;
      var displayBg = color === 'inherit' ? (connection.config.resolvedHeaderBg || '') : (color || '');
      header.style.background = displayBg;
    });
    popover.appendChild(bgSwatches);

    // Text color
    var textLabel = document.createElement('label');
    textLabel.className = 'edit-label';
    textLabel.textContent = 'Header Text';
    popover.appendChild(textLabel);

    var selectedColor = connection.config.headerColor || null;
    var textSwatches = this._createColorSwatches(selectedColor, true, function (color) {
      selectedColor = color;
      var displayColor = color === 'inherit' ? (connection.config.resolvedHeaderColor || '') : (color || '');
      header.style.color = displayColor;
    });
    popover.appendChild(textSwatches);

    // Buttons
    var btnRow = document.createElement('div');
    btnRow.className = 'edit-btn-row';

    var self = this;

    function cleanup() {
      popover.remove();
      document.removeEventListener('click', closeEditPopover);
    }

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'edit-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      header.style.background = origBg;
      header.style.color = origColor;
      cleanup();
      connection.focus();
    });
    btnRow.appendChild(cancelBtn);

    var saveBtn = document.createElement('button');
    saveBtn.className = 'edit-save';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var newName = nameInput.value.trim() || terminalId;
      if (self._onUpdateTerminal) {
        self._onUpdateTerminal(terminalId, newName, selectedBg, selectedColor);
      }
      // Update header name immediately
      var nameSpan = header.querySelector('.cell-header-name');
      if (nameSpan) nameSpan.textContent = newName;
      cleanup();
      connection.focus();
    });
    btnRow.appendChild(saveBtn);

    popover.appendChild(btnRow);
    cell.appendChild(popover);

    // Prevent clicks inside popover from propagating to cell
    popover.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    // Prevent popover interaction from stealing terminal focus
    popover.addEventListener('mousedown', function (e) {
      if (e.target !== nameInput) {
        e.preventDefault();
      }
    });

    // Close on outside click
    function closeEditPopover(e) {
      if (!popover.contains(e.target) && e.target !== popover) {
        header.style.background = origBg;
        header.style.color = origColor;
        cleanup();
      }
    }

    setTimeout(function () {
      if (typeof document === 'undefined') return;
      popover._cleanup = function () { document.removeEventListener('click', closeEditPopover); };
      document.addEventListener('click', closeEditPopover);
    }, 0);
  };

  LayoutEngine.prototype._createColorSwatches = function (activeColor, allowInherit, onSelect) {
    // Support old 2-arg call signature: _createColorSwatches(activeColor, onSelect)
    if (typeof allowInherit === 'function') {
      onSelect = allowInherit;
      allowInherit = false;
    }
    var colors = [
      '#1a1a2e', '#16213e', '#0f3460', '#1b1b2f', '#162447',
      '#1f4068', '#2d4059', '#3a3a5c', '#4a4a6a', '#2c3e50',
      '#e94560', '#ff6b6b', '#ffa502', '#ffda79', '#33d9b2',
      '#34ace0', '#706fd3', '#ff5252', '#2ed573', '#1e90ff'
    ];

    var container = document.createElement('div');
    container.className = 'edit-swatches';

    // "None" swatch
    var noneSwatch = document.createElement('button');
    noneSwatch.className = 'edit-swatch edit-swatch-none';
    if (!activeColor) noneSwatch.classList.add('edit-swatch-active');
    noneSwatch.title = 'None';
    noneSwatch.addEventListener('click', function (e) {
      e.stopPropagation();
      container.querySelectorAll('.edit-swatch').forEach(function (s) {
        s.classList.remove('edit-swatch-active');
      });
      noneSwatch.classList.add('edit-swatch-active');
      onSelect(null);
    });
    container.appendChild(noneSwatch);

    // "Inherit" swatch — use parent folder's color
    if (allowInherit) {
      var inheritSwatch = document.createElement('button');
      inheritSwatch.className = 'edit-swatch edit-swatch-inherit';
      if (activeColor === 'inherit') inheritSwatch.classList.add('edit-swatch-active');
      inheritSwatch.title = 'Inherit from folder';
      inheritSwatch.addEventListener('click', function (e) {
        e.stopPropagation();
        container.querySelectorAll('.edit-swatch').forEach(function (s) {
          s.classList.remove('edit-swatch-active');
        });
        inheritSwatch.classList.add('edit-swatch-active');
        onSelect('inherit');
      });
      container.appendChild(inheritSwatch);
    }

    colors.forEach(function (color) {
      var swatch = document.createElement('button');
      swatch.className = 'edit-swatch';
      swatch.style.background = color;
      if (activeColor === color) swatch.classList.add('edit-swatch-active');
      swatch.addEventListener('click', function (e) {
        e.stopPropagation();
        container.querySelectorAll('.edit-swatch').forEach(function (s) {
          s.classList.remove('edit-swatch-active');
        });
        swatch.classList.add('edit-swatch-active');
        onSelect(color);
      });
      container.appendChild(swatch);
    });

    // Native color picker
    var native = document.createElement('input');
    native.type = 'color';
    native.className = 'edit-color-native';
    native.value = activeColor || '#333333';
    native.addEventListener('input', function (e) {
      e.stopPropagation();
      container.querySelectorAll('.edit-swatch').forEach(function (s) {
        s.classList.remove('edit-swatch-active');
      });
      onSelect(native.value);
    });
    container.appendChild(native);

    return container;
  };

  // --- Header ---

  LayoutEngine.prototype.updateFolderColors = function (folderId, bg, color, highlight) {
    var self = this;
    this._cells.forEach(function (cell) {
      var info = self._cellMap.get(cell);
      if (info && info.folderCell && info.folderCell.getFolderId() === folderId) {
        var header = cell.querySelector('.cell-header');
        if (header) {
          info.folderCell.setColors({ headerBg: bg, headerColor: color, headerHighlight: highlight });
          info.folderCell.applyColors(header);
        }
      }
    });
  };

  LayoutEngine.prototype.updateHeader = function (terminalId, name, headerBg, headerColor) {
    var self = this;
    // Update grid cell header
    this._cells.forEach(function (cell) {
      var info = self._cellMap.get(cell);
      if (info && info.terminalId === terminalId) {
        var header = cell.querySelector('.cell-header');
        if (header) {
          var nameSpan = header.querySelector('.cell-header-name');
          if (nameSpan) nameSpan.textContent = name;
          header.style.background = headerBg || '';
          header.style.color = headerColor || '';
        }
      }
    });
  };

  // --- Supersize ---

  LayoutEngine.prototype.supersize = function (terminalId) {
    // If already supersized, exit first
    if (this._supersizeState) {
      this.exitSupersize();
    }

    // Snapshot current layout
    var assignments = [];
    var self = this;
    var sourceFolderCell = null;
    this._cells.forEach(function (cell, index) {
      var info = self._cellMap.get(cell);
      if (info && info.connection) {
        assignments.push({
          cellIndex: index,
          terminalId: info.terminalId,
          folderCell: info.folderCell || null
        });
        // Check if the supersized terminal belongs to a folder cell
        if (info.folderCell) {
          var terminals = info.folderCell.getTerminals();
          for (var i = 0; i < terminals.length; i++) {
            if (terminals[i].id === terminalId) {
              sourceFolderCell = info.folderCell;
              break;
            }
          }
        }
      }
    });

    this._supersizeState = {
      grid: this._currentGrid,
      assignments: assignments,
      colProportions: this._colProportions ? this._colProportions.slice() : null,
      rowProportions: this._rowProportions ? this._rowProportions.slice() : null
    };
    this._supersizeTerminalId = terminalId;
    this._supersizeFolderCell = sourceFolderCell;

    // Find the target connection before setGrid modifies state
    var targetConn = null;
    this._cells.forEach(function (cell) {
      var info = self._cellMap.get(cell);
      if (info && info.terminalId === terminalId) {
        targetConn = info.connection;
      }
    });
    if (!targetConn && sourceFolderCell) {
      // Terminal might be an inactive tab in the folder cell
      var terminals = sourceFolderCell.getTerminals();
      for (var i = 0; i < terminals.length; i++) {
        if (terminals[i].id === terminalId && terminals[i].connection) {
          targetConn = terminals[i].connection;
          break;
        }
      }
    }
    if (!targetConn) {
      targetConn = this._minimized.get(terminalId) || null;
    }

    if (!targetConn) {
      this._supersizeState = null;
      this._supersizeTerminalId = null;
      this._supersizeFolderCell = null;
      return;
    }

    // Switch to 1x1 — keeps cell 0's terminal, strips cells 1+
    this.setGrid('1x1');

    // Add supersized class
    this._gridContainer.classList.add('grid-container-supersized');

    // If supersizing a folder cell, assign the whole folder to cell 0
    if (sourceFolderCell) {
      // Make sure the requested terminal is the active tab
      sourceFolderCell.setActiveTab(terminalId);

      // Clear cell 0 if it has something else
      var cell0Info = this._cellMap.get(this._cells[0]);
      if (cell0Info && cell0Info.connection) {
        cell0Info.connection.detach();
        // Only minimize if it's not part of the folder we're about to assign
        if (!cell0Info.folderCell || cell0Info.folderCell !== sourceFolderCell) {
          this._addToMinimized(cell0Info.terminalId, cell0Info.connection);
        }
        this._clearCell(this._cells[0]);
      }

      this.assignFolder(this._cells[0], sourceFolderCell);
      return;
    }

    // If target is already in cell 0, rebuild header to show "Exit Supersize"
    var cell0Info = this._cellMap.get(this._cells[0]);
    if (cell0Info && cell0Info.terminalId === terminalId) {
      this.assignTerminal(this._cells[0], terminalId, targetConn, { skipAttach: true });
      return;
    }

    // Move cell 0's current terminal to minimized to make room
    if (cell0Info && cell0Info.connection) {
      cell0Info.connection.detach();
      this._addToMinimized(cell0Info.terminalId, cell0Info.connection);
      this._clearCell(this._cells[0]);
    }

    // Pull target from minimized and assign to the single cell
    this._removeFromMinimized(terminalId);
    this.assignTerminal(this._cells[0], terminalId, targetConn);
  };

  LayoutEngine.prototype.exitSupersize = function () {
    if (!this._supersizeState) return;

    var saved = this._supersizeState;
    var supersizedId = this._supersizeTerminalId;
    var supersizedFolder = this._supersizeFolderCell;
    this._supersizeState = null;
    this._supersizeTerminalId = null;
    this._supersizeFolderCell = null;

    // Remove supersized class
    this._gridContainer.classList.remove('grid-container-supersized');

    // Check if the supersized terminal is still in cell 0 and was originally
    // in a grid cell.  If so, we can avoid the destructive detach/reattach
    // cycle by reparenting the live xterm DOM — this keeps the WebSocket
    // connected and the terminal state intact (critical for TUI apps like
    // Claude Code that don't recover well from a full reconnect).
    var cell0Info = this._cellMap.get(this._cells[0]);

    // For folder cells, match by folder cell reference (the active terminal
    // may have changed via tab switching while supersized)
    var supersizedConn = null;
    if (supersizedFolder && cell0Info && cell0Info.folderCell === supersizedFolder) {
      supersizedConn = cell0Info.connection;
    } else if (cell0Info && cell0Info.terminalId === supersizedId) {
      supersizedConn = cell0Info.connection;
    }

    // Find original cell index (-1 means terminal was minimized, not in grid)
    var supersizedOrigIndex = -1;
    if (supersizedConn) {
      for (var i = 0; i < saved.assignments.length; i++) {
        var entry = saved.assignments[i];
        if (supersizedFolder && entry.folderCell === supersizedFolder) {
          supersizedOrigIndex = entry.cellIndex;
          break;
        } else if (!supersizedFolder && entry.terminalId === supersizedId) {
          supersizedOrigIndex = entry.cellIndex;
          break;
        }
      }
    }

    var self = this;

    if (supersizedConn && supersizedOrigIndex >= 0) {
      // --- Fast path: reparent the live terminal without detach/reattach ---

      // Restore grid — cell 0 at (0,0) is always preserved by setGrid,
      // so the supersized terminal survives the grid transition intact.
      this.setGrid(saved.grid);

      if (supersizedFolder) {
        // Folder cell supersized — move entire folder back to original cell
        if (supersizedOrigIndex !== 0 && supersizedOrigIndex < this._cells.length) {
          var activeConn = supersizedFolder.getActiveConnection();
          if (activeConn && activeConn.moveTo) {
            var targetMount = this._cells[supersizedOrigIndex].querySelector('.cell-terminal');
            activeConn.moveTo(targetMount);
          }
          this._clearCell(this._cells[0]);
          this.assignFolder(this._cells[supersizedOrigIndex], supersizedFolder);
        } else {
          // Was originally in cell 0 — just re-render to swap supersize button
          this.assignFolder(this._cells[0], supersizedFolder);
        }
      } else if (supersizedOrigIndex !== 0 && supersizedOrigIndex < this._cells.length) {
        // Move xterm DOM from cell 0 to the terminal's original cell
        var targetMount = this._cells[supersizedOrigIndex].querySelector('.cell-terminal');
        supersizedConn.moveTo(targetMount);
        this._clearCell(this._cells[0]);
        this.assignTerminal(
          this._cells[supersizedOrigIndex], supersizedId, supersizedConn,
          { skipAttach: true }
        );
      } else {
        // Terminal was originally in cell 0 — just rebuild the header
        // (swaps the "Exit Supersize" button for the normal "Supersize" button)
        this.assignTerminal(
          this._cells[0], supersizedId, supersizedConn,
          { skipAttach: true }
        );
      }

      // Restore other terminals from minimized to their original cells
      saved.assignments.forEach(function (entry) {
        // Skip the supersized entry (already handled above)
        if (supersizedFolder && entry.folderCell === supersizedFolder) return;
        if (!supersizedFolder && entry.terminalId === supersizedId) return;
        if (entry.cellIndex >= self._cells.length) return;
        if (entry.folderCell) {
          self.assignFolder(self._cells[entry.cellIndex], entry.folderCell);
        } else {
          var conn = self._minimized.get(entry.terminalId);
          if (!conn) return;
          self._removeFromMinimized(entry.terminalId);
          self.assignTerminal(self._cells[entry.cellIndex], entry.terminalId, conn);
        }
      });
    } else {
      // --- Slow path: terminal was supersized from minimized or is missing ---
      // Fall back to the original detach/reattach logic.
      if (cell0Info && cell0Info.connection) {
        cell0Info.connection.detach();
        this._addToMinimized(cell0Info.terminalId, cell0Info.connection);
        this._clearCell(this._cells[0]);
      }

      this.setGrid(saved.grid);

      saved.assignments.forEach(function (entry) {
        if (entry.cellIndex >= self._cells.length) return;
        if (entry.folderCell) {
          self.assignFolder(self._cells[entry.cellIndex], entry.folderCell);
        } else {
          var conn = self._minimized.get(entry.terminalId);
          if (!conn) return;
          self._removeFromMinimized(entry.terminalId);
          self.assignTerminal(self._cells[entry.cellIndex], entry.terminalId, conn);
        }
      });
    }

    this.refitAll();

    // Restore resize proportions from before supersize
    if (saved.colProportions && this._colProportions &&
        saved.colProportions.length === this._colProportions.length) {
      this._colProportions = saved.colProportions;
      this._rowProportions = saved.rowProportions;
      this._applyProportions();
      this._updateGutters();
      this.refitAll();
    }
  };

  LayoutEngine.prototype.clearSupersize = function () {
    if (!this._supersizeState) return;
    this._supersizeState = null;
    this._supersizeTerminalId = null;
    this._supersizeFolderCell = null;
    this._gridContainer.classList.remove('grid-container-supersized');
  };

  // --- Layout / Resize ---

  LayoutEngine.prototype.refitAll = function () {
    this._cellMap.forEach(function (info) {
      if (info.connection) {
        info.connection.refit();
      }
    });
  };

  LayoutEngine.prototype.checkMobile = function () {
    if (typeof window.matchMedia !== 'undefined') {
      var mq = window.matchMedia('(max-width: 767px)');
      if (mq.matches) {
        this.setGrid('1x1');
        return true;
      }
    }
    return false;
  };

  // --- Grid Resize Gutters ---

  LayoutEngine.prototype._applyProportions = function () {
    if (this._colProportions) {
      this._gridContainer.style.gridTemplateColumns = this._colProportions
        .map(function (p) { return p + 'fr'; }).join(' ');
    }
    if (this._rowProportions) {
      this._gridContainer.style.gridTemplateRows = this._rowProportions
        .map(function (p) { return p + 'fr'; }).join(' ');
    }
  };

  LayoutEngine.prototype._updateGutters = function () {
    this._removeGutters();

    var cols = this._colProportions ? this._colProportions.length : 1;
    var rows = this._rowProportions ? this._rowProportions.length : 1;
    var self = this;

    for (var i = 0; i < cols - 1; i++) {
      (function (idx) {
        var gutter = document.createElement('div');
        gutter.className = 'grid-gutter grid-gutter-col';
        gutter.dataset.index = idx;
        gutter.addEventListener('mousedown', function (e) {
          self._startGutterDrag(e, gutter, 'col');
        });
        gutter.addEventListener('touchstart', function (e) {
          self._startGutterDrag(e, gutter, 'col');
        }, { passive: false });
        gutter.addEventListener('dblclick', function () {
          self._resetProportions('col');
        });
        self._gridContainer.appendChild(gutter);
        self._gutters.push(gutter);
      })(i);
    }

    for (var j = 0; j < rows - 1; j++) {
      (function (idx) {
        var gutter = document.createElement('div');
        gutter.className = 'grid-gutter grid-gutter-row';
        gutter.dataset.index = idx;
        gutter.addEventListener('mousedown', function (e) {
          self._startGutterDrag(e, gutter, 'row');
        });
        gutter.addEventListener('touchstart', function (e) {
          self._startGutterDrag(e, gutter, 'row');
        }, { passive: false });
        gutter.addEventListener('dblclick', function () {
          self._resetProportions('row');
        });
        self._gridContainer.appendChild(gutter);
        self._gutters.push(gutter);
      })(j);
    }

    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(function () {
        self._positionGutters();
      });
    }
  };

  LayoutEngine.prototype._removeGutters = function () {
    this._gutters.forEach(function (g) { g.remove(); });
    this._gutters = [];
  };

  LayoutEngine.prototype._positionGutters = function () {
    if (!this._gutters.length || !this._cells.length) return;

    var containerRect = this._gridContainer.getBoundingClientRect();
    var cols = this._colProportions ? this._colProportions.length : 1;
    var self = this;

    this._gutters.forEach(function (gutter) {
      var idx = parseInt(gutter.dataset.index, 10);

      if (gutter.classList.contains('grid-gutter-col')) {
        var leftCell = self._cells[idx];
        var rightCell = self._cells[idx + 1];
        if (leftCell && rightCell) {
          var leftRect = leftCell.getBoundingClientRect();
          var rightRect = rightCell.getBoundingClientRect();
          var mid = ((leftRect.right + rightRect.left) / 2) - containerRect.left;
          gutter.style.left = (mid - 5) + 'px';
          gutter.style.top = '0';
          gutter.style.height = containerRect.height + 'px';
        }
      } else {
        var topCell = self._cells[idx * cols];
        var bottomCell = self._cells[(idx + 1) * cols];
        if (topCell && bottomCell) {
          var topRect = topCell.getBoundingClientRect();
          var bottomRect = bottomCell.getBoundingClientRect();
          var mid = ((topRect.bottom + bottomRect.top) / 2) - containerRect.top;
          gutter.style.top = (mid - 5) + 'px';
          gutter.style.left = '0';
          gutter.style.width = containerRect.width + 'px';
        }
      }
    });
  };

  LayoutEngine.prototype._startGutterDrag = function (e, gutter, type) {
    e.preventDefault();

    var isTouch = e.type === 'touchstart';
    var index = parseInt(gutter.dataset.index, 10);
    var point = isTouch ? e.touches[0] : e;
    var startPos = type === 'col' ? point.clientX : point.clientY;
    var proportions = type === 'col' ? this._colProportions : this._rowProportions;
    var startProportions = proportions.slice();
    var totalFr = 0;
    proportions.forEach(function (p) { totalFr += p; });

    var containerRect = this._gridContainer.getBoundingClientRect();
    var count = proportions.length;
    var gap = 2;
    var padding = 2;
    var totalSize = type === 'col' ? containerRect.width : containerRect.height;
    var availableSize = totalSize - padding * 2 - gap * (count - 1);
    var pxPerFr = availableSize / totalFr;
    var minFr = totalFr * 0.08;
    var self = this;
    var rafPending = false;

    gutter.classList.add('grid-gutter-active');
    document.body.style.cursor = type === 'col' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';

    function onMove(e) {
      if (e.cancelable) e.preventDefault();
      if (rafPending) return;
      rafPending = true;

      var pt = e.touches ? e.touches[0] : e;
      var currentPos = type === 'col' ? pt.clientX : pt.clientY;
      var deltaPx = currentPos - startPos;
      var deltaFr = deltaPx / pxPerFr;

      requestAnimationFrame(function () {
        rafPending = false;

        var newBefore = startProportions[index] + deltaFr;
        var newAfter = startProportions[index + 1] - deltaFr;

        if (newBefore < minFr) {
          newAfter = startProportions[index] + startProportions[index + 1] - minFr;
          newBefore = minFr;
        }
        if (newAfter < minFr) {
          newBefore = startProportions[index] + startProportions[index + 1] - minFr;
          newAfter = minFr;
        }

        proportions[index] = newBefore;
        proportions[index + 1] = newAfter;

        self._applyProportions();
        self._positionGutters();
        self.refitAll();
      });
    }

    function onEnd() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      gutter.classList.remove('grid-gutter-active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
    }

    if (isTouch) {
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
    } else {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
    }
  };

  LayoutEngine.prototype._resetProportions = function (type) {
    var proportions = type === 'col' ? this._colProportions : this._rowProportions;
    if (!proportions) return;
    for (var i = 0; i < proportions.length; i++) {
      proportions[i] = 1;
    }
    this._applyProportions();
    this._positionGutters();
    this.refitAll();
  };

  ns.LayoutEngine = LayoutEngine;
})();
