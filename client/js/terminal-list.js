(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  function TerminalList(container) {
    this._container = container;
    this._items = new Map(); // terminalId -> DOM element

    // Callbacks (set by App)
    this.onMinimize = null;
    this.onClose = null;
    this.onSelect = null;
  }

  TerminalList.prototype.upsert = function (id, name, location, active) {
    var existing = this._items.get(id);
    if (existing) {
      existing.querySelector('.tl-name').textContent = name;
      this._setLocation(existing, location);
      this._setActivity(existing, active);
      return;
    }

    var item = document.createElement('div');
    item.className = 'tl-item';
    item.dataset.terminalId = id;

    var dot = document.createElement('span');
    dot.className = 'tl-status ' + (active ? 'tl-status-active' : 'tl-status-idle');
    item.appendChild(dot);

    var nameEl = document.createElement('span');
    nameEl.className = 'tl-name';
    nameEl.textContent = name;
    item.appendChild(nameEl);

    var locEl = document.createElement('span');
    locEl.className = 'tl-location';
    locEl.textContent = location;
    item.appendChild(locEl);

    var actions = document.createElement('span');
    actions.className = 'tl-actions';

    var self = this;

    var minBtn = document.createElement('button');
    minBtn.className = 'tl-btn tl-btn-minimize';
    minBtn.innerHTML = '&ndash;';
    minBtn.title = 'Minimize';
    minBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (self.onMinimize) self.onMinimize(id);
    });
    actions.appendChild(minBtn);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'tl-btn tl-btn-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (self.onClose) self.onClose(id);
    });
    actions.appendChild(closeBtn);

    item.appendChild(actions);

    item.addEventListener('click', function () {
      if (self.onSelect) self.onSelect(id);
    });

    this._container.appendChild(item);
    this._items.set(id, item);
  };

  TerminalList.prototype.remove = function (id) {
    var el = this._items.get(id);
    if (el) {
      el.remove();
      this._items.delete(id);
    }
  };

  TerminalList.prototype.updateLocation = function (id, location) {
    var el = this._items.get(id);
    if (el) this._setLocation(el, location);
  };

  TerminalList.prototype.updateActivity = function (id, active) {
    var el = this._items.get(id);
    if (el) this._setActivity(el, active);
  };

  TerminalList.prototype.highlight = function (id) {
    var el = this._items.get(id);
    if (el) el.classList.add('tl-item-highlight');
  };

  TerminalList.prototype.clearHighlight = function () {
    this._items.forEach(function (el) {
      el.classList.remove('tl-item-highlight');
    });
  };

  TerminalList.prototype._setLocation = function (el, location) {
    var loc = el.querySelector('.tl-location');
    if (loc) loc.textContent = location;
    // Hide minimize button when already minimized
    var minBtn = el.querySelector('.tl-btn-minimize');
    if (minBtn) minBtn.style.display = (location === 'Minimized') ? 'none' : '';
  };

  TerminalList.prototype._setActivity = function (el, active) {
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
