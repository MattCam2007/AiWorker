(function () {
  'use strict';

  var ns = (window.TerminalDeck = window.TerminalDeck || {});

  var RECONNECT_BASE = 1000;
  var RECONNECT_CAP = 30000;

  function TerminalConnection(id, config) {
    this.id = id;
    this.config = config || {};
    this._terminal = null;
    this._fitAddon = null;
    this._ws = null;
    this._element = null;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._destroyed = false;
    this._detaching = false;
    this._exited = false;
    this._mouseTrackingStripped = false;
    this._searchAddon = null;

    // Callback hooks (set by App)
    this._toastTimer = null;
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

    // Prevent mobile input duplication: on Android, xterm.js's hidden
    // textarea grows with every word. When autocorrect modifies already-
    // sent text, xterm.js's _handleAnyTextareaChanges can re-send the
    // entire accumulated content. Clear the textarea after each composition
    // completes so the blast radius is at most one word.
    var textarea = this._terminal.textarea;
    if (textarea) {
      var term = this._terminal;
      textarea.addEventListener('compositionend', function () {
        setTimeout(function () {
          var ch = term._compositionHelper
            || (term._core && term._core._compositionHelper);
          if (ch && !ch.isComposing && !ch._isSendingComposition) {
            textarea.value = '';
            ch._compositionPosition = { start: 0, end: 0 };
            ch._dataAlreadySent = '';
          }
        }, 100);
      });
    }

    // Defer fit() until the browser has completed a full rendering cycle.
    // A single requestAnimationFrame is NOT enough — rAF fires BEFORE the
    // browser paints, so the container geometry (flex/grid heights) may not
    // be finalized.  Double-rAF ensures one full style → layout → paint
    // cycle has completed before we measure.  A setTimeout safety-net covers
    // edge cases (slow font loading, complex layout recalculations).
    var self = this;
    function doFit() {
      if (self._fitAddon && self._terminal) {
        self._fitAddon.fit();
        self._sendResize();
      }
    }
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(function () {
        requestAnimationFrame(doFit);
      });
    } else {
      this._fitAddon.fit();
    }
    setTimeout(doFit, 100);

    // Connect WebSocket
    this._connectWS();

    // Copy-on-select: when xterm.js selection changes, copy to clipboard.
    // xterm.js selection only works when mouse tracking is OFF (we strip
    // the tracking escape sequences below so this always fires).
    this._terminal.onSelectionChange(function () {
      var sel = self._terminal && self._terminal.getSelection();
      if (!sel) return;

      function showToast() {
        var toast = document.getElementById('td-copy-toast');
        if (!toast) {
          toast = document.createElement('div');
          toast.id = 'td-copy-toast';
          toast.className = 'td-copy-toast';
          document.body.appendChild(toast);
        }
        toast.textContent = 'Copied!';
        toast.classList.add('td-copy-toast-show');
        clearTimeout(self._toastTimer);
        self._toastTimer = setTimeout(function () {
          toast.classList.remove('td-copy-toast-show');
        }, 1500);
      }

      function copyFallback() {
        var ta = document.createElement('textarea');
        ta.value = sel;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:0;left:0';
        document.body.appendChild(ta);
        ta.select();
        try { if (document.execCommand('copy')) showToast(); } catch (e) {}
        document.body.removeChild(ta);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sel).then(showToast).catch(copyFallback);
      } else {
        copyFallback();
      }
    });

    // Forward mouse wheel to PTY so tmux scroll works even though we strip
    // mouse-tracking escape sequences (which would disable xterm.js selection).
    // We encode scroll events in SGR format (\033[<btn;col;rowM).
    el.addEventListener('wheel', function (e) {
      if (!self._ws || self._ws.readyState !== WebSocket.OPEN) return;
      if (!self._terminal) return;

      // Only forward if we actually stripped mouse tracking (i.e. tmux wanted it)
      if (!self._mouseTrackingStripped) return;

      e.preventDefault();
      var btn = e.deltaY < 0 ? 64 : 65; // 64=scroll-up, 65=scroll-down
      var rect = el.getBoundingClientRect();
      var renderer = self._terminal._core._renderService;
      var cellW = renderer.dimensions.css.cell.width || 9;
      var cellH = renderer.dimensions.css.cell.height || 17;
      var col = Math.floor((e.clientX - rect.left) / cellW) + 1;
      var row = Math.floor((e.clientY - rect.top) / cellH) + 1;
      col = Math.max(1, Math.min(col, self._terminal.cols));
      row = Math.max(1, Math.min(row, self._terminal.rows));

      // Send 3 scroll lines per wheel tick (matches typical terminal behaviour)
      var lines = 3;
      for (var i = 0; i < lines; i++) {
        self._ws.send(JSON.stringify({
          type: 'input',
          data: '\x1b[<' + btn + ';' + col + ';' + row + 'M'
        }));
      }
    }, { passive: false });

    // Wire terminal input to WS
    this._terminal.onData(function (data) {
      if (self._ws && self._ws.readyState === WebSocket.OPEN) {
        // Filter out Device Attributes responses that xterm.js auto-generates
        // in reply to DA queries from tmux (\x1b[c / \x1b[>c).  On mobile,
        // backgrounding and resuming the browser causes a reconnect; tmux
        // re-queries DA and the response (e.g. \x1b[>0;276;0c) arrives when
        // tmux isn't expecting it, so it leaks as visible text in the shell.
        if (/^\x1b\[[\?>][\d;]*c$/.test(data)) return;

        // Mobile toolbar Ctrl modifier: when active, transform the first
        // character of the next input into its Ctrl code (e.g. 'a' → \x01).
        // We intercept here in onData — the single point where all input
        // (keyboard, IME composition, paste) has been resolved to final
        // characters — so there is no risk of double-sending.
        var app = ns.app;
        if (app && app._ctrlActive) {
          var first = data.charAt(0).toUpperCase();
          var ctrlCode = first.charCodeAt(0) - 64;
          if (ctrlCode >= 1 && ctrlCode <= 26) {
            self._ws.send(JSON.stringify({
              type: 'input',
              data: String.fromCharCode(ctrlCode)
            }));
            // Send remaining characters (if any) unmodified
            if (data.length > 1) {
              self._ws.send(JSON.stringify({
                type: 'input',
                data: data.substring(1)
              }));
            }
          } else {
            // Non-letter key (number, symbol, etc.) — send as-is
            self._ws.send(JSON.stringify({ type: 'input', data: data }));
          }
          app._deactivateCtrl();
          return;
        }

        // Mobile toolbar Alt modifier: prefix first character with ESC.
        if (app && app._altActive) {
          self._ws.send(JSON.stringify({
            type: 'input',
            data: '\x1b' + data.charAt(0)
          }));
          if (data.length > 1) {
            self._ws.send(JSON.stringify({
              type: 'input',
              data: data.substring(1)
            }));
          }
          app._deactivateAlt();
          return;
        }

        self._ws.send(JSON.stringify({ type: 'input', data: data }));
      }
    });
  };

  TerminalConnection.prototype._connectWS = function () {
    var self = this;

    if (this._ws) {
      this._ws.onopen = null; this._ws.onmessage = null; this._ws.onclose = null;
      if (this._ws.readyState < WebSocket.CLOSING) this._ws.close();
      this._ws = null;
    }

    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var host = window.location.host || 'localhost:3000';
    var token = (ns._serverToken || '');
    var url = protocol + '//' + host + '/ws/terminal/' + this.id + (token ? '?t=' + encodeURIComponent(token) : '');

    this._ws = new WebSocket(url);

    this._ws.onopen = function () {
      self._reconnectAttempts = 0;
      self._sendResize();
      if (self._onStatusChange) self._onStatusChange(self.id, 'connected');
    };

    this._ws.onmessage = function (event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      switch (msg.type) {
        case 'output':
          if (self._terminal) {
            // Strip mouse-tracking escape sequences so xterm.js never enters
            // mouse tracking mode.  This keeps the selection service enabled
            // (drag-to-select works).  Wheel events are forwarded manually
            // by our own handler so tmux scroll still works.
            var data = msg.data.replace(/\x1b\[\?100[0-6][hl]/g, function (m) {
              if (m.charAt(m.length - 1) === 'h') self._mouseTrackingStripped = true;
              return '';
            });
            self._terminal.write(data);
          }
          break;
        case 'exited':
          self._exited = true;
          if (self._terminal) {
            self._terminal.write('\r\n\x1b[1;33m[Process exited');
            if (msg.exitCode !== undefined && msg.exitCode !== null) {
              self._terminal.write(' with code ' + msg.exitCode);
            }
            if (msg.signal) {
              self._terminal.write(' (signal: ' + msg.signal + ')');
            }
            self._terminal.write(']\x1b[0m\r\n');
          }
          if (self._onStatusChange) self._onStatusChange(self.id, 'exited');
          break;
      }
    };

    this._ws.onclose = function (event) {
      if (self._onStatusChange) self._onStatusChange(self.id, 'disconnected');
      // Don't reconnect if the terminal process exited or was explicitly closed
      if (self._exited || event.code === 4001) return;
      if (!self._destroyed && !self._detaching) {
        self._scheduleReconnect();
      }
    };
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
    if (this._searchAddon) {
      this._searchAddon.dispose();
      this._searchAddon = null;
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

  /**
   * Move the live xterm DOM into a new mount element without destroying
   * the terminal instance or closing the WebSocket.
   */
  TerminalConnection.prototype.moveTo = function (newMount) {
    if (this._terminal && this._terminal.element) {
      newMount.appendChild(this._terminal.element);
    }
    this._element = newMount;
  };

  TerminalConnection.prototype.refit = function () {
    if (this._fitAddon) {
      this._fitAddon.fit();
      this._sendResize();
    }
  };

  /**
   * Force a full display refresh — fixes TUI corruption (common with
   * apps like Claude Code).  Repaints all xterm.js rows on the client,
   * then bounces the PTY size so tmux sends a fresh redraw.
   */
  TerminalConnection.prototype.refresh = function () {
    if (!this._terminal || !this._fitAddon) return;

    // 1. Force xterm.js to repaint every visible row
    this._terminal.refresh(0, this._terminal.rows - 1);

    // 2. Bounce the PTY size to trigger SIGWINCH → tmux redraw.
    //    Shrink by 1 col, then restore after the server's 100ms throttle.
    var dims = this._fitAddon.proposeDimensions();
    if (dims && this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({
        type: 'resize',
        cols: Math.max(1, dims.cols - 1),
        rows: dims.rows
      }));
      var self = this;
      setTimeout(function () {
        if (self._fitAddon) {
          self._fitAddon.fit();
          self._sendResize();
        }
      }, 150);
    }
  };

  TerminalConnection.prototype.focus = function () {
    if (this._terminal) {
      this._terminal.focus();
    }
  };

  TerminalConnection.prototype.isActive = function () {
    return this._ws !== null && this._ws.readyState === WebSocket.OPEN;
  };

  TerminalConnection.prototype.destroy = function () {
    this._destroyed = true;
    this.detach();
  };

  ns.TerminalConnection = TerminalConnection;
})();
