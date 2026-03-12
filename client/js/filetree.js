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
        childContainer.dataset.dirPath = entry.path;
        childContainer.dataset.depth = depth + 1;
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
    var self = this;
    if (action === 'New File') { self._doCreate(filePath, 'file'); }
    else if (action === 'New Folder') { self._doCreate(filePath, 'dir'); }
    else if (action === 'Delete') { self._doDelete(filePath); }
    else if (action === 'Rename') { self._startRename(filePath, fileType); }
    else if (action === 'Cut') { self._doCut(filePath, fileType); }
    else if (action === 'Copy') { self._doCopy(filePath, fileType); }
    else if (action === 'Paste') { self._doPaste(filePath); }
  };

  FileTree.prototype._startRename = function (filePath, fileType) {
    var self = this;

    // Find the item element with this path
    var item = self._container.querySelector('[data-path="' + filePath + '"]');
    if (!item) return;

    var label = item.querySelector('.ft-label');
    if (!label) return;

    var originalName = label.textContent;

    var input = document.createElement('input');
    input.className = 'ft-rename-input';
    input.value = originalName;
    label.parentNode.replaceChild(input, label);
    input.focus();
    input.select();

    var committed = false;

    function commit() {
      if (committed) return;
      var newName = input.value.trim();
      if (!newName || newName === originalName) {
        // Cancel -- restore label
        input.parentNode.replaceChild(label, input);
        return;
      }
      committed = true;

      fetch('/api/fileops/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, newName: newName })
      })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          window.alert('Rename failed: ' + data.error);
          label.textContent = originalName;
          input.parentNode.replaceChild(label, input);
          return;
        }
        // Refresh parent dir
        var parts = filePath.split('/');
        var parentDir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
        self._refreshDir(parentDir);
      })
      .catch(function () {
        input.parentNode.replaceChild(label, input);
      });
    }

    function cancel() {
      if (committed) return;
      input.parentNode.replaceChild(label, input);
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { cancel(); }
    });

    input.addEventListener('blur', function () {
      if (!committed) commit();
    });
  };
  FileTree.prototype._doCut = function (filePath, fileType) {
    // Remove ft-cut from any previously cut item
    if (this._clipboard && this._clipboard.op === 'cut') {
      var prev = this._container.querySelector('[data-path="' + this._clipboard.path + '"]');
      if (prev) prev.classList.remove('ft-cut');
    }
    this._clipboard = { path: filePath, type: fileType, op: 'cut' };
    var item = this._container.querySelector('[data-path="' + filePath + '"]');
    if (item) item.classList.add('ft-cut');
  };

  FileTree.prototype._doCopy = function (filePath, fileType) {
    // Remove ft-cut from any previously cut item
    if (this._clipboard && this._clipboard.op === 'cut') {
      var prev = this._container.querySelector('[data-path="' + this._clipboard.path + '"]');
      if (prev) prev.classList.remove('ft-cut');
    }
    this._clipboard = { path: filePath, type: fileType, op: 'copy' };
  };

  FileTree.prototype._doPaste = function (destDir) {
    var self = this;
    if (!this._clipboard) return;

    var clip = this._clipboard;
    var endpoint = clip.op === 'cut' ? '/api/fileops/move' : '/api/fileops/copy';

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ src: clip.path, destDir: destDir })
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.error) {
        window.alert('Paste failed: ' + data.error);
        return;
      }
      // Clear ft-cut class from source item
      if (clip.op === 'cut') {
        var srcItem = self._container.querySelector('[data-path="' + clip.path + '"]');
        if (srcItem) srcItem.classList.remove('ft-cut');
      }
      // Clear clipboard
      self._clipboard = null;
      // Refresh both dirs
      var srcParent = clip.path.includes('/') ? clip.path.split('/').slice(0, -1).join('/') : '.';
      self._refreshDir(srcParent);
      self._refreshDir(destDir);
    })
    .catch(function () {
      window.alert('Paste failed: network error');
    });
  };

  FileTree.prototype._refreshDir = function (dirPath) {
    delete this._cache[dirPath];

    if (dirPath === '.') {
      this.init();
      return;
    }

    // Find the .ft-item.ft-dir whose data-path === dirPath
    var dirItem = this._container.querySelector('.ft-item.ft-dir[data-path="' + dirPath + '"]');
    if (!dirItem) { return; }

    // The childContainer is the next sibling
    var childContainer = dirItem.nextSibling;
    if (!childContainer || !childContainer.classList || !childContainer.classList.contains('ft-children')) { return; }

    var depth = parseInt(childContainer.dataset.depth, 10) || 0;
    childContainer.innerHTML = '';
    this._loadDir(dirPath, childContainer, depth);
  };

  FileTree.prototype._doCreate = function (parentPath, type) {
    var self = this;
    var targetContainer = (parentPath === '.') ? this._container : (function () {
      var dirItem = self._container.querySelector('.ft-item.ft-dir[data-path="' + parentPath + '"]');
      if (!dirItem) { return null; }
      var cc = dirItem.nextSibling;
      return (cc && cc.classList && cc.classList.contains('ft-children')) ? cc : null;
    })();

    if (!targetContainer) { return; }

    var input = document.createElement('input');
    input.className = 'ft-rename-input';
    input.placeholder = (type === 'file') ? 'filename.txt' : 'foldername';

    targetContainer.insertBefore(input, targetContainer.firstChild);
    input.focus();

    function commit() {
      var name = input.value.trim();
      if (!name) {
        cancel();
        return;
      }
      fetch('/api/fileops/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: parentPath, name: name, type: type })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (result.ok) {
            if (input.parentNode) { input.parentNode.removeChild(input); }
            self._refreshDir(parentPath);
          } else if (result.data && result.data.code === 'EEXIST') {
            window.alert('Already exists');
            if (input.parentNode) { input.parentNode.removeChild(input); }
          } else {
            window.alert('Error: ' + ((result.data && result.data.error) || 'unknown'));
          }
        })
        .catch(function () {
          window.alert('Error: unknown');
        });
    }

    function cancel() {
      if (input.parentNode) { input.parentNode.removeChild(input); }
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });

    input.addEventListener('blur', function () {
      if (input.value.trim()) {
        commit();
      } else {
        cancel();
      }
    });
  };

  FileTree.prototype._doDelete = function (filePath) {
    var self = this;
    if (!window.confirm('Delete "' + filePath + '"?')) { return; }

    fetch('/api/fileops/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (result.ok) {
          var parentDir = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : '.';
          self._refreshDir(parentDir);
        } else {
          window.alert('Delete failed: ' + ((result.data && result.data.error) || 'unknown'));
        }
      })
      .catch(function () {
        window.alert('Delete failed: unknown');
      });
  };

  ns.FileTree = FileTree;
})();
