(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  /**
   * CommandPalette - searchable command history drawer.
   * @param {HTMLElement} container - The palette container element
   */
  function CommandPalette(container) {
    this._container = container;
    this._searchInput = container.querySelector('.cp-search-input');
    this._listEl = container.querySelector('.cp-list');
    this._closeBtn = container.querySelector('.cp-close');
    this._backdrop = document.getElementById('cp-backdrop');
    this._history = [];
    this._fuse = null;
    this._isOpen = false;

    // Public callback: called when a command is selected
    this.onSelect = null;

    this._wireEvents();
  }

  // --- Public Methods ---

  CommandPalette.prototype.open = function () {
    this._isOpen = true;
    this._container.classList.remove('hidden');
    if (this._backdrop) this._backdrop.classList.remove('hidden');
    if (this._searchInput) {
      this._searchInput.value = '';
      this._searchInput.focus();
    }
    this.loadHistory();
  };

  CommandPalette.prototype.close = function () {
    this._isOpen = false;
    this._container.classList.add('hidden');
    if (this._backdrop) this._backdrop.classList.add('hidden');
  };

  CommandPalette.prototype.toggle = function () {
    if (this._isOpen) {
      this.close();
    } else {
      this.open();
    }
  };

  CommandPalette.prototype.loadHistory = function () {
    var self = this;
    return fetch('/api/history')
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to fetch history');
        return res.json();
      })
      .then(function (history) {
        self._history = history;
        self._initFuse();
        self._renderList(history);
      })
      .catch(function (err) {
        self._history = [];
        self._renderList([]);
      });
  };

  CommandPalette.prototype.search = function (query) {
    if (!query || !query.trim()) {
      this._renderList(this._history);
      return;
    }

    if (this._fuse) {
      var results = this._fuse.search(query);
      var commands = results.map(function (r) { return r.item; });
      this._renderList(commands);
    }
  };

  CommandPalette.prototype.selectItem = function (command) {
    if (this.onSelect) {
      this.onSelect(command);
    }
    this.close();
  };

  CommandPalette.prototype.updateHistory = function (history) {
    this._history = history;
    this._initFuse();
    var query = this._searchInput ? this._searchInput.value : '';
    if (query.trim()) {
      this.search(query);
    } else {
      this._renderList(history);
    }
  };

  // --- Private Methods ---

  CommandPalette.prototype._initFuse = function () {
    if (typeof window.Fuse === 'function') {
      this._fuse = new window.Fuse(this._history, {
        threshold: 0.4,
        distance: 100,
        includeScore: true
      });
    }
  };

  CommandPalette.prototype._renderList = function (items) {
    if (!this._listEl) return;
    this._listEl.innerHTML = '';

    var self = this;
    items.forEach(function (cmd) {
      var el = document.createElement('div');
      el.className = 'cp-item';
      el.textContent = cmd;
      el.addEventListener('click', function () {
        self.selectItem(cmd);
      });
      self._listEl.appendChild(el);
    });
  };

  CommandPalette.prototype._wireEvents = function () {
    var self = this;

    // Close button
    if (this._closeBtn) {
      this._closeBtn.addEventListener('click', function () {
        self.close();
      });
    }

    // Backdrop click
    if (this._backdrop) {
      this._backdrop.addEventListener('click', function () {
        self.close();
      });
    }

    // Search input
    if (this._searchInput) {
      this._searchInput.addEventListener('input', function () {
        self.search(this.value);
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      // Ctrl+K or Cmd+K toggles palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        self.toggle();
        return;
      }

      // Escape closes palette
      if (e.key === 'Escape' && self._isOpen) {
        e.preventDefault();
        self.close();
        return;
      }
    });
  };

  ns.CommandPalette = CommandPalette;
})();
