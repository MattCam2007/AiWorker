# Mobile Toolbar (Extended CLI Keyboard)

Implementation guide for the mobile toolbar — a row of special-key buttons that floats above the virtual keyboard on mobile devices, providing keys not available on standard mobile keyboards (Tab, Esc, arrows, Ctrl, etc.).

---

## Table of Contents

1. [What It Looked Like](#what-it-looked-like)
2. [Why It Was Removed](#why-it-was-removed)
3. [Architecture Overview](#architecture-overview)
4. [The Critical Bug & Its Fix](#the-critical-bug--its-fix)
5. [Implementation: HTML](#implementation-html)
6. [Implementation: CSS](#implementation-css)
7. [Implementation: JavaScript](#implementation-javascript)
8. [Integration Points](#integration-points)
9. [Testing Checklist](#testing-checklist)

---

## What It Looked Like

The toolbar was a single horizontal row fixed to the bottom of the viewport, sitting directly above the virtual keyboard on mobile. It contained compact buttons for keys that mobile keyboards lack:

```
┌──────────────────────────────────────────────────────┐
│  esc  tab  ↑  ↓  ←  →  |  -  ~  /  :  ctrl  pgup  │
│                                                       │
│  (sits just above the virtual keyboard)              │
└──────────────────────────────────────────────────────┘
```

Visual characteristics:
- **Background**: Semi-transparent dark (`rgba(17, 17, 17, 0.95)`) with a top border
- **Buttons**: Small, monospace-font labels with touch-friendly sizing (~40px min-width, 34px height)
- **Active state**: Buttons flash with cyan highlight on press (`var(--td-cyan)`)
- **Ctrl toggle**: Acts as a sticky modifier — tapping it highlights the button, and the next key tap sends the Ctrl+key combo (e.g., Ctrl+C). After the combo fires, Ctrl deactivates.
- **Scrollable**: The row was horizontally scrollable if buttons overflowed the screen width
- **Keyboard-aware positioning**: Used the `visualViewport` API to reposition itself above the virtual keyboard when it appeared, rather than being pushed off-screen or hidden behind it

When the virtual keyboard was **closed**, the toolbar sat at the very bottom of the screen. When the keyboard **opened**, the toolbar slid up to sit directly above the keyboard.

---

## Why It Was Removed

The initial implementation had a critical bug: **tapping a toolbar button stole focus from the xterm.js terminal textarea**, which caused a cascade of problems, especially with Tab completion. The code was removed for cleanup while the fix was being refined. This document explains how to rebuild it correctly.

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│  index.html                                 │
│  └─ <div id="mobile-toolbar">               │
│       └─ <button data-key="tab">tab</button>│
│       └─ <button data-key="up">↑</button>   │
│       └─ ...                                 │
├─────────────────────────────────────────────┤
│  app.js                                      │
│  └─ App._initMobileToolbar()                 │
│  └─ App._sendToActiveTerminal(data)          │
├─────────────────────────────────────────────┤
│  terminal.js                                 │
│  └─ TerminalConnection._ws.send({            │
│       type: 'input', data: '\t'              │
│     })                                       │
├─────────────────────────────────────────────┤
│  style.css                                   │
│  └─ #mobile-toolbar { ... }                  │
│  └─ .mobile-toolbar-btn { ... }              │
└─────────────────────────────────────────────┘
```

Data flow: Button tap → `handleKey()` → `_sendToActiveTerminal(data)` → finds active `TerminalConnection` → sends `{ type: 'input', data }` over WebSocket → server writes to PTY.

---

## The Critical Bug & Its Fix

### The Problem

On mobile, when you tap a toolbar button:

1. The browser moves focus from the xterm.js hidden `<textarea>` to the `<button>`
2. Focus loss causes the virtual keyboard to **dismiss**
3. Keyboard dismiss changes the viewport height
4. `ResizeObserver` on `#grid-container` fires → `refitAll()` → `sendResize()` → PTY resize
5. PTY resize sends `SIGWINCH` to bash
6. Then `focus()` is called to return focus to xterm.js → keyboard **reappears** → another resize → another `SIGWINCH`
7. Two `SIGWINCH` signals race with readline's tab-completion logic
8. Readline redraws the prompt mid-completion, causing typed text to vanish

**Result**: `cd Ai<Tab>` produces `cd ` (the typed text disappears).

### The Fix

**Prevent focus loss entirely.** The toolbar buttons must never take focus from the terminal.

The key technique: add a `mousedown` event listener on the toolbar (or each button) that calls `event.preventDefault()`. On both mobile and desktop, `mousedown preventDefault` stops the browser's default "move focus to the clicked element" behavior. The xterm.js textarea keeps focus, the virtual keyboard stays open, and no resize cascade occurs.

```javascript
// On the toolbar container or each button:
toolbar.addEventListener('mousedown', function (e) {
  e.preventDefault();  // Prevents focus theft — keyboard stays open
});
```

**Important**: Do NOT use `touchstart` with `preventDefault` for this purpose. While it also prevents focus loss, it has side effects — it can break scrolling on the toolbar if the buttons overflow, and it interacts poorly with some mobile browsers' touch handling. The `mousedown` approach works for both touch and mouse events because mobile browsers synthesize `mousedown` from touch events.

---

## Implementation: HTML

Add the toolbar markup to `client/index.html`, just before the closing `</body>` tag (after the script tags, or just before them):

```html
<!-- Mobile toolbar: sits above virtual keyboard -->
<div id="mobile-toolbar">
  <button class="mobile-toolbar-btn" data-key="esc">esc</button>
  <button class="mobile-toolbar-btn" data-key="tab">tab</button>
  <button class="mobile-toolbar-btn" data-key="up">↑</button>
  <button class="mobile-toolbar-btn" data-key="down">↓</button>
  <button class="mobile-toolbar-btn" data-key="left">←</button>
  <button class="mobile-toolbar-btn" data-key="right">→</button>
  <button class="mobile-toolbar-btn" data-key="pipe">|</button>
  <button class="mobile-toolbar-btn" data-key="dash">-</button>
  <button class="mobile-toolbar-btn" data-key="tilde">~</button>
  <button class="mobile-toolbar-btn" data-key="slash">/</button>
  <button class="mobile-toolbar-btn" data-key="colon">:</button>
  <button class="mobile-toolbar-btn" data-key="ctrl">ctrl</button>
  <button class="mobile-toolbar-btn" data-key="pgup">pgup</button>
  <button class="mobile-toolbar-btn" data-key="pgdn">pgdn</button>
</div>
```

Place it inside `<body>` but **outside** of `#main-content` — it's a fixed overlay, not part of the grid layout.

---

## Implementation: CSS

Add to `client/css/style.css`:

```css
/* === Mobile Toolbar === */
#mobile-toolbar {
  display: none;                          /* Hidden on desktop */
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1200;                          /* Above everything else */
  background: rgba(17, 17, 17, 0.95);
  border-top: 1px solid var(--td-border);
  padding: 4px 4px;
  gap: 4px;
  overflow-x: auto;                       /* Horizontal scroll if buttons overflow */
  -webkit-overflow-scrolling: touch;
  white-space: nowrap;
  flex-wrap: nowrap;
  align-items: center;

  /* Prevent the toolbar from being selected */
  user-select: none;
  -webkit-user-select: none;
}

@media (max-width: 767px) {
  #mobile-toolbar {
    display: flex;                        /* Show only on mobile */
  }

  /* Reserve space for toolbar so terminal content isn't hidden behind it */
  #main-content {
    padding-bottom: 42px;
  }
}

.mobile-toolbar-btn {
  flex-shrink: 0;
  min-width: 40px;
  height: 34px;
  padding: 0 8px;
  font-family: var(--td-font-terminal);
  font-size: 12px;
  color: var(--td-text);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--td-border);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.1s ease, border-color 0.1s ease;

  /* Critical: prevent button from being focusable via tap */
  -webkit-tap-highlight-color: transparent;
}

.mobile-toolbar-btn:active,
.mobile-toolbar-btn.active {
  background: rgba(10, 189, 198, 0.25);
  border-color: var(--td-cyan);
  color: var(--td-cyan);
}

/* Ctrl modifier active state (sticky toggle) */
.mobile-toolbar-btn.ctrl-active {
  background: rgba(10, 189, 198, 0.3);
  border-color: var(--td-cyan);
  color: var(--td-cyan);
  box-shadow: 0 0 6px rgba(10, 189, 198, 0.4);
}
```

### Positioning Above the Virtual Keyboard

The CSS `position: fixed; bottom: 0` places the toolbar at the bottom of the **visual viewport**, not the layout viewport. On most modern mobile browsers, this works correctly with the virtual keyboard — when the keyboard opens, the visual viewport shrinks and `bottom: 0` naturally sits above the keyboard.

However, some browsers (particularly older iOS Safari) have quirks where `position: fixed` is relative to the **layout** viewport, not the visual viewport. The JavaScript section below includes a `visualViewport` API fallback to handle this.

---

## Implementation: JavaScript

Add these methods to the `App` prototype in `client/js/app.js`:

### 1. Initialization (call from `App.prototype.init`)

In `App.prototype.init`, add the call after the existing setup:

```javascript
self._initMobileToolbar();
```

Add it after `self._wireOrientationChange();` in the init chain.

### 2. Key Map

```javascript
App.prototype._TOOLBAR_KEYS = {
  'esc':   '\x1b',
  'tab':   '\t',
  'up':    '\x1b[A',
  'down':  '\x1b[B',
  'left':  '\x1b[D',
  'right': '\x1b[C',
  'pipe':  '|',
  'dash':  '-',
  'tilde': '~',
  'slash': '/',
  'colon': ':',
  'pgup':  '\x1b[5~',
  'pgdn':  '\x1b[6~'
};
```

### 3. Init method

```javascript
App.prototype._initMobileToolbar = function () {
  var toolbar = document.getElementById('mobile-toolbar');
  if (!toolbar) return;

  var self = this;
  var ctrlActive = false;

  // ── CRITICAL: Prevent focus theft ──
  // This single line is what makes tab completion work on mobile.
  // Without it, tapping any button steals focus from xterm.js,
  // causing keyboard dismiss → viewport resize → SIGWINCH → readline corruption.
  toolbar.addEventListener('mousedown', function (e) {
    e.preventDefault();
  });

  // ── Handle button taps ──
  toolbar.addEventListener('click', function (e) {
    var btn = e.target.closest('.mobile-toolbar-btn');
    if (!btn) return;

    var key = btn.dataset.key;
    if (!key) return;

    // Handle Ctrl toggle
    if (key === 'ctrl') {
      ctrlActive = !ctrlActive;
      btn.classList.toggle('ctrl-active', ctrlActive);
      return;
    }

    var data;
    if (ctrlActive) {
      // Convert to control character: a=1, b=2, ..., z=26
      // For special keys (arrows, etc.), send Ctrl modifier escape sequence
      if (key.length === 1) {
        // Single character: convert to Ctrl code
        var code = key.toUpperCase().charCodeAt(0) - 64;
        if (code >= 1 && code <= 26) {
          data = String.fromCharCode(code);
        } else {
          data = self._TOOLBAR_KEYS[key] || key;
        }
      } else if (key === 'tab') {
        data = '\t';  // Ctrl+Tab is still just Tab
      } else {
        // For named keys, use their normal sequence
        data = self._TOOLBAR_KEYS[key] || key;
      }

      // Deactivate Ctrl after use
      ctrlActive = false;
      var ctrlBtn = toolbar.querySelector('[data-key="ctrl"]');
      if (ctrlBtn) ctrlBtn.classList.remove('ctrl-active');
    } else {
      data = self._TOOLBAR_KEYS[key] || key;
    }

    self._sendToActiveTerminal(data);
  });

  // ── visualViewport positioning ──
  // Keeps toolbar above the virtual keyboard on browsers where
  // position:fixed bottom:0 doesn't respect the visual viewport.
  if (window.visualViewport) {
    var reposition = function () {
      var vv = window.visualViewport;
      var bottomOffset = window.innerHeight - (vv.offsetTop + vv.height);
      toolbar.style.bottom = Math.max(0, bottomOffset) + 'px';
    };

    window.visualViewport.addEventListener('resize', reposition);
    window.visualViewport.addEventListener('scroll', reposition);
  }
};
```

### 4. Send to active terminal

```javascript
App.prototype._sendToActiveTerminal = function (data) {
  // Find the active (focused) terminal connection
  var activeConn = null;

  // Check grid cells for a focused terminal
  if (this._engine) {
    for (var i = 0; i < this._engine._cells.length; i++) {
      var cell = this._engine._cells[i];
      var info = this._engine._cellMap.get(cell);
      if (info && info.connection) {
        // Use the first visible terminal, or the last one interacted with
        if (!activeConn) activeConn = info.connection;
        // Check if this cell's terminal area contains the active element
        if (cell.contains(document.activeElement)) {
          activeConn = info.connection;
          break;
        }
      }
    }
  }

  if (!activeConn) return;

  // Send the keypress data to the terminal's WebSocket
  if (activeConn._ws && activeConn._ws.readyState === WebSocket.OPEN) {
    activeConn._ws.send(JSON.stringify({ type: 'input', data: data }));
  }

  // Re-focus the terminal to ensure subsequent keyboard input goes to it
  activeConn.focus();
};
```

---

## Integration Points

### Files to modify:

| File | Change |
|------|--------|
| `client/index.html` | Add `<div id="mobile-toolbar">` markup before `</body>` |
| `client/css/style.css` | Add `#mobile-toolbar` and `.mobile-toolbar-btn` styles |
| `client/js/app.js` | Add `_TOOLBAR_KEYS`, `_initMobileToolbar()`, `_sendToActiveTerminal()` to `App.prototype`; call `_initMobileToolbar()` from `init()` |

### Existing code this interacts with:

- **`terminal.js` — `TerminalConnection._ws`**: The toolbar sends input via the same WebSocket the terminal uses. It sends `{ type: 'input', data: '...' }` messages directly.
- **`terminal.js` — `TerminalConnection.focus()`**: Called after each toolbar button press to re-ensure the xterm.js textarea has focus.
- **`layout.js` — `LayoutEngine._cells` / `_cellMap`**: Used to find which terminal is active (which cell contains `document.activeElement`).
- **`layout.js` — `refitAll()` / `ResizeObserver`**: The resize observer on `#grid-container` is what triggers the SIGWINCH cascade. The `mousedown preventDefault` on the toolbar prevents this by keeping focus stable.
- **`layout.js` — Health monitor** (`_runHealthChecks`): Runs every 2 seconds. Won't interfere with toolbar since it only corrects dimension mismatches — it doesn't force resize if dimensions are already correct.

### Server-side (no changes needed):

- **`server/websocket.js`**: Already handles `type: 'input'` messages and writes them to the PTY. Input rate limiting (100 msg/sec) is generous enough for toolbar use.
- **`server/sessions.js`**: No interaction with toolbar.

---

## Testing Checklist

### Tab Completion (the original bug)
- [ ] Open a terminal on mobile
- [ ] Type `cd ` then a partial directory name (e.g., `cd Ai`)
- [ ] Tap the `tab` button on the toolbar
- [ ] **Expected**: The partial name completes (e.g., `cd AiWorker/`)
- [ ] **Not expected**: The typed text disappears, leaving just `cd`

### Basic Key Sending
- [ ] `esc` — exits vim insert mode or cancels a command
- [ ] `tab` — triggers bash tab completion
- [ ] Arrow keys — navigate command history (up/down) and move cursor (left/right)
- [ ] `|` — pipe character works in commands (e.g., `ls | grep foo`)
- [ ] `-`, `~`, `/`, `:` — type their respective characters
- [ ] `pgup` / `pgdn` — scroll tmux history

### Ctrl Modifier
- [ ] Tap `ctrl` — button highlights with cyan glow
- [ ] Tap `c` on the virtual keyboard — sends Ctrl+C (interrupts running process)
- [ ] `ctrl` button deactivates after use (no longer highlighted)
- [ ] Tap `ctrl` twice — toggles off without sending anything

### Focus Preservation
- [ ] Tap any toolbar button — virtual keyboard stays visible (does NOT dismiss and reappear)
- [ ] Type on virtual keyboard after tapping a toolbar button — input goes to the terminal
- [ ] No flickering, no layout jumps when using the toolbar

### Viewport Positioning
- [ ] With virtual keyboard closed: toolbar sits at the bottom of the screen
- [ ] With virtual keyboard open: toolbar sits directly above the keyboard
- [ ] Rotate device: toolbar repositions correctly
- [ ] Scroll in tmux: toolbar stays in position

### Edge Cases
- [ ] Toolbar hidden on desktop (viewport > 767px)
- [ ] Toolbar visible on mobile (viewport ≤ 767px)
- [ ] With no terminals open: toolbar taps are no-ops (no errors in console)
- [ ] With multiple terminals: toolbar sends to the focused terminal
- [ ] Rapid tapping: no duplicate keys, no missed keys
