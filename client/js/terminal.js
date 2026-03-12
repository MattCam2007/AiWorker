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
    this._contextMenu = null;
    // Callback hooks (set by App)
    this._toastTimer = null;
    this._onStatusChange = null;
  }

  TerminalConnection.prototype.attach = function (el) {
    this._element = el;
    this._detaching = false;

    // Right-click context menu
    var self = this;
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      self._showContextMenu(e.clientX, e.clientY);
    });

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

    // Touch-friendly scroll rail overlay (auto-expanding, haptic feedback)
    this._initScrollRail(el);

    // When keyboard is hidden, prevent ANY focus on the xterm textarea.
    // This catches xterm.js's own internal click→focus path.
    var textarea = this._terminal.textarea;
    if (textarea) {
      textarea.addEventListener('focus', function () {
        if (TerminalConnection.keyboardHidden) {
          textarea.blur();
        }
      });
    }

    // Prevent mobile input duplication: on Android, xterm.js's hidden
    // textarea grows with every word. When autocorrect modifies already-
    // sent text, xterm.js's _handleAnyTextareaChanges can re-send the
    // entire accumulated content. Clear the textarea after each composition
    // completes so the blast radius is at most one word.
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
    if (this._scrollObserver) {
      this._scrollObserver.disconnect();
      this._scrollObserver = null;
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
    if (this._scrollRail) {
      newMount.appendChild(this._scrollRail);
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

  // Static flag: when true, suppress all terminal focus (hides virtual keyboard).
  // Controlled by App keyboard toggle.
  TerminalConnection.keyboardHidden = false;

  TerminalConnection.prototype.focus = function () {
    if (TerminalConnection.keyboardHidden) return;
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

  // ---------------------------------------------------------------
  // Touch scroll rail: 4px indicator that expands to ~20px on grab.
  // Provides drag-to-scroll on the xterm viewport scrollback buffer
  // with haptic feedback at buffer boundaries.
  // ---------------------------------------------------------------

  TerminalConnection.prototype._initScrollRail = function (el) {
    var self = this;

    // Build DOM:  rail (touch target) > track (visible strip) > thumb
    var rail = document.createElement('div');
    rail.className = 'td-scroll-rail';

    var track = document.createElement('div');
    track.className = 'td-scroll-track';

    var thumb = document.createElement('div');
    thumb.className = 'td-scroll-thumb';

    var posLabel = document.createElement('div');
    posLabel.className = 'td-scroll-pos';

    track.appendChild(thumb);
    rail.appendChild(track);
    rail.appendChild(posLabel);
    el.appendChild(rail);

    this._scrollRail = rail;

    // Wait for xterm.js to render its viewport element
    var viewport = el.querySelector('.xterm-viewport');
    if (!viewport) {
      setTimeout(function () {
        var vp = el.querySelector('.xterm-viewport');
        if (vp) self._wireScrollRail(rail, track, thumb, posLabel, vp);
      }, 300);
    } else {
      this._wireScrollRail(rail, track, thumb, posLabel, viewport);
    }
  };

  TerminalConnection.prototype._wireScrollRail = function (rail, track, thumb, posLabel, viewport) {
    var self = this;
    var dragging = false;
    var collapseTimer = null;
    var wasAtTop = false;
    var wasAtBottom = true;

    // --- Thumb position updater ---
    function updateThumb() {
      var sh = viewport.scrollHeight;
      var ch = viewport.clientHeight;
      var max = sh - ch;

      if (max <= 0) {
        rail.classList.add('td-scroll-hidden');
        return;
      }
      rail.classList.remove('td-scroll-hidden');

      var trackH = track.clientHeight;
      if (trackH <= 0) return;

      var thumbH = Math.max(24, (ch / sh) * trackH);
      var ratio = viewport.scrollTop / max;
      var thumbTop = ratio * (trackH - thumbH);

      thumb.style.height = thumbH + 'px';
      thumb.style.transform = 'translateY(' + thumbTop + 'px)';
    }

    viewport.addEventListener('scroll', updateThumb, { passive: true });

    // Watch for content changes (new terminal output)
    this._scrollObserver = new MutationObserver(function () {
      requestAnimationFrame(updateThumb);
    });
    this._scrollObserver.observe(viewport, { childList: true, subtree: true });

    // Initial update (wait for layout)
    setTimeout(updateThumb, 400);

    // Also update on refit
    var origRefit = this.refit.bind(this);
    this.refit = function () {
      origRefit();
      setTimeout(updateThumb, 50);
    };

    // --- Expand / collapse ---
    function expand() {
      clearTimeout(collapseTimer);
      rail.classList.add('td-scroll-expanded');
    }

    function scheduleCollapse() {
      clearTimeout(collapseTimer);
      collapseTimer = setTimeout(function () {
        if (!dragging) {
          rail.classList.remove('td-scroll-expanded');
          posLabel.classList.remove('td-scroll-pos-visible');
        }
      }, 1200);
    }

    // --- Scroll to touch position ---
    function scrollToY(touchY) {
      var rect = track.getBoundingClientRect();
      var ratio = (touchY - rect.top) / rect.height;
      ratio = Math.max(0, Math.min(1, ratio));
      var max = viewport.scrollHeight - viewport.clientHeight;
      var target = ratio * max;

      // Haptic at boundaries
      var atTop = ratio <= 0.001;
      var atBottom = ratio >= 0.999;

      if (atTop && !wasAtTop) {
        if (navigator.vibrate) navigator.vibrate(15);
        wasAtTop = true;
      } else if (!atTop) {
        wasAtTop = false;
      }

      if (atBottom && !wasAtBottom) {
        if (navigator.vibrate) navigator.vibrate(15);
        wasAtBottom = true;
      } else if (!atBottom) {
        wasAtBottom = false;
      }

      viewport.scrollTop = target;

      // Update position label
      if (self._terminal) {
        var buf = self._terminal.buffer.active;
        var currentLine = buf.viewportY + 1;
        var totalLines = buf.length;
        posLabel.textContent = currentLine + ' / ' + totalLines;
        posLabel.classList.add('td-scroll-pos-visible');

        // Position label near thumb
        var thumbRect = thumb.getBoundingClientRect();
        var railRect = rail.getBoundingClientRect();
        var labelTop = thumbRect.top - railRect.top + (thumbRect.height / 2) - 10;
        labelTop = Math.max(0, Math.min(railRect.height - 20, labelTop));
        posLabel.style.top = labelTop + 'px';
      }
    }

    // --- Touch handlers ---
    rail.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      expand();
      scrollToY(e.touches[0].clientY);
      if (navigator.vibrate) navigator.vibrate(8);
    }, { passive: false });

    rail.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      e.preventDefault();
      scrollToY(e.touches[0].clientY);
    }, { passive: false });

    rail.addEventListener('touchend', function () {
      if (!dragging) return;
      dragging = false;
      scheduleCollapse();
    });

    // Mouse support (for desktop testing and usability)
    rail.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      expand();
      scrollToY(e.clientY);

      function onMove(ev) { scrollToY(ev.clientY); }
      function onUp() {
        dragging = false;
        scheduleCollapse();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  };

  // ---------------------------------------------------------------
  // Right-click context menu
  // ---------------------------------------------------------------

  TerminalConnection.prototype._showContextMenu = function (x, y) {
    this._dismissContextMenu();
    var self = this;

    var menu = document.createElement('div');
    menu.className = 'ep-context-menu';

    var hasSel = !!(this._terminal && this._terminal.getSelection());
    var isOpen = !!(this._ws && this._ws.readyState === WebSocket.OPEN);

    var items = [
      { label: 'Copy', disabled: !hasSel, action: function () {
        var sel = self._terminal && self._terminal.getSelection();
        if (!sel) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(sel).catch(function () {});
        } else {
          var ta = document.createElement('textarea');
          ta.value = sel;
          ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:0;left:0';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); } catch (e) {}
          document.body.removeChild(ta);
        }
      }},
      { label: 'Paste', disabled: !isOpen, action: function () {
        if (!self._ws || self._ws.readyState !== WebSocket.OPEN) return;
        if (navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard.readText().then(function (text) {
            if (text) {
              self._ws.send(JSON.stringify({ type: 'input', data: text }));
              if (self._terminal) self._terminal.focus();
            }
          }).catch(function () {});
        }
      }},
      { label: 'Select All', action: function () {
        if (self._terminal) {
          self._terminal.selectAll();
          self._terminal.focus();
        }
      }},
      null,
      { label: 'Clear screen', shortcut: 'Ctrl+L', disabled: !isOpen, action: function () {
        if (self._ws && self._ws.readyState === WebSocket.OPEN) {
          self._ws.send(JSON.stringify({ type: 'input', data: '\x0c' }));
        }
        if (self._terminal) self._terminal.focus();
      }},
      { label: 'Scroll to bottom', action: function () {
        if (self._terminal) {
          self._terminal.scrollToBottom();
          // xterm.js defers the viewport scrollTop update to rAF, so also
          // force the DOM viewport to the absolute bottom as a fallback.
          var vp = self._element && self._element.querySelector('.xterm-viewport');
          if (vp) {
            requestAnimationFrame(function () {
              vp.scrollTop = vp.scrollHeight;
            });
          }
          // When mouse tracking is stripped (e.g. tmux), wheel events are
          // forwarded to the PTY so tmux handles scrollback.  xterm.js's
          // own viewport has no scrollback in alternate-buffer mode, so
          // scrollToBottom() is a no-op.  Send 'q' to exit tmux copy mode
          // and return to the live output.
          if (self._mouseTrackingStripped &&
              self._terminal.buffer.active.type === 'alternate' &&
              self._ws && self._ws.readyState === WebSocket.OPEN) {
            self._ws.send(JSON.stringify({ type: 'input', data: 'q' }));
          }
          self._terminal.focus();
        }
      }},
      null,
      { label: 'Refresh display', action: function () {
        self.refresh();
        if (self._terminal) self._terminal.focus();
      }},
      null,
      { label: 'Rename\u2026', action: function () {
        var cell = self._element && self._element.closest && self._element.closest('.grid-cell');
        if (cell) {
          var editBtn = cell.querySelector('.cell-header-edit');
          if (editBtn) editBtn.click();
        }
      }},
      { label: 'Close terminal', action: function () {
        var cell = self._element && self._element.closest && self._element.closest('.grid-cell');
        if (cell) {
          var closeBtn = cell.querySelector('.cell-header-close');
          if (closeBtn) closeBtn.click();
        }
      }},
    ];

    this._buildMenuItems(menu, items);

    document.body.appendChild(menu);
    this._contextMenu = menu;

    // Position: keep within viewport
    var rect = menu.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    if (x + rect.width > vw) x = vw - rect.width - 4;
    if (y + rect.height > vh) y = vh - rect.height - 4;
    if (x < 0) x = 4;
    if (y < 0) y = 4;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    // Dismiss on click outside or Escape
    var dismiss = function (e) {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (e.type === 'mousedown' && menu.contains(e.target)) return;
      self._dismissContextMenu();
      document.removeEventListener('mousedown', dismiss, true);
      document.removeEventListener('keydown', dismiss, true);
    };
    setTimeout(function () {
      document.addEventListener('mousedown', dismiss, true);
      document.addEventListener('keydown', dismiss, true);
    }, 0);
  };

  TerminalConnection.prototype._buildMenuItems = function (container, items) {
    var self = this;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item === null) {
        var divider = document.createElement('div');
        divider.className = 'ep-ctx-divider';
        container.appendChild(divider);
        continue;
      }
      var el = document.createElement('div');
      el.className = item.disabled ? 'ep-ctx-item ep-ctx-item-disabled' : 'ep-ctx-item';
      var labelHtml = '<span class="ep-ctx-item-label">' + item.label + '</span>';
      var shortcutHtml = item.shortcut
        ? '<span class="ep-ctx-item-shortcut">' + item.shortcut + '</span>'
        : '';
      el.innerHTML = labelHtml + shortcutHtml;
      if (!item.disabled) {
        (function (action) {
          el.addEventListener('click', function (e) {
            e.stopPropagation();
            self._dismissContextMenu();
            action();
          });
        })(item.action);
      }
      container.appendChild(el);
    }
  };

  TerminalConnection.prototype._dismissContextMenu = function () {
    if (this._contextMenu && this._contextMenu.parentNode) {
      this._contextMenu.parentNode.removeChild(this._contextMenu);
    }
    this._contextMenu = null;
  };

  ns.TerminalConnection = TerminalConnection;
})();
