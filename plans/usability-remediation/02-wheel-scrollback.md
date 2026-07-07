# Plan 02 — Wheel Scrollback Restoration

**Goal:** make the mouse wheel scroll tmux history again on desktop. Wheel-up at
the shell enters tmux copy-mode (approved: D1); wheel speed feels normal on both
wheel mice and trackpads; a scroll flick cannot starve keystrokes.

**Depends on:** plans 00 and 01. **Audit refs:** F2 (root cause), F9a (client half).

## Background (from audit — do not re-derive)

The existing wheel→SGR forwarder in `client/js/terminal.js:160-186` is correct in
what it sends but never fires: xterm.js listens on the inner `.xterm` element and
stops propagation, so the bubble-phase listener on the mount element sees nothing.
Verified: real wheel → 0 messages; synthetic dispatch on the mount → 3 SGR
messages and tmux scrolls. Vendored xterm 5.3.0 has no
`attachCustomWheelEventHandler`, so we must win via the capture phase.

## Changes — all in `client/js/terminal.js`, inside `attach()`

1. **Capture the event first.** Re-register the existing wheel handler with
   `el.addEventListener('wheel', handler, { capture: true, passive: false })` and
   add `e.stopPropagation()` immediately after the existing `e.preventDefault()`
   (only on the forwarding path, i.e. when `_mouseTrackingStripped` is true —
   when it's false, return early *without* preventDefault/stopPropagation so
   xterm's own behavior is preserved).
2. **Scale by real delta.** Replace the fixed `var lines = 3` with:
   - `deltaMode === 1` (line mode): `lines = |deltaY|`
   - `deltaMode === 0` (pixel mode): `lines = |deltaY| / cellHeight`
   (`cellHeight` already computed from the render service in this handler).
3. **Coalesce per animation frame.** Keep a per-connection accumulator:
   handler adds signed lines to `this._wheelAccum` and schedules one
   `requestAnimationFrame` flush if none pending. The flush sends
   `min(round(|accum|), 10)` SGR messages of the appropriate direction
   (btn 64 up / 65 down) using the *last* known col/row, then resets the
   accumulator (carry the sub-1-line fraction). This caps WS traffic at
   ≤10 msgs/frame (~600/s worst case → see plan 04 for the server-side budget;
   until plan 04 lands, cap at 6 msgs/frame to stay under the current
   100 msg/s limit — leave a `TODO(plan-04)` comment).
4. **Cleanup:** cancel any pending rAF flush in `detach()`.

Do not touch the strip regex here (plan 03 owns it) and do not change the
`_mouseTrackingStripped` gating.

## Acceptance criteria

- Harness: flip the **wheel scrollback** e2e test to enforcing: 3 wheel-up ticks
  at the shell → copy-mode indicator `[n/m]` visible; then wheel-down past the
  bottom (or `q`) returns to live view.
- New e2e assertions:
  - wheel-down at the live shell does NOT enter copy-mode / send anything odd
    (buffer unchanged, no stray characters on the prompt line);
  - in `less` (inner alt screen with tmux mouse on): one `mouse.wheel(0,120)`
    tick moves ≤5 lines (fixes the ~8-lines-per-tick stacking observed in the
    audit);
  - burst test: 30 rapid `mouse.wheel` calls followed immediately by typing
    `echo intact` → `intact` appears (no dropped keystrokes).
- Manual: trackpad flick feels proportional (if a trackpad is available);
  drag-select still copies (selection service must remain active).
- All prior suites green.

## Risks / rollback

- Highest-touch client change in the program. Keep it confined to the wheel
  handler + accumulator; rollback = revert `terminal.js`.
- Watch for double-scroll in inner-alt-screen apps (tmux converts our SGR wheel
  to arrows AND xterm alternate-scroll used to fire — after step 1 xterm never
  sees the event on the forwarding path, so only tmux's conversion remains; the
  `less` e2e assertion above proves it).
