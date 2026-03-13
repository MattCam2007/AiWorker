(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  // ─── File icon SVG builder ────────────────────────────────────────────────

  function _fileIconSvg(color, label) {
    var fontSize = (label && label.length > 3) ? '3.5' : '4.6';
    var textEl = label
      ? '<text x="8" y="12.6" text-anchor="middle" font-size="' + fontSize + '" fill="rgba(255,255,255,0.92)" font-family="monospace" font-weight="700" letter-spacing="-0.3">' + label + '</text>'
      : '';
    return (
      '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M3 1.5h7l3 3v10H3z" fill="' + color + '"/>' +
        '<path d="M10 1.5v3h3" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="0.75"/>' +
        '<path d="M10 1.5l3 3h-3z" fill="rgba(255,255,255,0.14)"/>' +
        textEl +
      '</svg>'
    );
  }

  var ICON_FOLDER_CLOSED = (
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M1.5 5.5H5.75L7.25 7H14.5V13a.5.5 0 01-.5.5H2a.5.5 0 01-.5-.5z" fill="#E8B84B"/>' +
      '<path d="M1.5 5.5H5.75L7.25 7H14.5V8.5H1.5z" fill="#FECE6B" opacity="0.45"/>' +
    '</svg>'
  );

  var ICON_FOLDER_OPEN = (
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M1.5 5.5H5.75L7.25 7H14.5V9H1.5z" fill="#FECE6B" opacity="0.8"/>' +
      '<path d="M1 9H15L13.5 13.5H2.5z" fill="#E8B84B"/>' +
    '</svg>'
  );

  // Extension → [color, label]
  var EXT_MAP = {
    py:['#4B8BBE','py'],   pyw:['#4B8BBE','py'],  pyi:['#4B8BBE','py'],
    js:['#F1C21B','js'],   mjs:['#F1C21B','js'],  cjs:['#F1C21B','js'],
    ts:['#3178C6','ts'],
    jsx:['#61DAFB','jsx'], tsx:['#61DAFB','tsx'],
    json:['#CB8309','{}'], json5:['#CB8309','{}'],
    html:['#E44D26','html'], htm:['#E44D26','html'],
    css:['#264DE4','css'],
    scss:['#CF649A','scss'], sass:['#CF649A','sass'], less:['#1D365D','less'],
    md:['#5294E2','md'],   mdx:['#5294E2','mdx'],  rst:['#5294E2','rst'],
    sh:['#4EAA25','sh'],   bash:['#4EAA25','sh'],  zsh:['#4EAA25','sh'],  fish:['#4EAA25','sh'],
    ps1:['#012456','ps1'],
    yml:['#CB171E','yml'],  yaml:['#CB171E','yml'],
    toml:['#9C4221','toml'], ini:['#6E6E6E','ini'], cfg:['#6E6E6E','cfg'], conf:['#6E6E6E','conf'],
    lock:['#888888','lock'], txt:['#8a97a3','txt'], log:['#8a97a3','log'],
    svg:['#FFB13B','svg'],
    png:['#A855F7','img'],  jpg:['#A855F7','img'],  jpeg:['#A855F7','img'],
    gif:['#A855F7','gif'],  webp:['#A855F7','img'], ico:['#A855F7','ico'],  bmp:['#A855F7','img'],
    rs:['#DEA584','rs'],   go:['#00ADD8','go'],   rb:['#CC342D','rb'],   php:['#777BB4','php'],
    java:['#B07219','java'], kt:['#A97BFF','kt'],  kts:['#A97BFF','kt'],
    swift:['#FFAC45','sw'],
    c:['#555555','c'],     cpp:['#F34B7D','cpp'], cc:['#F34B7D','cpp'],  cxx:['#F34B7D','cpp'],
    h:['#555555','h'],     hpp:['#F34B7D','hpp'],
    cs:['#178600','cs'],   vue:['#41B883','vue'],  lua:['#000080','lua'],
    r:['#276DC3','r'],     sql:['#E38D00','sql'],
    graphql:['#E10098','gql'], gql:['#E10098','gql'],
    proto:['#00ADEF','prt'], tf:['#7B42BC','tf'],  hcl:['#7B42BC','hcl'],
    xml:['#E34C26','xml'],  csv:['#237346','csv'], pdf:['#B30B00','pdf'],
    wasm:['#654FF0','wsm'], ipynb:['#F37626','jup'],
    dart:['#00B4AB','dart'], ex:['#6E4A7E','ex'],   exs:['#6E4A7E','ex'],
    hs:['#5D4F85','hs'],   elm:['#60B5CC','elm'],
    clj:['#DB5855','clj'], nim:['#FFE953','nim'],  zig:['#F7A41D','zig'],
    env:['#ECD53F','env'],
  };

  // Special filenames (lowercased) → [color, label]
  var FNAME_MAP = {
    'package.json':         ['#CB3837','npm'],
    'package-lock.json':    ['#CB3837','npm'],
    '.gitignore':           ['#F54D27','git'],
    '.gitattributes':       ['#F54D27','git'],
    '.gitmodules':          ['#F54D27','git'],
    '.gitconfig':           ['#F54D27','git'],
    'makefile':             ['#427819','mk'],
    'gemfile':              ['#CC342D','gem'],
    'gemfile.lock':         ['#CC342D','gem'],
    'rakefile':             ['#CC342D','rake'],
    'cargo.toml':           ['#DEA584','rs'],
    'cargo.lock':           ['#DEA584','rs'],
    '.eslintrc':            ['#4B32C3','esl'],
    '.eslintrc.js':         ['#4B32C3','esl'],
    '.eslintrc.json':       ['#4B32C3','esl'],
    '.prettierrc':          ['#F7B93E','fmt'],
    '.babelrc':             ['#F9DC3E','bbl'],
    'webpack.config.js':    ['#8DD6F9','wpk'],
    'vite.config.js':       ['#646CFF','vite'],
    'vite.config.ts':       ['#646CFF','vite'],
    'tsconfig.json':        ['#3178C6','tsc'],
    'jest.config.js':       ['#C21325','jest'],
    'jest.config.ts':       ['#C21325','jest'],
    '.env':                 ['#ECD53F','env'],
    'license':              ['#888888','lic'],
    'licence':              ['#888888','lic'],
  };

  function _getFileIcon(name, type, expanded) {
    if (type === 'dir') return expanded ? ICON_FOLDER_OPEN : ICON_FOLDER_CLOSED;
    var lname = name.toLowerCase();
    var fm = FNAME_MAP[lname];
    if (fm) return _fileIconSvg(fm[0], fm[1]);
    if (lname.startsWith('dockerfile')) return _fileIconSvg('#2496ED', 'dkr');
    if (lname.startsWith('.env')) return _fileIconSvg('#ECD53F', 'env');
    var dot = name.lastIndexOf('.');
    if (dot > 0) {
      var ext = name.slice(dot + 1).toLowerCase();
      var em = EXT_MAP[ext];
      if (em) return _fileIconSvg(em[0], em[1]);
    }
    return _fileIconSvg('#5a6270', '');
  }

  // ─── Action button SVGs ──────────────────────────────────────────────────

  var SVG_NEW_FILE = (
    '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M2 1.5h5.5l2.5 2.5v8H2z"/>' +
      '<path d="M7.5 1.5v2.5H10"/>' +
      '<path d="M4.5 7h3M6 5.5v3"/>' +
    '</svg>'
  );

  var SVG_NEW_FOLDER = (
    '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M1 4H3.5L4.5 5H10.5V9.5H1z"/>' +
      '<path d="M5.25 7.25H7.25M6.25 6.25v2"/>' +
    '</svg>'
  );

  var SVG_TERMINAL = (
    '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="1" y="1.5" width="10" height="9" rx="1.5"/>' +
      '<path d="M3 5l2.5 2L3 9"/>' +
      '<path d="M7 9h2"/>' +
    '</svg>'
  );

  var SVG_RENAME = (
    '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M7.5 2l2.5 2.5-5.5 5.5H2V7.5L7.5 2z"/>' +
    '</svg>'
  );

  var SVG_DELETE = (
    '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M2 3h8"/><path d="M4 3V2h4v1"/>' +
      '<path d="M3 3l.5 7h5l.5-7"/>' +
    '</svg>'
  );

  var SVG_MORE = (
    '<svg viewBox="0 0 12 12">' +
      '<circle cx="2.5" cy="6" r="1.1" fill="currentColor"/>' +
      '<circle cx="6" cy="6" r="1.1" fill="currentColor"/>' +
      '<circle cx="9.5" cy="6" r="1.1" fill="currentColor"/>' +
    '</svg>'
  );

  // ─── Context menu icons ──────────────────────────────────────────────────

  var CTX_ICON = {
    'Open Terminal Here': (
      '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="1" y="1.5" width="10" height="9" rx="1.5"/>' +
        '<path d="M3 5l2.5 2L3 9"/><path d="M7 9h2"/>' +
      '</svg>'
    ),
    'New File': (
      '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M2 1.5h5.5l2.5 2.5v8H2z"/>' +
        '<path d="M7.5 1.5v2.5H10"/>' +
        '<path d="M4.5 7h3M6 5.5v3"/>' +
      '</svg>'
    ),
    'New Folder': (
      '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M1 4H3.5L4.5 5H10.5V9.5H1z"/>' +
        '<path d="M5.25 7.25H7.25M6.25 6.25v2"/>' +
      '</svg>'
    ),
    'Rename': (
      '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M7.5 2l2.5 2.5-5.5 5.5H2V7.5L7.5 2z"/>' +
      '</svg>'
    ),
    'Delete': (
      '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M2 3h8"/><path d="M4 3V2h4v1"/>' +
        '<path d="M3 3l.5 7h5l.5-7"/>' +
      '</svg>'
    ),
    'Cut': (
      '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round">' +
        '<circle cx="3" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/>' +
        '<path d="M8.5 2.5L6 6M3.5 2.5L6 6"/>' +
        '<path d="M6 6L4.5 7.5M6 6L7.5 7.5"/>' +
      '</svg>'
    ),
    'Copy': (
      '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="4" y="4" width="7" height="7" rx="1"/>' +
        '<path d="M4 4V3a1 1 0 00-1-1H2a1 1 0 00-1 1v6a1 1 0 001 1h1"/>' +
      '</svg>'
    ),
    'Paste': (
      '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4.5 2h3v1h-3V2z"/>' +
        '<path d="M3 2.5H2a1 1 0 00-1 1v7a1 1 0 001 1h8a1 1 0 001-1v-7a1 1 0 00-1-1H9"/>' +
        '<path d="M5 7.5h2M6 6.5v2"/>' +
      '</svg>'
    ),
  };

  // ─── FileTree component ───────────────────────────────────────────────────

  /**
   * FileTree - lazy-loading file tree component.
   * @param {HTMLElement} container - element to render into
   * @param {Object} opts
   * @param {Function} opts.onFileClick - callback(path, name) when a file is clicked
   * @param {Function} opts.onOpenTerminal - callback(path) when "Open Terminal Here" is chosen
   */
  function FileTree(container, opts) {
    this._container = container;
    this._onFileClick = (opts && opts.onFileClick) || function () {};
    this._onOpenTerminal = (opts && opts.onOpenTerminal) || null;
    this._apiBase = (opts && opts.apiBase) || '/api/files';
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

    return fetch(this._apiBase + '?path=' + encodeURIComponent(dirPath))
      .then(function (res) { return res.json(); })
      .then(function (entries) {
        self._cache[dirPath] = entries;
        self._renderEntries(entries, parentEl, depth);
        // Mark the parent dir item as empty after load
        if (dirPath !== '.' && entries.length === 0) {
          var dirItem = self._container.querySelector('.ft-item.ft-dir[data-path="' + dirPath + '"]');
          if (dirItem) dirItem.classList.add('ft-empty-dir');
        }
      })
      .catch(function () {
        var err = document.createElement('div');
        err.className = 'ft-error';
        err.textContent = 'Failed to load';
        err.style.paddingLeft = (12 + depth * 16) + 'px';
        parentEl.appendChild(err);
      });
  };

  FileTree.prototype._makeActionBtn = function (svg, title, handler, extraClass) {
    var btn = document.createElement('span');
    btn.className = 'ft-action-btn' + (extraClass ? ' ' + extraClass : '');
    btn.title = title;
    btn.innerHTML = svg;
    btn.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      handler(e);
    });
    return btn;
  };

  FileTree.prototype._renderEntries = function (entries, parentEl, depth) {
    var self = this;

    entries.forEach(function (entry) {
      var item = document.createElement('div');
      item.className = 'ft-item';
      item.style.paddingLeft = (10 + depth * 16) + 'px';
      item.dataset.path = entry.path;
      item.dataset.type = entry.type;

      var icon = document.createElement('span');
      icon.className = 'ft-icon';
      icon.innerHTML = _getFileIcon(entry.name, entry.type, false);

      var label = document.createElement('span');
      label.className = 'ft-label';
      label.textContent = entry.name;

      var actions = document.createElement('span');
      actions.className = 'ft-actions';

      item.addEventListener('contextmenu', function (e) {
        self._showContextMenu(e, item);
      });

      if (entry.type === 'dir') {
        item.classList.add('ft-dir');

        var chevron = document.createElement('span');
        chevron.className = 'ft-chevron';
        chevron.innerHTML = '<svg viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 1l4 3-4 3"/></svg>';

        item.appendChild(chevron);
        item.appendChild(icon);
        item.appendChild(label);

        actions.appendChild(self._makeActionBtn(SVG_NEW_FILE, 'New File', function () {
          if (childContainer.style.display === 'none') { item.click(); }
          self._doCreate(entry.path, 'file');
        }));
        actions.appendChild(self._makeActionBtn(SVG_NEW_FOLDER, 'New Folder', function () {
          if (childContainer.style.display === 'none') { item.click(); }
          self._doCreate(entry.path, 'dir');
        }));
        actions.appendChild(self._makeActionBtn(SVG_TERMINAL, 'Open Terminal Here', function () {
          if (self._onOpenTerminal) self._onOpenTerminal(entry.path);
        }, 'ft-action-terminal'));
        actions.appendChild(self._makeActionBtn(SVG_MORE, 'More actions', function (e) {
          self._showContextMenu(e, item);
        }));

        item.appendChild(actions);
        parentEl.appendChild(item);

        var childContainer = document.createElement('div');
        childContainer.className = 'ft-children';
        childContainer.style.display = 'none';
        childContainer.dataset.dirPath = entry.path;
        childContainer.dataset.depth = depth + 1;
        parentEl.appendChild(childContainer);

        (function (entryPath, entryName, ic, cc) {
          var loaded = false;
          item.addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = cc.style.display !== 'none';
            if (isOpen) {
              cc.style.display = 'none';
              ic.innerHTML = _getFileIcon(entryName, 'dir', false);
              item.classList.remove('ft-open');
            } else {
              cc.style.display = '';
              ic.innerHTML = _getFileIcon(entryName, 'dir', true);
              item.classList.add('ft-open');
              if (!loaded) {
                loaded = true;
                self._loadDir(entryPath, cc, depth + 1);
              }
            }
          });
        })(entry.path, entry.name, icon, childContainer);

      } else {
        item.classList.add('ft-file');
        item.appendChild(icon);
        item.appendChild(label);

        actions.appendChild(self._makeActionBtn(SVG_RENAME, 'Rename', function () {
          self._startRename(entry.path, 'file');
        }));
        actions.appendChild(self._makeActionBtn(SVG_DELETE, 'Delete', function () {
          self._doDelete(entry.path);
        }, 'ft-action-danger'));
        actions.appendChild(self._makeActionBtn(SVG_MORE, 'More actions', function (e) {
          self._showContextMenu(e, item);
        }));

        item.appendChild(actions);
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
      menuItems = ['Open Terminal Here', null, 'New File', 'New Folder', null, 'Rename', 'Delete', null, 'Cut', 'Copy'];
      if (this._clipboard) {
        menuItems = menuItems.concat(['Paste']);
      }
    } else {
      menuItems = ['Rename', 'Delete', null, 'Cut', 'Copy'];
    }

    var menu = document.createElement('div');
    menu.className = 'ep-context-menu';

    this._buildMenuItems(menu, menuItems, path, type);

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
        if (item === 'Delete') el.classList.add('ep-ctx-item--danger');
        if (item === 'Open Terminal Here') el.classList.add('ep-ctx-item--terminal');
        var iconHtml = CTX_ICON[item]
          ? '<span class="ep-ctx-item-icon">' + CTX_ICON[item] + '</span>'
          : '<span class="ep-ctx-item-icon"></span>';
        el.innerHTML = iconHtml + '<span class="ep-ctx-item-label">' + item + '</span>';
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
    if (action === 'Open Terminal Here') { if (self._onOpenTerminal) self._onOpenTerminal(filePath); }
    else if (action === 'New File') { self._doCreate(filePath, 'file'); }
    else if (action === 'New Folder') { self._doCreate(filePath, 'dir'); }
    else if (action === 'Delete') { self._doDelete(filePath); }
    else if (action === 'Rename') { self._startRename(filePath, fileType); }
    else if (action === 'Cut') { self._doCut(filePath, fileType); }
    else if (action === 'Copy') { self._doCopy(filePath, fileType); }
    else if (action === 'Paste') { self._doPaste(filePath); }
  };

  FileTree.prototype._startRename = function (filePath, fileType) {
    var self = this;

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
    if (this._clipboard && this._clipboard.op === 'cut') {
      var prev = this._container.querySelector('[data-path="' + this._clipboard.path + '"]');
      if (prev) prev.classList.remove('ft-cut');
    }
    this._clipboard = { path: filePath, type: fileType, op: 'cut' };
    var item = this._container.querySelector('[data-path="' + filePath + '"]');
    if (item) item.classList.add('ft-cut');
  };

  FileTree.prototype._doCopy = function (filePath, fileType) {
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
      if (clip.op === 'cut') {
        var srcItem = self._container.querySelector('[data-path="' + clip.path + '"]');
        if (srcItem) srcItem.classList.remove('ft-cut');
      }
      self._clipboard = null;
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

    var dirItem = this._container.querySelector('.ft-item.ft-dir[data-path="' + dirPath + '"]');
    if (!dirItem) { return; }

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
    input.className = 'ft-rename-input ft-create-input';
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
  ns.getFileIcon = _getFileIcon;
})();
