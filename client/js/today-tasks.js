(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  function TodayTasks(listEl, addInput, dateLabelEl, navLeftEl, navRightEl) {
    this._listEl = listEl;
    this._addInput = addInput;
    this._dateLabelEl = dateLabelEl;
    this._navLeftEl = navLeftEl;
    this._navRightEl = navRightEl;
    this._today = this._getToday();
    this._selectedDate = this._today;
    this._tasks = [];
    this._loading = false;
    this._pollInterval = null;
  }

  TodayTasks.prototype._getToday = function () {
    var d = new Date();
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  };

  TodayTasks.prototype._api = function (method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch('/api/listdeck/daily/' + this._selectedDate + path, opts)
      .then(function (res) {
        if (res.status === 204) return null;
        return res.json();
      });
  };

  TodayTasks.prototype._formatDate = function (dateStr) {
    if (dateStr === this._today) return 'Today';
    var parts = dateStr.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return days[d.getDay()] + ' ' + months[d.getMonth()] + ' ' + d.getDate();
  };

  TodayTasks.prototype._dateOffset = function (baseStr, offset) {
    var parts = baseStr.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + offset);
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  };

  TodayTasks.prototype._daysBetween = function (a, b) {
    var pa = a.split('-');
    var pb = b.split('-');
    var da = new Date(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
    var db = new Date(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
    return Math.round((db - da) / 86400000);
  };

  TodayTasks.prototype._navigate = function (offset) {
    var diff = this._daysBetween(this._today, this._selectedDate) + offset;
    if (diff < -3) diff = -3;
    if (diff > 3) diff = 3;
    this._selectedDate = this._dateOffset(this._today, diff);
    this._updateNav();
    this._load();
  };

  TodayTasks.prototype._updateNav = function () {
    var diff = this._daysBetween(this._today, this._selectedDate);
    if (this._dateLabelEl) {
      this._dateLabelEl.textContent = this._formatDate(this._selectedDate);
    }
    if (this._navLeftEl) {
      this._navLeftEl.disabled = (diff <= -3);
    }
    if (this._navRightEl) {
      this._navRightEl.disabled = (diff >= 3);
    }
  };

  TodayTasks.prototype.init = function () {
    var self = this;

    // Show date in header and set initial nav state
    this._updateNav();

    // Wire nav buttons
    if (this._navLeftEl) {
      this._navLeftEl.addEventListener('click', function (e) {
        e.stopPropagation();
        self._navigate(-1);
      });
    }
    if (this._navRightEl) {
      this._navRightEl.addEventListener('click', function (e) {
        e.stopPropagation();
        self._navigate(1);
      });
    }

    // Wire add-task input
    if (this._addInput) {
      this._addInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var text = self._addInput.value.trim();
          if (text) self._addTask(text);
        }
      });
    }

    // Wire refresh button
    var refreshBtn = document.querySelector('[data-section="today"] .tt-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        refreshBtn.classList.add('tt-refresh-spin');
        self._load().then(function () {
          setTimeout(function () { refreshBtn.classList.remove('tt-refresh-spin'); }, 600);
        });
      });
    }

    this._load();
    this._startPolling();
  };

  TodayTasks.prototype._load = function () {
    var self = this;
    return this._api('GET', '').then(function (data) {
      if (data && Array.isArray(data.tasks)) {
        var incoming = JSON.stringify(data.tasks);
        if (incoming !== JSON.stringify(self._tasks)) {
          self._tasks = data.tasks;
          self._render();
        }
      }
    }).catch(function () {
      // Listdeck not available — show nothing
    });
  };

  TodayTasks.prototype.refresh = function () {
    return this._load();
  };

  TodayTasks.prototype._startPolling = function () {
    var self = this;
    this._stopPolling();
    this._pollInterval = setInterval(function () { self._load(); }, 30000);
  };

  TodayTasks.prototype._stopPolling = function () {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  };

  TodayTasks.prototype._addTask = function (text) {
    var self = this;
    this._api('POST', '/tasks', { text: text }).then(function (task) {
      if (task && task.id) {
        self._addInput.value = '';
        self._tasks.push(task);
        self._render();
      }
    }).catch(function () {});
  };

  TodayTasks.prototype._toggleTask = function (id, done) {
    var self = this;
    // Optimistic update
    var task = this._tasks.find(function (t) { return t.id === id; });
    if (task) task.done = done;
    this._render();

    this._api('PATCH', '/tasks/' + id, { done: done }).then(function (updated) {
      if (updated && updated.id) {
        var idx = self._tasks.findIndex(function (t) { return t.id === id; });
        if (idx !== -1) self._tasks[idx] = updated;
        self._render();
      }
    }).catch(function () {
      // Revert
      if (task) task.done = !done;
      self._render();
    });
  };

  TodayTasks.prototype._deleteTask = function (id) {
    var self = this;
    // Optimistic remove
    self._tasks = self._tasks.filter(function (t) { return t.id !== id; });
    self._render();

    this._api('DELETE', '/tasks/' + id).catch(function () {
      // Silently fail — the task is gone from the UI either way on delete
    });
  };

  TodayTasks.prototype._pushTask = function (id) {
    var self = this;
    // Optimistic remove — task is moving to next day
    self._tasks = self._tasks.filter(function (t) { return t.id !== id; });
    self._render();

    this._api('POST', '/tasks/' + id + '/push').catch(function () {
      // On failure, reload to restore true state
      self._load();
    });
  };

  TodayTasks.prototype._render = function () {
    var self = this;
    var frag = document.createDocumentFragment();

    var sorted = this._tasks.slice().sort(function (a, b) {
      return (a.done ? 1 : 0) - (b.done ? 1 : 0);
    });

    sorted.forEach(function (task) {
      var row = document.createElement('div');
      row.className = 'tt-item' + (task.done ? ' tt-item-done' : '');
      row.dataset.id = task.id;

      var cb = document.createElement('button');
      cb.className = 'tt-checkbox' + (task.done ? ' tt-checkbox-checked' : '');
      cb.title = task.done ? 'Mark undone' : 'Mark done';
      cb.addEventListener('click', function (e) {
        e.stopPropagation();
        self._toggleTask(task.id, !task.done);
      });

      var text = document.createElement('span');
      text.className = 'tt-text';
      text.textContent = task.text;

      var push = document.createElement('button');
      push.className = 'tt-push';
      push.title = 'Push to tomorrow';
      push.textContent = '\u2192'; // →
      push.addEventListener('click', function (e) {
        e.stopPropagation();
        self._pushTask(task.id);
      });

      var del = document.createElement('button');
      del.className = 'tt-delete';
      del.title = 'Delete task';
      del.textContent = '\u00d7'; // ×
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        self._deleteTask(task.id);
      });

      row.appendChild(cb);
      row.appendChild(text);
      row.appendChild(push);
      row.appendChild(del);
      frag.appendChild(row);
    });

    this._listEl.innerHTML = '';
    this._listEl.appendChild(frag);
  };

  ns.TodayTasks = TodayTasks;
}());
