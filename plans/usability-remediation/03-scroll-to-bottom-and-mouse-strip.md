# Plan 03 — "Scroll to Bottom" Correctness + Mouse-Strip Robustness

**Goal:** stop injecting a literal `q` into foreground apps (quits `less`, arms a
vim macro — F5), and make the mouse-mode stripping immune to chunk boundaries and
mode-off sequences (intermittent broken selection — F10).

**Depends on:** plan 00. Independent of 01/02 (can land in any order after 00).

## Part A — scroll-to-bottom via tmux, not `q` (F5)

Files: `client/js/terminal.js` (~lines 693-716), `server/websocket.js`
(terminal message switch, ~line 471), `server/sessions.js` (optional helper).

1. **Server:** add a `case 'scroll_to_bottom':` to the terminal WS message
   switch. Handler: if `!terminal.exited`, run
   `execFile('tmux', ['-L', <socket>, 'send-keys', '-t', <tmuxName>, '-X', 'cancel'])`.
   Add a small `SessionManager.cancelMode(id)` method next to `sendKeys()` for
   this (it already knows socket + naming). `-X cancel` exits copy-mode and is
   an error/no-op when the pane isn't in a mode — swallow the error silently.
2. **Client:** in the context-menu "Scroll to bottom" action, delete the branch
   that sends `'q'` (`terminal.js:707-714`) and instead send
   `{type:'scroll_to_bottom'}`. Keep the local `scrollToBottom()` +
   viewport-pin code — it's harmless and covers the non-tmux edge.
3. Rate limiting: message goes through the existing per-connection limiter —
   no special handling needed.

## Part B — stateful, precise mouse-mode strip (F10)

File: `client/js/terminal.js` (output handling, ~lines 285-295). Extract for
testability.

1. Extract the strip into a pure-ish helper on the prototype or module scope:
   `stripMouseModes(chunk, state)` → `{ out, state }`, where `state` carries:
   - `carry`: tail of the previous chunk if it ends inside a possible
     `\x1b[?...` prefix (keep ≤12 trailing chars matching `/\x1b(\[(\?[\d;]*)?)?$/`);
     prepend to the next chunk before matching, so sequences split across
     WebSocket frames are still caught;
   - per-mode booleans for 1000/1002/1003 tracking `h`/`l`.
2. Narrow the pattern to `\x1b\[\?(?:1000|1002|1003|1006)[hl]`:
   - strip 1000/1002/1003 (tracking modes) and 1006 (SGR encoding) as today;
   - **stop matching 1004 and 1005** — 1004 (focus reporting) must pass through
     to xterm untouched (xterm answers focus events natively; the current code
     eats it and falsely sets the stripped flag).
3. `_mouseTrackingStripped` becomes derived: true while any of 1000/1002/1003 is
   on; set false when all are off (fixes the sticky flag).
4. Unit tests (jsdom-free, plain mocha in `client/js/terminal.test.js` style):
   - sequence split across two chunks is stripped and sets the flag;
   - `...l` turns the flag off; re-`h` turns it on;
   - `\x1b[?1004h` passes through unmodified and does NOT set the flag;
   - ordinary output containing `[?100` as plain text is not mangled.

## Acceptance criteria

- New e2e test (regression for F5): open `seq 1 500 | less`, context-menu
  "Scroll to bottom" → still inside `less` (prompt NOT visible); press `q` →
  back at prompt. Second case: enter copy-mode via PageUp, invoke
  "Scroll to bottom" → copy-mode indicator gone, live view restored.
- Part B unit tests green; existing e2e selection behavior unchanged
  (drag-select + copy toast still work).
- All prior suites green.

## Risks / rollback

- Part A adds one WS message type (pre-approved). Rollback = revert both files.
- Part B changes bytes fed to xterm only in the narrow strip cases; the unit
  tests pin the exact transformations. If any TUI regression appears, compare
  against the old single-regex behavior before assuming the parser is wrong.
