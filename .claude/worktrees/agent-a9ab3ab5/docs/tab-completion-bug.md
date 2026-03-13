# Tab Completion Bug: Diagnosis and Resolution

## Symptom (mobile only)

1. `cd AiW<tab>` → appears to do nothing
2. `<tab>` again → `cd AiWorker/AiW` (completion + original input duplicated)

## Root Cause: Two Bugs in `_sendToActiveTerminal`

Both bugs originate in `client/js/app.js:915-927` (`_sendToActiveTerminal`):

```js
// Line 922: dispatch compositionend — async inside xterm.js
term.textarea.dispatchEvent(new CompositionEvent('compositionend'));

// Line 925-926: send Tab IMMEDIATELY — synchronous
activeConn._ws.send(JSON.stringify({ type: 'input', data: data }));
```

---

### Bug 1: Tab Arrives Before Composed Text (Race Condition)

`dispatchEvent` fires the DOM event synchronously, but xterm.js's internal `compositionend` handler processes the committed text through a `setTimeout` callback (queued, not immediate). The `\t` WebSocket send at line 926 fires **before** xterm.js has flushed the composed text through `onData` to the WebSocket.

**First Tab timeline:**

```
_sendToActiveTerminal('\t') called
  │
  ├─ compositionend dispatched           → xterm.js queues "AiW" via setTimeout
  ├─ ws.send('\t')                       → Tab sent to PTY immediately
  │
  ├─ PTY receives '\t'                   → readline sees Tab with EMPTY prefix
  │                                        → nothing to complete, no output
  ├─ setTimeout fires                    → xterm.js commits "AiW" via onData
  ├─ PTY receives 'AiW'                  → readline echoes "AiW" on the line
```

Result: first Tab does nothing because readline got `\t` before it got `AiW`.

### Bug 2: IME Double-Commit (Keyboard State Desync)

The synthetic `compositionend` tells xterm.js that composition ended, but the **mobile keyboard doesn't know**. Its IME buffer still holds the composed text. When `activeConn.focus()` fires at line 929 (or the keyboard re-synchronizes), the IME commits the text **again** via a real `input` event.

**Second Tab timeline:**

```
_sendToActiveTerminal('\t') called
  │
  ├─ compositionend dispatched           → no-op (nothing in IME now)
  ├─ ws.send('\t')                       → Tab sent to PTY
  │
  ├─ PTY receives '\t'                   → readline has "AiW" prefix from Bug 1
  │                                        → completes to "AiWorker/"
  ├─ IME re-commit from Bug 2            → "AiW" sent to PTY again
  ├─ PTY receives 'AiW'                  → readline echoes "AiW" after completion
```

Result: `cd AiWorker/AiW`

---

## Planned Resolution

Replace the synthetic `compositionend` approach entirely. The fix must:
1. **Ensure composed text reaches the PTY before Tab** (fix the race)
2. **Not desync the mobile keyboard's IME state** (fix the double-commit)

### Approach: Read and Send the Composition Buffer Directly

Instead of faking a DOM event, manually extract any uncommitted text from the textarea, send it over the WebSocket, clear the textarea, and *then* send the toolbar key:

```js
App.prototype._sendToActiveTerminal = function (data) {
  var activeConn = /* ... existing connection lookup ... */;
  if (!activeConn) return;

  var term = activeConn._terminal;
  var ws = activeConn._ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  // Flush any pending IME composition manually.
  // We read the textarea value directly and send it ourselves,
  // then clear the textarea — this avoids both the setTimeout race
  // (synthetic compositionend is processed async by xterm.js) and
  // the IME desync (the keyboard doesn't know about synthetic events).
  if (term && term.textarea) {
    var pending = term.textarea.value;
    if (pending) {
      ws.send(JSON.stringify({ type: 'input', data: pending }));
      term.textarea.value = '';
      // Tell xterm.js composition is done so it resets internal state
      term.textarea.dispatchEvent(new CompositionEvent('compositionend'));
    }
  }

  // Now send the toolbar key — composed text is guaranteed to be
  // at the PTY already since we sent it synchronously above.
  ws.send(JSON.stringify({ type: 'input', data: data }));

  activeConn.focus();
};
```

### Why This Works

- **Fixes the race**: The composed text (`AiW`) is sent via `ws.send()` synchronously *before* `\t`. Both go through the same WebSocket in order. Readline sees `AiW` then `\t`.
- **Fixes the double-commit**: We clear `textarea.value = ''` before dispatching `compositionend`. The IME has nothing left to re-commit. The synthetic event is only used to reset xterm.js's internal composition state, not to trigger text processing.

### Risk Assessment

- **Low risk**: Only affects mobile toolbar button presses, not regular keyboard input
- **Edge case**: If `textarea.value` contains text that was already committed (not in composition), we'd send it again. May need to check `term._compositionHelper.isComposing` to guard against this.
- **Test**: Type partial text on mobile keyboard → tap Tab → verify single clean completion with no duplication
