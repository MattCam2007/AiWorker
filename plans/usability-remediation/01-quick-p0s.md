# Plan 01 — Quick P0s: Keyboard Default, Resize Throttle, Safe Paste

**Goal:** fix the three highest pain / lowest risk defects: typing dead until ⌨
toggle (F1), final resize silently dropped (F4a), context-menu paste unsafe and
silent-failing (F4b).

**Depends on:** plan 00 (harness). **Audit refs:** F1, F4a, F4b. **Decisions:** D5, D6.

## Part A — keyboard enabled by default on desktop (F1, D6)

Files: `client/js/app.js` (~line 1841-1855), `client/js/terminal.js` (no change
expected), harness helper.

1. In `_initMobileToolbar()`, replace the unconditional
   `this._keyboardHidden = true` with:
   - read `localStorage.getItem('td-kb-hidden')`; if `'0'` or `'1'`, use it;
   - else default to `window.matchMedia && window.matchMedia('(pointer: coarse)').matches`
     (true → hidden on touch devices, false → enabled on desktop).
   Mirror the value to `ns.TerminalConnection.keyboardHidden` and to the
   `kbToggle` class as today.
2. In the toggle click handler, persist the new state to
   `localStorage['td-kb-hidden']` (`'1'` hidden / `'0'` shown).
3. Guard `localStorage` access in try/catch (privacy modes throw).

## Part B — trailing-edge resize throttle (F4a)

File: `server/websocket.js` (resize handling around lines 465-489).

1. Extract the current validated-resize body (`case 'resize':` bounds checks +
   `terminal.pty.resize`) into a local `applyResize(terminal, terminalId, msg)`.
2. Replace the drop-on-<100ms logic with leading+trailing throttle:
   - if outside the 100ms window: apply immediately, record `lastResize`;
   - if inside: store `terminal.pendingResize = msg`; if no
     `terminal.resizeTimer`, set one for the remainder of the window that applies
     the *latest* pending resize, updates `lastResize`, clears timer/pending.
3. Clear `resizeTimer` in the grace-period cleanup, `onExit` cleanup, and
   `closeAll()` so no timer fires on a deleted terminal (guard the callback with
   `this._terminals.has(terminalId)` too).

## Part C — bracketed, honest paste (F4b, D5)

File: `client/js/terminal.js` (context menu Paste action, ~lines 669-679).

1. Replace `self._ws.send(JSON.stringify({type:'input', data:text}))` with
   `self._terminal.paste(text)` (routes through xterm → bracketed paste when the
   app enabled it → existing `onData` → WS path). Keep the focus() call.
2. Failure visibility: extract the existing copy-toast into a small
   `showToast(message)` helper reused by both copy and paste paths. When
   `navigator.clipboard.readText` is missing (insecure origin) or the promise
   rejects, show `Clipboard unavailable — press Ctrl+V` instead of silently
   returning.
3. Do not touch the copy-on-select path — audit verified it good.

## Acceptance criteria

- Harness: flip the **resize settles** and **paste round-trip** tests from
  documented-bug form to enforcing; both green.
- New e2e test: fresh desktop page load → type `echo kb-ok` with NO
  `#mt-kb-toggle` click → output appears. Update `createTerminal()` helper to
  stop clicking the toggle on desktop viewports.
- Manual (desktop browser): reload → type immediately; toggle ⌨ off → reload →
  still off (persisted); drag-resize the window edge for ~2s → prompt reflows to
  the final width with no "Refresh display" needed.
- Manual: clipboard `echo a\necho b\n` → right-click Paste → nothing executes
  until Enter; on an `http://<lan-ip>` origin the paste menu item shows the toast.
- `npm test`, `npm run test:integration`, `npm run test:e2e` all green.

## Risks / rollback

- Part A: mobile behavior must be unchanged (coarse pointer ⇒ still hidden by
  default). Verify with a mobile-emulation context (`hasTouch: true`, 390×844).
- Part B is server-only and strictly reduces dropped state; rollback = revert file.
- Part C: `term.paste()` exists in vendored xterm 5.3.0 (verified). If any TUI
  misbehaves with bracketed paste, that TUI opted into it — not our bug.
