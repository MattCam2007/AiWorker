(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  function TerminalList(container) {
    this._container = container;
    this._items = new Map();       // id -> DOM element (for compat / quick lookup)
    this._folders = [];            // [{ id, name, parentId, collapsed }]
    this._sessionFolders = {};     // sessionId -> folderId

    // Callbacks set by App
    this.onMinimize = null;
    this.onClose = null;
    this.onSelect = null;
    this.onCreateFolder = null;          // (name, parentId) -> void
    this.onRenameFolder = null;          // (id, name) -> void
    this.onDeleteFolder = null;          // (id) -> void
    this.onToggleFolder = null;          // (id, collapsed) -> void
    this.onMoveTerminal = null;          // (terminalId, folderId) -> void
    this.onUpdateFolderColors = null;    // (id, headerBg, headerColor) -> void
    this.onNewTerminalInFolder = null;   // (folderId) -> void

    this._activePicker = null;
  }

  TerminalList.prototype.setFolderData = function (folders, sessionFolders) {
    this._folders = folders || [];
    this._sessionFolders = sessionFolders || {};
  };

  // Full re-render of the list. `connections` is an array of:
  // { id, name, location, active, panelType }
  TerminalList.prototype.render = function (connections) {
    var self = this;
    this._items.clear();

    // Build a map of id -> connection info
    var byId = {};
    connections.forEach(function (c) { byId[c.id] = c; });

    // Group connections by folderId (null = root)
    var grouped = {}; // folderId|null -> [id]
    connections.forEach(function (c) {
      var fid = self._sessionFolders[c.id] || null;
      if (!grouped[fid]) grouped[fid] = [];
      grouped[fid].push(c.id);
    });

    // Build folder tree: parentId|null -> [folder]
    var folderTree = {};
    this._folders.forEach(function (f) {
      var pid = f.parentId || null;
      if (!folderTree[pid]) folderTree[pid] = [];
      folderTree[pid].push(f);
    });

    // Render into a fragment then replace container contents
    var frag = document.createDocumentFragment();
    this._renderLevel(frag, null, grouped, byId, folderTree, 0);
    this._container.innerHTML = '';
    this._container.appendChild(frag);
  };

  TerminalList.prototype._renderLevel = function (parent, parentFolderId, grouped, byId, folderTree, depth) {
    var self = this;
    var indent = depth * 14;

    // Render folders at this level
    var foldersHere = folderTree[parentFolderId] || [];
    foldersHere.forEach(function (folder) {
      var folderEl = self._createFolderEl(folder, indent);
      parent.appendChild(folderEl);

      if (!folder.collapsed) {
        var childrenEl = document.createElement('div');
        childrenEl.className = 'tl-folder-children';
        childrenEl.dataset.folderId = folder.id;
        self._renderLevel(childrenEl, folder.id, grouped, byId, folderTree, depth + 1);
        parent.appendChild(childrenEl);
      }
    });

    // Render terminals at this level
    var terminalsHere = grouped[parentFolderId] || [];
    terminalsHere.forEach(function (id) {
      var c = byId[id];
      if (!c) return;
      var el = self._createTerminalEl(c, indent);
      parent.appendChild(el);
      self._items.set(id, el);
    });
  };

  TerminalList.prototype._createFolderEl = function (folder, indent) {
    var self = this;
    var el = document.createElement('div');
    el.className = 'tl-folder';
    el.dataset.folderId = folder.id;
    el.style.paddingLeft = (12 + indent) + 'px';

    var toggle = document.createElement('span');
    toggle.className = 'tl-folder-toggle';
    toggle.textContent = folder.collapsed ? '\u25B6' : '\u25BC'; // ▶ / ▼
    el.appendChild(toggle);

    var icon = document.createElement('span');
    icon.className = 'tl-folder-icon';
    icon.textContent = folder.collapsed ? '\uD83D\uDCC1' : '\uD83D\uDCC2'; // 📁 / 📂
    el.appendChild(icon);

    var nameEl = document.createElement('span');
    nameEl.className = 'tl-folder-name';
    nameEl.textContent = folder.name;
    el.appendChild(nameEl);

    // Color indicator dot (shown when folder has a headerBg color)
    var colorDot = document.createElement('span');
    colorDot.className = 'tl-folder-color-dot';
    colorDot.title = folder.headerBg ? 'Folder color: ' + folder.headerBg : 'No folder color';
    colorDot.style.background = folder.headerBg || '';
    colorDot.style.opacity = folder.headerBg ? '1' : '0.2';
    el.appendChild(colorDot);

    var actions = document.createElement('span');
    actions.className = 'tl-folder-actions';

    // Style button — opens folder color picker
    var styleBtn = document.createElement('button');
    styleBtn.className = 'tl-btn tl-btn-folder-style';
    styleBtn.textContent = '\uD83C\uDFA8'; // 🎨
    styleBtn.title = 'Set folder color';
    styleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      self._showFolderColorPicker(folder, colorDot, styleBtn);
    });
    actions.appendChild(styleBtn);

    var newTermBtn = document.createElement('button');
    newTermBtn.className = 'tl-btn tl-btn-folder-new-term';
    newTermBtn.textContent = '\u2795'; // ➕
    newTermBtn.title = 'New terminal in folder';
    newTermBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (self.onNewTerminalInFolder) self.onNewTerminalInFolder(folder.id);
    });
    actions.appendChild(newTermBtn);

    var addBtn = document.createElement('button');
    addBtn.className = 'tl-btn tl-btn-folder-add';
    addBtn.textContent = '\uD83D\uDCC1'; // 📁
    addBtn.title = 'Add subfolder';
    addBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var name = prompt('Subfolder name:');
      if (name && name.trim() && self.onCreateFolder) {
        self.onCreateFolder(name.trim(), folder.id);
      }
    });
    actions.appendChild(addBtn);

    var renBtn = document.createElement('button');
    renBtn.className = 'tl-btn tl-btn-folder-ren';
    renBtn.textContent = '\u270E'; // ✎
    renBtn.title = 'Rename folder';
    renBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      self._startFolderRename(nameEl, folder);
    });
    actions.appendChild(renBtn);

    var delBtn = document.createElement('button');
    delBtn.className = 'tl-btn tl-btn-folder-del';
    delBtn.innerHTML = '&times;';
    delBtn.title = 'Delete folder';
    delBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (confirm('Delete folder "' + folder.name + '"? Terminals inside will be ungrouped.')) {
        if (self.onDeleteFolder) self.onDeleteFolder(folder.id);
      }
    });
    actions.appendChild(delBtn);

    el.appendChild(actions);

    // Toggle collapse on click
    el.addEventListener('click', function () {
      var newCollapsed = !folder.collapsed;
      folder.collapsed = newCollapsed;
      if (self.onToggleFolder) self.onToggleFolder(folder.id, newCollapsed);
    });

    return el;
  };

  TerminalList.prototype._startFolderRename = function (nameEl, folder) {
    var self = this;
    var input = document.createElement('input');
    input.className = 'tl-folder-rename-input';
    input.value = folder.name;
    nameEl.parentNode.replaceChild(input, nameEl);
    input.focus();
    input.select();

    function commit() {
      var val = input.value.trim();
      input.parentNode.replaceChild(nameEl, input);
      if (val && val !== folder.name && self.onRenameFolder) {
        self.onRenameFolder(folder.id, val);
      }
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { input.parentNode.replaceChild(nameEl, input); }
    });
  };

  TerminalList.prototype._createTerminalEl = function (c, indent) {
    var self = this;
    var isNote = c.panelType === 'note';
    var isEditor = c.panelType === 'editor';
    var item = document.createElement('div');
    item.className = 'tl-item';
    item.dataset.terminalId = c.id;
    if (isNote) item.dataset.panelType = 'note';
    if (isEditor) item.dataset.panelType = 'editor';
    item.style.paddingLeft = (12 + indent) + 'px';

    var dot = document.createElement('span');
    if (isNote) {
      dot.className = 'tl-status tl-status-note';
      dot.textContent = '\uD83D\uDCDD';
    } else if (isEditor) {
      dot.className = 'tl-status tl-status-editor';
      dot.textContent = '\u270F\uFE0F'; // ✏️
    } else {
      dot.className = 'tl-status ' + (c.active ? 'tl-status-active' : 'tl-status-idle');
    }
    item.appendChild(dot);

    var nameEl = document.createElement('span');
    nameEl.className = 'tl-name';
    nameEl.textContent = c.name;
    item.appendChild(nameEl);

    var locEl = document.createElement('span');
    locEl.className = 'tl-location';
    locEl.textContent = c.location;
    item.appendChild(locEl);

    var actions = document.createElement('span');
    actions.className = 'tl-actions';

    // Folder-assign button (terminals only, not notes or editors)
    if (!isNote && !isEditor) {
      var folderBtn = document.createElement('button');
      folderBtn.className = 'tl-btn tl-btn-folder';
      folderBtn.textContent = '\uD83D\uDCC2'; // 📂
      folderBtn.title = 'Move to folder';
      folderBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        self._showFolderPicker(c.id, folderBtn);
      });
      actions.appendChild(folderBtn);
    }

    var minBtn = document.createElement('button');
    minBtn.className = 'tl-btn tl-btn-minimize';
    minBtn.innerHTML = '&ndash;';
    minBtn.title = 'Minimize';
    if (c.location === 'Minimized') minBtn.style.display = 'none';
    minBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (self.onMinimize) self.onMinimize(c.id);
    });
    actions.appendChild(minBtn);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'tl-btn tl-btn-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (self.onClose) self.onClose(c.id);
    });
    actions.appendChild(closeBtn);

    item.appendChild(actions);
    item.addEventListener('click', function () {
      if (self.onSelect) self.onSelect(c.id);
    });

    return item;
  };

  TerminalList.prototype._showFolderPicker = function (terminalId, anchorEl) {
    var self = this;

    // Close existing picker
    if (this._activePicker) {
      this._activePicker.remove();
      this._activePicker = null;
    }

    var picker = document.createElement('div');
    picker.className = 'tl-folder-picker';

    // "No folder" option
    var noneOpt = document.createElement('div');
    noneOpt.className = 'tl-folder-picker-item';
    var currentFolder = this._sessionFolders[terminalId];
    if (!currentFolder) noneOpt.classList.add('tl-folder-picker-item--active');
    noneOpt.textContent = '(No folder)';
    noneOpt.addEventListener('click', function () {
      if (self.onMoveTerminal) self.onMoveTerminal(terminalId, null);
      picker.remove();
      self._activePicker = null;
    });
    picker.appendChild(noneOpt);

    // Render folders as a flat list with indentation showing depth
    var flatFolders = [];
    this._buildFlatFolderList(null, 0, flatFolders);

    flatFolders.forEach(function (entry) {
      var opt = document.createElement('div');
      opt.className = 'tl-folder-picker-item';
      if (currentFolder === entry.folder.id) opt.classList.add('tl-folder-picker-item--active');
      opt.style.paddingLeft = (10 + entry.depth * 12) + 'px';
      opt.textContent = '\uD83D\uDCC1 ' + entry.folder.name;
      opt.addEventListener('click', function () {
        if (self.onMoveTerminal) self.onMoveTerminal(terminalId, entry.folder.id);
        picker.remove();
        self._activePicker = null;
      });
      picker.appendChild(opt);
    });

    // Position near anchor
    var rect = anchorEl.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = rect.bottom + 'px';
    picker.style.left = rect.left + 'px';
    document.body.appendChild(picker);
    this._activePicker = picker;

    // Dismiss on outside click
    var dismiss = function (e) {
      if (!picker.contains(e.target) && e.target !== anchorEl) {
        picker.remove();
        self._activePicker = null;
        document.removeEventListener('mousedown', dismiss, true);
      }
    };
    setTimeout(function () {
      document.addEventListener('mousedown', dismiss, true);
    }, 0);
  };

  TerminalList.prototype._showFolderColorPicker = function (folder, colorDot, anchorEl) {
    var self = this;

    // Close existing picker
    if (this._activePicker) {
      this._activePicker.remove();
      this._activePicker = null;
    }

    var picker = document.createElement('div');
    picker.className = 'tl-folder-color-picker';

    var COLORS = [
      '#1a1a2e', '#16213e', '#0f3460', '#1b1b2f', '#162447',
      '#1f4068', '#2d4059', '#3a3a5c', '#4a4a6a', '#2c3e50',
      '#e94560', '#ff6b6b', '#ffa502', '#ffda79', '#33d9b2',
      '#34ace0', '#706fd3', '#ff5252', '#2ed573', '#1e90ff'
    ];

    function buildRow(label, currentColor, onPick) {
      var row = document.createElement('div');
      row.className = 'tl-fcp-row';

      var lbl = document.createElement('div');
      lbl.className = 'tl-fcp-label';
      lbl.textContent = label;
      row.appendChild(lbl);

      var swatches = document.createElement('div');
      swatches.className = 'tl-fcp-swatches';

      // "None" swatch
      var noneSwatch = document.createElement('button');
      noneSwatch.className = 'tl-fcp-swatch tl-fcp-swatch-none';
      if (!currentColor) noneSwatch.classList.add('tl-fcp-swatch-active');
      noneSwatch.title = 'None';
      noneSwatch.addEventListener('click', function (e) {
        e.stopPropagation();
        swatches.querySelectorAll('.tl-fcp-swatch').forEach(function (s) { s.classList.remove('tl-fcp-swatch-active'); });
        noneSwatch.classList.add('tl-fcp-swatch-active');
        onPick(null);
      });
      swatches.appendChild(noneSwatch);

      COLORS.forEach(function (color) {
        var sw = document.createElement('button');
        sw.className = 'tl-fcp-swatch';
        sw.style.background = color;
        if (currentColor === color) sw.classList.add('tl-fcp-swatch-active');
        sw.title = color;
        sw.addEventListener('click', function (e) {
          e.stopPropagation();
          swatches.querySelectorAll('.tl-fcp-swatch').forEach(function (s) { s.classList.remove('tl-fcp-swatch-active'); });
          sw.classList.add('tl-fcp-swatch-active');
          onPick(color);
        });
        swatches.appendChild(sw);
      });

      var native = document.createElement('input');
      native.type = 'color';
      native.className = 'tl-fcp-native';
      native.value = currentColor || '#333333';
      native.addEventListener('input', function (e) {
        e.stopPropagation();
        swatches.querySelectorAll('.tl-fcp-swatch').forEach(function (s) { s.classList.remove('tl-fcp-swatch-active'); });
        onPick(native.value);
      });
      swatches.appendChild(native);

      row.appendChild(swatches);
      return row;
    }

    var selectedBg = folder.headerBg || null;
    var selectedColor = folder.headerColor || null;

    picker.appendChild(buildRow('Background', selectedBg, function (c) { selectedBg = c; }));
    picker.appendChild(buildRow('Text', selectedColor, function (c) { selectedColor = c; }));

    var btnRow = document.createElement('div');
    btnRow.className = 'tl-fcp-btn-row';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'tl-fcp-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      picker.remove();
      self._activePicker = null;
    });
    btnRow.appendChild(cancelBtn);

    var saveBtn = document.createElement('button');
    saveBtn.className = 'tl-fcp-save';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      folder.headerBg = selectedBg;
      folder.headerColor = selectedColor;
      colorDot.style.background = selectedBg || '';
      colorDot.style.opacity = selectedBg ? '1' : '0.2';
      colorDot.title = selectedBg ? 'Folder color: ' + selectedBg : 'No folder color';
      if (self.onUpdateFolderColors) self.onUpdateFolderColors(folder.id, selectedBg, selectedColor);
      picker.remove();
      self._activePicker = null;
    });
    btnRow.appendChild(saveBtn);
    picker.appendChild(btnRow);

    // Prevent clicks inside from propagating
    picker.addEventListener('click', function (e) { e.stopPropagation(); });

    // Position near anchor
    var rect = anchorEl.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = rect.bottom + 4 + 'px';
    picker.style.left = rect.left + 'px';
    document.body.appendChild(picker);
    this._activePicker = picker;

    var dismiss = function (e) {
      if (!picker.contains(e.target) && e.target !== anchorEl) {
        picker.remove();
        self._activePicker = null;
        document.removeEventListener('mousedown', dismiss, true);
      }
    };
    setTimeout(function () {
      document.addEventListener('mousedown', dismiss, true);
    }, 0);
  };

  TerminalList.prototype._buildFlatFolderList = function (parentId, depth, result) {
    var self = this;
    this._folders
      .filter(function (f) { return (f.parentId || null) === parentId; })
      .forEach(function (f) {
        result.push({ folder: f, depth: depth });
        self._buildFlatFolderList(f.id, depth + 1, result);
      });
  };

  // --- Legacy compat methods used by older code paths ---

  TerminalList.prototype.remove = function (id) {
    var el = this._items.get(id);
    if (el) {
      el.remove();
      this._items.delete(id);
    }
  };

  TerminalList.prototype.updateLocation = function (id, location) {
    var el = this._items.get(id);
    if (!el) return;
    var loc = el.querySelector('.tl-location');
    if (loc) loc.textContent = location;
    var minBtn = el.querySelector('.tl-btn-minimize');
    if (minBtn) minBtn.style.display = (location === 'Minimized') ? 'none' : '';
  };

  TerminalList.prototype.updateActivity = function (id, active) {
    var el = this._items.get(id);
    if (!el || el.dataset.panelType === 'note' || el.dataset.panelType === 'editor') return;
    var dot = el.querySelector('.tl-status');
    if (!dot) return;
    if (active) {
      dot.classList.add('tl-status-active');
      dot.classList.remove('tl-status-idle');
    } else {
      dot.classList.remove('tl-status-active');
      dot.classList.add('tl-status-idle');
    }
  };

  ns.TerminalList = TerminalList;
})();
