(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  var RECONNECT_BASE = 1000;
  var RECONNECT_CAP = 30000;

  // Strip ANSI escape sequences
  function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  }

  function TerminalConnection(id, config) {
    this.id = id;
    this.config = config || {};
    this._terminal = null;
    this._fitAddon = null;
    this._ws = null;
    this._element = null;
    this._lastOutput = '';
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._destroyed = false;
    this._detaching = false;

    // Callback hooks (set by App)
    this._onActivity = null;
    this._onStatusChange = null;
  }

  TerminalConnection.prototype.attach = function (el) {
    this._element = el;
    this._detaching = false;

    // Create fresh xterm instance
    var theme = this.config.theme || {};
    this._terminal = new window.Terminal({
      fontFamily: theme.fontFamily || 'Fira Code, monospace',
      fontSize: theme.fontSize || 14,
      theme: {
        foreground: theme.defaultColor || '#33ff33',
        background: theme.background || '#0a0a0a'
      },
      cursorBlink: true,
      scrollback: 5000
    });

    // Load FitAddon
    this._fitAddon = new window.FitAddon.FitAddon();
    this._terminal.loadAddon(this._fitAddon);

    // Open terminal in element
    this._terminal.open(el);

    // Defer fit() so the browser can calculate layout dimensions first.
    // Calling fit() synchronously after open() reads stale/zero sizes when
    // the container's geometry is still settling (e.g. header just shown,
    // strip appearing/disappearing via CSS :empty).
    var self = this;
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(function () {
        if (self._fitAddon) self._fitAddon.fit();
      });
    } else {
      this._fitAddon.fit();
    }

    // Connect WebSocket
    this._connectWS();

    // Wire terminal input to WS
    var self = this;
    this._terminal.onData(function (data) {
      if (self._ws && self._ws.readyState === WebSocket.OPEN) {
        self._ws.send(JSON.stringify({ type: 'input', data: data }));
      }
    });
  };

  TerminalConnection.prototype._connectWS = function () {
    var self = this;
    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var host = window.location.host || 'localhost:3000';
    var url = protocol + '//' + host + '/ws/terminal/' + this.id;

    this._ws = new WebSocket(url);

    this._ws.addEventListener('open', function () {
      self._reconnectAttempts = 0;
      self._sendResize();
      if (self._onStatusChange) self._onStatusChange(self.id, 'connected');
    });

    this._ws.addEventListener('message', function (event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      switch (msg.type) {
        case 'output':
          if (self._terminal) {
            self._terminal.write(msg.data);
          }
          // Track activity
          var stripped = stripAnsi(msg.data);
          self._lastOutput = (self._lastOutput + stripped).slice(-80);
          if (self._onActivity) self._onActivity(self.id);
          break;
      }
    });

    this._ws.addEventListener('close', function () {
      if (self._onStatusChange) self._onStatusChange(self.id, 'disconnected');
      if (!self._destroyed && !self._detaching) {
        self._scheduleReconnect();
      }
    });
  };

  TerminalConnection.prototype._sendResize = function () {
    if (this._ws && this._ws.readyState === WebSocket.OPEN && this._fitAddon) {
      var dims = this._fitAddon.proposeDimensions();
      if (dims) {
        this._ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
      }
    }
  };

  TerminalConnection.prototype._scheduleReconnect = function () {
    if (this._destroyed) return;

    var self = this;
    var delay = Math.min(
      RECONNECT_BASE * Math.pow(2, this._reconnectAttempts),
      RECONNECT_CAP
    );
    // Add jitter ±20%
    var jitter = delay * 0.2 * (Math.random() * 2 - 1);
    delay = Math.max(100, delay + jitter);
    this._reconnectAttempts++;

    this._reconnectTimer = setTimeout(function () {
      if (!self._destroyed && !self._detaching) {
        self._connectWS();
      }
    }, delay);
  };

  TerminalConnection.prototype.detach = function () {
    this._detaching = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._terminal) {
      this._terminal.dispose();
      this._terminal = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._fitAddon = null;
    this._element = null;
  };

  TerminalConnection.prototype.refit = function () {
    if (this._fitAddon) {
      this._fitAddon.fit();
      this._sendResize();
    }
  };

  TerminalConnection.prototype.isActive = function () {
    return this._ws !== null && this._ws.readyState === WebSocket.OPEN;
  };

  TerminalConnection.prototype.getLastOutput = function () {
    return this._lastOutput;
  };

  TerminalConnection.prototype.destroy = function () {
    this._destroyed = true;
    this.detach();
  };

  ns.TerminalConnection = TerminalConnection;
})();
