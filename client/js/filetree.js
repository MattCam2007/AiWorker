(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  /**
   * FileTree - lazy-loading file tree component.
   * @param {HTMLElement} container - element to render into
   * @param {Object} opts
   * @param {Function} opts.onFileClick - callback(path, name) when a file is clicked
   */
  function FileTree(container, opts) {
    this._container = container;
    this._onFileClick = (opts && opts.onFileClick) || function () {};
    this._cache = {};
    this._clipboard = null;
    this._contextMenu = null;

    var self = this;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && self._contextMenu) {
        self._dismissContextMenu();
      }
    });
  }

  FileTree.prototype.init = function () {
    this._container.innerHTML = '';
    this._cache = {};
    return this._loadDir('.', this._container, 0);
  };

  FileTree.prototype.refresh = function () {
    return this.init();
  };

  FileTree.prototype._loadDir = function (dirPath, parentEl, depth) {
    var self = this;

    if (this._cache[dirPath]) {
      this._renderEntries(this._cache[dirPath], parentEl, depth);
      return Promise.resolve();
    }

    return fetch('/api/files?path=' + encodeURIComponent(dirPath))
      .then(function (res) { return res.json(); })
      .then(function (entries) {
        self._cache[dirPath] = entries;
        self._renderEntries(entries, parentEl, depth);
      })
      .catch(function () {
        var err = document.createElement('div');
        err.className = 'ft-error';
        err.textContent = 'Failed to load';
        err.style.paddingLeft = (12 + depth * 16) + 'px';
        parentEl.appendChild(err);
      });
  };

  FileTree.prototype._renderEntries = function (entries, parentEl, depth) {
    var self = this;

    entries.forEach(function (entry) {
      var item = document.createElement('div');
      item.className = 'ft-item';
      item.style.paddingLeft = (12 + depth * 16) + 'px';
      item.dataset.path = entry.path;
      item.dataset.type = entry.type;

      var icon = document.createElement('span');
      icon.className = 'ft-icon';

      var label = document.createElement('span');
      label.className = 'ft-label';
      label.textContent = entry.name;

      item.addEventListener('contextmenu', function (e) {
        self._showContextMenu(e, item);
      });

      if (entry.type === 'dir') {
        icon.textContent = '\u25B6'; // right-pointing triangle
        item.classList.add('ft-dir');
        item.appendChild(icon);
        item.appendChild(label);
        parentEl.appendChild(item);

        var childContainer = document.createElement('div');
        childContainer.className = 'ft-children';
        childContainer.style.display = 'none';
        parentEl.appendChild(childContainer);

        (function (entryPath, ic, cc) {
          var loaded = false;
          item.addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = cc.style.display !== 'none';
            if (isOpen) {
              cc.style.display = 'none';
              ic.textContent = '\u25B6'; // collapsed
            } else {
              cc.style.display = '';
              ic.textContent = '\u25BC'; // expanded
              if (!loaded) {
                loaded = true;
                self._loadDir(entryPath, cc, depth + 1);
              }
            }
          });
        })(entry.path, icon, childContainer);
      } else {
        icon.textContent = '\u2022'; // bullet
        item.classList.add('ft-file');
        item.appendChild(icon);
        item.appendChild(label);
        parentEl.appendChild(item);

        (function (entryPath, entryName) {
          item.addEventListener('click', function (e) {
            e.stopPropagation();
            self._onFileClick(entryPath, entryName);
          });
        })(entry.path, entry.name);
      }
    });
  };

  FileTree.prototype._showContextMenu = function (e, item) {
    e.preventDefault();
    e.stopPropagation();

    this._dismissContextMenu();

    var path = item.dataset.path;
    var type = item.dataset.type;

    var menuItems;
    if (type === 'dir') {
      menuItems = ['New File', 'New Folder', null, 'Rename', 'Delete', null, 'Cut', 'Copy'];
      if (this._clipboard) {
        menuItems = menuItems.concat(['Paste']);
      }
    } else {
      menuItems = ['Rename', 'Delete', null, 'Cut', 'Copy'];
    }

    var menu = document.createElement('div');
    menu.className = 'ep-context-menu';

    this._buildMenuItems(menu, menuItems, path, type);

    menu.style.position = 'fixed';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    document.body.appendChild(menu);

    // Clamp to viewport
    var rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (e.clientX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (e.clientY - rect.height) + 'px';
    }

    this._contextMenu = menu;

    var self = this;
    setTimeout(function () {
      document.addEventListener('mousedown', function handler(ev) {
        if (self._contextMenu && !self._contextMenu.contains(ev.target)) {
          self._dismissContextMenu();
          document.removeEventListener('mousedown', handler);
        }
      });
    }, 0);
  };

  FileTree.prototype._dismissContextMenu = function () {
    if (this._contextMenu) {
      if (this._contextMenu.parentNode) {
        this._contextMenu.parentNode.removeChild(this._contextMenu);
      }
      this._contextMenu = null;
    }
  };

  FileTree.prototype._buildMenuItems = function (container, items, filePath, fileType) {
    var self = this;

    items.forEach(function (item) {
      if (item === null) {
        var divider = document.createElement('div');
        divider.className = 'ep-ctx-divider';
        container.appendChild(divider);
      } else {
        var el = document.createElement('div');
        el.className = 'ep-ctx-item';
        el.innerHTML = '<span class="ep-ctx-item-label">' + item + '</span>';
        el.addEventListener('click', function () {
          self._handleMenuAction(item, filePath, fileType);
          self._dismissContextMenu();
        });
        container.appendChild(el);
      }
    });
  };

  FileTree.prototype._handleMenuAction = function (action, filePath, fileType) {
    // Implemented in later units
  };

  ns.FileTree = FileTree;
})();
