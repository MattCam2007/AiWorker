# Plan 04 — Backpressure & Rate Limits

**Goal:** stop silently losing user input (F9a) and terminal output (F9b), and
remove the reconnect replay that can slice escape sequences (F12). After this
plan, "slow link + big output" degrades to *slower*, never to *corrupted*.

**Depends on:** plan 00. Coordinates with plan 02 (raises the input budget the
wheel coalescer was designed around — remove the `TODO(plan-04)` cap there).

## Part A — input limiter: byte budget, never silent drops (F9a)

File: `server/websocket.js` (`ws.on('message')` for terminal connections,
~lines 449-456).

1. Replace the 100-msgs/sec counter for `type:'input'` with a byte budget:
   16 KB per rolling 1s window per connection (generous for typing + paste +
   wheel bursts; a 1 MB paste still passes in ~1min — acceptable, and normal
   pastes are far smaller. If that feels wrong during implementation, ask).
2. Keep the existing 100-msgs/sec count limit for **non-input** message types
   (`resize`, `scroll_to_bottom`, future control).
3. On budget breach: do NOT silently drop. Log once and `ws.close(1008, 'input rate exceeded')`
   — the client's existing auto-reconnect takes over, and the user *sees* a
   blip instead of mysteriously missing characters.
4. Update plan 02's wheel flush cap from 6 to 10 msgs/frame and delete the TODO.

## Part B — output backpressure: pause the pty, don't drop frames (F9b)

File: `server/websocket.js` (`_setupPtyHandlers`, ~lines 315-331; `_safeSend`,
~lines 276-282).

1. `_safeSend` keeps its current drop-when-buffered behavior **only for the
   control channel** (`_sendToControl` callers). Terminal output must not go
   through a dropping path anymore.
2. In `pty.onData`, after sending to clients, check each client's
   `bufferedAmount`. If any client of this terminal exceeds HIGH_WATER (512 KB):
   `terminal.pty.pause()` and set `terminal.ptyPaused = true`.
3. Resume: a 100ms interval (or recursive setTimeout) started on pause; when
   every connected client's `bufferedAmount` < LOW_WATER (64 KB), call
   `terminal.pty.resume()`, clear the flag, stop the timer. Also resume/stop the
   timer when the last client disconnects (grace-period path) and in
   `closeAll()` — a paused pty must never leak.
4. Edge: a single wedged client can stall output for others sharing the
   terminal. Bound it: if a client stays above HIGH_WATER for >10s,
   `ws.terminate()` it (heartbeat already exists for dead sockets; this covers
   alive-but-drowning ones).

## Part C — drop the reconnect replay; redraw instead (F12)

File: `server/websocket.js` (~lines 327-330, 445-447), `server/sessions.js`.

1. On a new client joining an existing live pty, do NOT send `outputBuffer`.
   Instead trigger a full repaint: run
   `tmux -L <socket> refresh-client` scoped to the session
   (add `SessionManager.refreshClient(id)` wrapping
   `['-L', socket, 'refresh-client', '-t', tmuxName]`). tmux repaints the alt
   screen, which supersedes any replay.
2. Keep `outputBuffer` accumulation ONLY if the `exited` path still needs the
   last output for its 5s window; otherwise delete the buffer entirely
   (`outputBuffer`, its 64 KB trim, and the send-on-connect) — prefer deletion
   if nothing else reads it (check `websocket.test.js` first).

## Acceptance criteria

- Unit tests (mocked ws + fake pty, style of `server/websocket.test.js`):
  - input byte-budget breach → socket closed with 1008, pty never written
    with the over-budget payload;
  - `bufferedAmount` above HIGH_WATER → `pty.pause()` called; below LOW_WATER →
    `resume()`; wedged >10s → `terminate()`;
  - new client on live pty receives no replay; `refreshClient` invoked.
- e2e: reconnect test from plan 00 still passes (reload restores the screen via
  tmux redraw, marker appears exactly once); flood test: `seq 1 100000` then
  `echo AFTER-OK` → prompt intact, `AFTER-OK` present.
- All prior suites green.

## Risks / rollback

- Part B touches the hot output path — keep the per-chunk work O(clients).
- node-pty `pause()/resume()` exist on v1.1.0 (`IPty.pause/resume`); verify at
  implementation time and fall back to `_socket.pause()` on the internal socket
  ONLY if the public API is absent (then note it in the PR).
- Rollback = revert `websocket.js`/`sessions.js`; behavior returns to drop-based.
