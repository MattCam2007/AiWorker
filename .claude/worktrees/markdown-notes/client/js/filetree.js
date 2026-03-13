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

      var icon = document.createElement('span');
      icon.className = 'ft-icon';

      var label = document.createElement('span');
      label.className = 'ft-label';
      label.textContent = entry.name;

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

  ns.FileTree = FileTree;
})();
