(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  // --- Data Model ---

  function FolderCell(folderId, folderName, terminalEntries, colors) {
    this._folderId = folderId;
    this._folderName = folderName;
    this._terminals = (terminalEntries || []).map(function (e) {
      return { id: e.id, name: e.name, connection: e.connection };
    });
    this._activeId = this._terminals.length > 0 ? this._terminals[0].id : null;
    this._colors = colors || {};
  }

  FolderCell.prototype.getFolderId = function () {
    return this._folderId;
  };

  FolderCell.prototype.getFolderName = function () {
    return this._folderName;
  };

  FolderCell.prototype.getActiveTerminalId = function () {
    return this._activeId;
  };

  FolderCell.prototype.getActiveConnection = function () {
    if (!this._activeId) return null;
    for (var i = 0; i < this._terminals.length; i++) {
      if (this._terminals[i].id === this._activeId) {
        return this._terminals[i].connection;
      }
    }
    return null;
  };

  FolderCell.prototype.getTerminals = function () {
    return this._terminals.slice();
  };

  FolderCell.prototype.setActiveTab = function (terminalId) {
    if (terminalId === this._activeId) return null;
    var prevId = this._activeId;
    var prevConn = this.getActiveConnection();
    this._activeId = terminalId;
    var nextConn = this.getActiveConnection();
    return {
      prev: { id: prevId, conn: prevConn },
      next: { id: terminalId, conn: nextConn }
    };
  };

  FolderCell.prototype.addTerminal = function (id, name, connection) {
    this._terminals.push({ id: id, name: name, connection: connection });
    if (this._activeId === null) {
      this._activeId = id;
    }
  };

  FolderCell.prototype.removeTerminal = function (id) {
    var wasActive = id === this._activeId;
    var idx = -1;
    for (var i = 0; i < this._terminals.length; i++) {
      if (this._terminals[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return { wasActive: false, newActiveId: this._activeId };
    this._terminals.splice(idx, 1);
    var newActiveId = this._activeId;
    if (wasActive) {
      if (this._terminals.length === 0) {
        newActiveId = null;
      } else {
        var newIdx = Math.min(idx, this._terminals.length - 1);
        newActiveId = this._terminals[newIdx].id;
      }
      this._activeId = newActiveId;
    }
    return { wasActive: wasActive, newActiveId: newActiveId };
  };

  FolderCell.prototype.updateTerminalName = function (id, name) {
    for (var i = 0; i < this._terminals.length; i++) {
      if (this._terminals[i].id === id) {
        this._terminals[i].name = name;
        return;
      }
    }
  };

  // --- Renderer ---

  FolderCell.prototype.renderHeader = function (headerEl, callbacks) {
    var self = this;
    headerEl.innerHTML = '';

    var folderNameEl = document.createElement('span');
    folderNameEl.className = 'cell-header-folder-name';
    folderNameEl.textContent = this._folderName;
    headerEl.appendChild(folderNameEl);

    var tabsEl = document.createElement('div');
    tabsEl.className = 'cell-header-tabs';
    this._terminals.forEach(function (t) {
      var tab = document.createElement('button');
      tab.className = 'cell-header-tab';
      tab.dataset.terminalId = t.id;
      tab.textContent = t.name;
      if (t.id === self._activeId) {
        tab.classList.add('cell-header-tab-active');
      }
      tab.addEventListener('click', function (e) {
        e.stopPropagation();
        if (callbacks.onTabClick) callbacks.onTabClick(t.id);
      });
      (function (tid, tabEl) {
        tabEl.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (callbacks.onTabContextMenu) callbacks.onTabContextMenu(tid, e.clientX, e.clientY, tabEl);
        });
      })(t.id, tab);
      tabsEl.appendChild(tab);
    });
    headerEl.appendChild(tabsEl);

    var spacer = document.createElement('span');
    spacer.className = 'cell-header-spacer';
    headerEl.appendChild(spacer);

    var moreBtn = document.createElement('button');
    moreBtn.className = 'cell-header-more';
    moreBtn.innerHTML = '&#x22EE;';
    moreBtn.title = 'More options';
    moreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (callbacks.onMore) callbacks.onMore(e.clientX, e.clientY);
    });
    headerEl.appendChild(moreBtn);

    if (callbacks.isSupersized && callbacks.isSupersized()) {
      var exitSupersizeBtn = document.createElement('button');
      exitSupersizeBtn.className = 'cell-header-exit-supersize';
      exitSupersizeBtn.innerHTML = '&#x2921;';
      exitSupersizeBtn.title = 'Exit Supersize';
      exitSupersizeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (callbacks.onSupersize) callbacks.onSupersize();
      });
      headerEl.appendChild(exitSupersizeBtn);
    } else {
      var supersizeBtn = document.createElement('button');
      supersizeBtn.className = 'cell-header-supersize';
      supersizeBtn.innerHTML = '&#x2922;';
      supersizeBtn.title = 'Supersize';
      supersizeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (callbacks.onSupersize) callbacks.onSupersize();
      });
      headerEl.appendChild(supersizeBtn);
    }

    var minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'cell-header-minimize';
    minimizeBtn.innerHTML = '&ndash;';
    minimizeBtn.title = 'Minimize';
    minimizeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (callbacks.onMinimize) callbacks.onMinimize();
    });
    headerEl.appendChild(minimizeBtn);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'cell-header-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (callbacks.onClose) callbacks.onClose();
    });
    headerEl.appendChild(closeBtn);

    headerEl.style.display = '';
    this.applyColors(headerEl);
  };

  FolderCell.prototype.applyColors = function (headerEl) {
    var bg = this._colors.headerBg || null;
    var text = this._colors.headerColor || null;
    var hl = this._colors.headerHighlight || null;
    if (bg) headerEl.style.setProperty('--fc-bg', bg);
    else headerEl.style.removeProperty('--fc-bg');
    if (text) headerEl.style.setProperty('--fc-text', text);
    else headerEl.style.removeProperty('--fc-text');
    if (hl) headerEl.style.setProperty('--fc-hl', hl);
    else headerEl.style.removeProperty('--fc-hl');
    // Clear any inline background/color (e.g. from non-folder updateHeader calls)
    headerEl.style.background = '';
    headerEl.style.color = '';
  };

  FolderCell.prototype.setColors = function (colors) {
    this._colors = colors || {};
  };

  FolderCell.prototype.updateActiveTab = function (headerEl) {
    var activeId = this._activeId;
    var tabs = headerEl.querySelectorAll('.cell-header-tab');
    tabs.forEach(function (tab) {
      if (tab.dataset.terminalId === activeId) {
        tab.classList.add('cell-header-tab-active');
      } else {
        tab.classList.remove('cell-header-tab-active');
      }
    });
  };

  ns.FolderCell = FolderCell;
})();
