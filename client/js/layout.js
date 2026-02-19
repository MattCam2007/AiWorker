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

  function LayoutEngine(gridContainer, stripContainer) {
    this._gridContainer = gridContainer;
    this._stripContainer = stripContainer;
    this._cells = [];
    this._cellMap = new Map(); // cell element -> { connection, terminalId }
    this._stripItems = new Map(); // terminalId -> strip element
    this._currentGrid = null;
    this._swapSource = null;
    this._fullscreenConnection = null;
    this._fullscreenOrigCell = null;
    this._resizeObserver = null;
    this._onCloseTerminal = null;
    this._onMinimizeTerminal = null;
    this._onUpdateTerminal = null;
    this._onLayoutChange = null;
    this._supersizeState = null;
    this._supersizeTerminalId = null;

    this._initResizeObserver();
    this._initKeyboardListeners();
  }

  LayoutEngine.GRID_PRESETS = GRID_PRESETS;

  LayoutEngine.prototype._initResizeObserver = function () {
    var self = this;
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(function () {
        self.refitAll();
      });
      this._resizeObserver.observe(this._gridContainer);
    }
  };

  LayoutEngine.prototype._initKeyboardListeners = function () {
    var self = this;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (self._fullscreenConnection) {
          self.exitFullscreen();
        } else if (self._supersizeState) {
          self.exitSupersize();
        }
      }
    });
  };

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
    var info = this._cellMap.get(cell);
    if (info) {
      info.connection = null;
      info.terminalId = null;
    }
    cell.classList.add('cell-empty');
    var header = cell.querySelector('.cell-header');
    if (header) {
      header.innerHTML = '';
      header.style.display = 'none';
      header.style.background = '';
      header.style.color = '';
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

    // Update CSS grid template
    this._gridContainer.style.gridTemplateColumns = 'repeat(' + newCols + ', 1fr)';
    this._gridContainer.style.gridTemplateRows = 'repeat(' + newRows + ', 1fr)';

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
          info.connection.detach();
          self._addToStrip(info.terminalId, info.connection);
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
    if (this._onLayoutChange) this._onLayoutChange();
  };

  LayoutEngine.prototype.applyLayout = function (layoutConfig, connections) {
    if (!layoutConfig) return;

    // Detach all current terminals for a clean layout replacement
    var self = this;
    this._cells.forEach(function (cell) {
      var info = self._cellMap.get(cell);
      if (info && info.connection) {
        info.connection.detach();
        self._clearCell(cell);
      }
    });

    this.setGrid(layoutConfig.grid);

    // Assign terminals from layout cells array (rows of IDs)
    var cellIndex = 0;
    var assigned = new Set();

    if (layoutConfig.cells) {
      for (var r = 0; r < layoutConfig.cells.length; r++) {
        var row = layoutConfig.cells[r];
        for (var c = 0; c < row.length; c++) {
          var termId = row[c];
          if (cellIndex < this._cells.length && connections[termId]) {
            this.assignTerminal(this._cells[cellIndex], termId, connections[termId]);
            assigned.add(termId);
          }
          cellIndex++;
        }
      }
    }

    // Put unassigned terminals in strip
    Object.keys(connections).forEach(function (id) {
      if (!assigned.has(id)) {
        self._addToStrip(id, connections[id]);
      }
    });

    // Refit after layout settles — double-rAF ensures one full rendering
    // cycle has completed before measuring container dimensions.
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          self.refitAll();
        });
      });
    }
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
    nameSpan.textContent = name;
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

    // Apply stored header colors
    if (connection.config.headerBg) {
      header.style.background = connection.config.headerBg;
    }
    if (connection.config.headerColor) {
      header.style.color = connection.config.headerColor;
    }

    if (!skipAttach) {
      // Attach to mount point
      connection.attach(mount);
    }

    // Remove from strip if present — may toggle strip visibility via CSS :empty,
    // changing the grid container's height after fit() already ran.
    this._removeFromStrip(terminalId);

    // Schedule a deferred refit to catch any layout shifts from strip
    // visibility changes or header display changes.  Double-rAF ensures
    // the browser has completed at least one full rendering cycle.
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

  LayoutEngine.prototype.minimizeTerminal = function (terminalId) {
    var self = this;
    var found = false;
    this._cells.forEach(function (cell) {
      var info = self._cellMap.get(cell);
      if (info && info.terminalId === terminalId) {
        var conn = info.connection;
        conn.detach();
        // Clear the cell
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
        // Add to strip
        self._addToStrip(terminalId, conn);
        found = true;
      }
    });
    if (found) {
      this.refitAll();
      if (this._onMinimizeTerminal) this._onMinimizeTerminal(terminalId);
      if (this._onLayoutChange) this._onLayoutChange();
    }
  };

  LayoutEngine.prototype._addToStrip = function (terminalId, connection) {
    if (this._stripItems.has(terminalId)) return;

    var item = document.createElement('div');
    item.className = 'strip-item';
    item.dataset.terminalId = terminalId;

    var dot = document.createElement('span');
    dot.className = 'strip-status';
    item.appendChild(dot);

    var nameEl = document.createElement('span');
    nameEl.className = 'strip-name';
    nameEl.textContent = connection.config.name || terminalId;
    item.appendChild(nameEl);

    var preview = document.createElement('span');
    preview.className = 'strip-preview';
    preview.textContent = connection.getLastOutput() || '';
    item.appendChild(preview);

    var self = this;

    var closeBtn = document.createElement('button');
    closeBtn.className = 'strip-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (self._onCloseTerminal) self._onCloseTerminal(terminalId);
    });
    item.appendChild(closeBtn);

    item.addEventListener('click', function () {
      self._handleStripClick(terminalId, connection);
    });

    this._stripContainer.appendChild(item);
    this._stripItems.set(terminalId, { element: item, connection: connection });
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

  LayoutEngine.prototype._removeFromStrip = function (terminalId) {
    var entry = this._stripItems.get(terminalId);
    if (entry) {
      entry.element.remove();
      this._stripItems.delete(terminalId);
    }
  };

  LayoutEngine.prototype._handleStripClick = function (terminalId, connection) {
    if (this._swapSource && this._swapSource.terminalId === terminalId) {
      // Deselect
      this._swapSource = null;
      this._clearHighlights();
      return;
    }

    this._swapSource = { terminalId: terminalId, connection: connection };
    this._clearHighlights();

    var entry = this._stripItems.get(terminalId);
    if (entry) {
      entry.element.classList.add('strip-item-selected');
    }
  };

  LayoutEngine.prototype._handleCellClick = function (cell) {
    var cellInfo = this._cellMap.get(cell);

    if (this._swapSource) {
      var sourceId = this._swapSource.terminalId;
      var sourceConn = this._swapSource.connection;

      // If cell has occupant, move occupant to strip
      if (cellInfo && cellInfo.connection) {
        cellInfo.connection.detach();
        this._addToStrip(cellInfo.terminalId, cellInfo.connection);
      }

      // Remove source from strip
      this._removeFromStrip(sourceId);

      // Assign source to cell
      this.assignTerminal(cell, sourceId, sourceConn);

      // Clear selection
      this._swapSource = null;
      this._clearHighlights();

      // Refit affected
      sourceConn.refit();
    } else if (!cellInfo || !cellInfo.connection) {
      // Empty cell clicked without selection — show popover
      this._showCellPopover(cell);
    }
  };

  LayoutEngine.prototype._showCellPopover = function (cell) {
    // Create a simple popover listing minimized terminals
    var existing = cell.querySelector('.cell-popover');
    if (existing) {
      existing.remove();
      return;
    }

    if (this._stripItems.size === 0) return;

    var popover = document.createElement('div');
    popover.className = 'cell-popover';

    var self = this;
    this._stripItems.forEach(function (entry, termId) {
      var btn = document.createElement('button');
      btn.className = 'popover-item';
      btn.textContent = entry.connection.config.name || termId;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        popover.remove();
        self._removeFromStrip(termId);
        self.assignTerminal(cell, termId, entry.connection);
        entry.connection.refit();
      });
      popover.appendChild(btn);
    });

    cell.appendChild(popover);

    // Close on outside click
    setTimeout(function () {
      if (typeof document === 'undefined') return;
      document.addEventListener(
        'click',
        function closePopover(e) {
          if (!popover.contains(e.target)) {
            popover.remove();
            document.removeEventListener('click', closePopover);
          }
        }
      );
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
    var bgSwatches = this._createColorSwatches(selectedBg, function (color) {
      selectedBg = color;
      header.style.background = color || '';
    });
    popover.appendChild(bgSwatches);

    // Text color
    var textLabel = document.createElement('label');
    textLabel.className = 'edit-label';
    textLabel.textContent = 'Header Text';
    popover.appendChild(textLabel);

    var selectedColor = connection.config.headerColor || null;
    var textSwatches = this._createColorSwatches(selectedColor, function (color) {
      selectedColor = color;
      header.style.color = color || '';
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
      document.addEventListener('click', closeEditPopover);
    }, 0);
  };

  LayoutEngine.prototype._createColorSwatches = function (activeColor, onSelect) {
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

    // Update strip item
    var stripEntry = this._stripItems.get(terminalId);
    if (stripEntry) {
      var stripName = stripEntry.element.querySelector('.strip-name');
      if (stripName) stripName.textContent = name;
    }
  };

  LayoutEngine.prototype._clearHighlights = function () {
    this._stripItems.forEach(function (entry) {
      entry.element.classList.remove('strip-item-selected');
    });
  };

  LayoutEngine.prototype.enterFullscreen = function (terminalId, connection) {
    var overlay = document.getElementById('fullscreen-overlay');
    if (!overlay) return;

    // Find which cell currently holds this terminal
    var self = this;
    this._cells.forEach(function (cell) {
      var info = self._cellMap.get(cell);
      if (info && info.terminalId === terminalId) {
        self._fullscreenOrigCell = cell;
      }
    });

    // Detach from cell
    connection.detach();

    // Show overlay
    overlay.classList.remove('hidden');
    this._fullscreenConnection = connection;

    // Attach to fullscreen container
    var container = overlay.querySelector('.fullscreen-terminal');
    connection.attach(container);
    connection.refit();
  };

  LayoutEngine.prototype.exitFullscreen = function () {
    var overlay = document.getElementById('fullscreen-overlay');
    if (!overlay || !this._fullscreenConnection) return;

    var conn = this._fullscreenConnection;
    conn.detach();

    overlay.classList.add('hidden');

    // Re-attach to original cell
    if (this._fullscreenOrigCell) {
      var info = this._cellMap.get(this._fullscreenOrigCell);
      if (info) {
        var mount = this._fullscreenOrigCell.querySelector('.cell-terminal');
        conn.attach(mount);
        conn.refit();
      }
    }

    this._fullscreenConnection = null;
    this._fullscreenOrigCell = null;
  };

  LayoutEngine.prototype.supersize = function (terminalId) {
    // If already supersized, exit first
    if (this._supersizeState) {
      this.exitSupersize();
    }

    // Snapshot current layout
    var assignments = [];
    var self = this;
    this._cells.forEach(function (cell, index) {
      var info = self._cellMap.get(cell);
      if (info && info.connection) {
        assignments.push({ cellIndex: index, terminalId: info.terminalId });
      }
    });

    this._supersizeState = {
      grid: this._currentGrid,
      assignments: assignments
    };
    this._supersizeTerminalId = terminalId;

    // Find the target connection before setGrid modifies state
    var targetConn = null;
    this._cells.forEach(function (cell) {
      var info = self._cellMap.get(cell);
      if (info && info.terminalId === terminalId) {
        targetConn = info.connection;
      }
    });
    if (!targetConn) {
      // Check strip
      var stripEntry = this._stripItems.get(terminalId);
      if (stripEntry) {
        targetConn = stripEntry.connection;
      }
    }

    if (!targetConn) {
      this._supersizeState = null;
      this._supersizeTerminalId = null;
      return;
    }

    // Switch to 1x1 — keeps cell 0's terminal, strips cells 1+
    this.setGrid('1x1');

    // Add supersized class
    this._gridContainer.classList.add('grid-container-supersized');

    // If target is already in cell 0, rebuild header to show "Exit Supersize"
    var cell0Info = this._cellMap.get(this._cells[0]);
    if (cell0Info && cell0Info.terminalId === terminalId) {
      this.assignTerminal(this._cells[0], terminalId, targetConn, { skipAttach: true });
      return;
    }

    // Move cell 0's current terminal to strip to make room
    if (cell0Info && cell0Info.connection) {
      cell0Info.connection.detach();
      this._addToStrip(cell0Info.terminalId, cell0Info.connection);
      this._clearCell(this._cells[0]);
    }

    // Pull target from strip and assign to the single cell
    this._removeFromStrip(terminalId);
    this.assignTerminal(this._cells[0], terminalId, targetConn);
  };

  LayoutEngine.prototype.exitSupersize = function () {
    if (!this._supersizeState) return;

    var saved = this._supersizeState;
    var supersizedId = this._supersizeTerminalId;
    this._supersizeState = null;
    this._supersizeTerminalId = null;

    // Remove supersized class
    this._gridContainer.classList.remove('grid-container-supersized');

    // Check if the supersized terminal is still in cell 0 and was originally
    // in a grid cell.  If so, we can avoid the destructive detach/reattach
    // cycle by reparenting the live xterm DOM — this keeps the WebSocket
    // connected and the terminal state intact (critical for TUI apps like
    // Claude Code that don't recover well from a full reconnect).
    var cell0Info = this._cellMap.get(this._cells[0]);
    var supersizedConn = (cell0Info && cell0Info.terminalId === supersizedId)
      ? cell0Info.connection : null;

    // Find original cell index (-1 means terminal was in strip, not in grid)
    var supersizedOrigIndex = -1;
    if (supersizedConn) {
      for (var i = 0; i < saved.assignments.length; i++) {
        if (saved.assignments[i].terminalId === supersizedId) {
          supersizedOrigIndex = saved.assignments[i].cellIndex;
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

      if (supersizedOrigIndex !== 0 && supersizedOrigIndex < this._cells.length) {
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

      // Restore other terminals from strip to their original cells
      saved.assignments.forEach(function (entry) {
        if (entry.terminalId === supersizedId) return; // already handled
        if (entry.cellIndex >= self._cells.length) return;
        var stripEntry = self._stripItems.get(entry.terminalId);
        if (!stripEntry) return;
        var conn = stripEntry.connection;
        self._removeFromStrip(entry.terminalId);
        self.assignTerminal(self._cells[entry.cellIndex], entry.terminalId, conn);
      });
    } else {
      // --- Slow path: terminal was supersized from the strip or is missing ---
      // Fall back to the original detach/reattach logic.
      if (cell0Info && cell0Info.connection) {
        cell0Info.connection.detach();
        this._addToStrip(cell0Info.terminalId, cell0Info.connection);
        this._clearCell(this._cells[0]);
      }

      this.setGrid(saved.grid);

      saved.assignments.forEach(function (entry) {
        if (entry.cellIndex >= self._cells.length) return;
        var stripEntry = self._stripItems.get(entry.terminalId);
        if (!stripEntry) return;
        var conn = stripEntry.connection;
        self._removeFromStrip(entry.terminalId);
        self.assignTerminal(self._cells[entry.cellIndex], entry.terminalId, conn);
      });
    }

    this.refitAll();
  };

  LayoutEngine.prototype.clearSupersize = function () {
    if (!this._supersizeState) return;
    this._supersizeState = null;
    this._supersizeTerminalId = null;
    this._gridContainer.classList.remove('grid-container-supersized');
  };

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

  ns.LayoutEngine = LayoutEngine;
})();
