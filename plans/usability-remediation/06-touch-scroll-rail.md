# Plan 06 — Touch Scroll Rail → tmux Copy-Mode

**Goal:** the touch scroll rail (currently dead code — it scrolls an xterm
viewport that never has overflow) becomes the mobile way to scroll tmux history
(approved: D3). Drag the rail = scroll through tmux scrollback.

**Depends on:** plan 02 (reuses its SGR wheel-forwarding + coalescing machinery).
**Audit refs:** F3, architecture note (alt screen ⇒ only tmux has scrollback).

## Design

The rail can no longer be a proportional scrollbar against a known-length buffer
(the client can't cheaply know tmux `history_size`/`scroll_position` per frame).
Repurpose it as a **drag-to-scroll velocity strip**:

- Touch/drag on the rail sends SGR scroll events (same encoder as plan 02) at a
  rate proportional to drag distance from the grab point (like "scroll wheel
  emulation"): small offset → slow scroll, large → fast (cap ~30 lines/s via the
  plan-02 coalescer).
- Direction: drag up → scroll back (btn 64), drag down → scroll forward (btn 65).
- First backward scroll naturally enters tmux copy-mode; tmux's own `[n/m]`
  indicator is the position feedback. Drop the client-side `posLabel`
  line-number readout (it read xterm buffer coordinates, which are meaningless
  here) — keep the label element but show `↑ history` / `↓ live` hints, or
  remove it entirely if that's simpler.
- Release: rail collapses as today. Scrolling forward past the end (tmux exits
  copy-mode automatically at bottom) returns to live view.

## Changes — `client/js/terminal.js` only (plus small CSS tweaks)

1. `_initScrollRail` / `_wireScrollRail` (~lines 452-637):
   - delete the `viewport.scrollTop` manipulation, the MutationObserver on the
     viewport, and the thumb-proportion math tied to `scrollHeight`;
   - visibility: rail shows when `this._mouseTrackingStripped` is true (tmux
     mouse mode active) AND the device has coarse pointer; keep the
     expand-on-grab behavior and haptics;
   - `touchmove` → compute `offsetLines = (grabY - touchY) / cellHeight`,
     feed sign+magnitude into the plan-02 accumulator on a ~100ms tick while
     held (not per-move, to keep message volume bounded);
   - keep `mousedown` support for desktop testing.
2. Thumb: without a real position source, style the thumb as a centered grab
   handle that offsets with the drag (springs back on release) rather than a
   proportional scrollbar.
3. `moveTo()` already re-appends `_scrollRail` — verify it still does after the
   rewrite (supersize path).
4. CSS: whatever `.td-scroll-*` rules the new behavior needs; delete rules that
   only served the proportional thumb.

## Acceptance criteria

- e2e with touch context (`hasTouch: true`, 390×844 viewport):
  - rail is **visible** on a terminal with tmux mouse active (it is always
    hidden today — this is the headline assertion);
  - `touchscreen` drag up on the rail → copy-mode indicator `[n/m]` appears and
    the visible first line changes;
  - drag down until bottom → indicator gone, live prompt visible;
  - typing afterwards works (input path undamaged).
- Desktop: rail hidden on fine-pointer devices (wheel covers desktop; avoids
  the audit's "rail steals right-edge clicks" hazard).
- All prior suites green.

## Risks / rollback

- Pure client feature isolated to the rail functions; rollback = revert.
- Feel (velocity curve, tick rate) is subjective — implement the simple linear
  mapping above, then hand to the owner for on-device tuning rather than
  iterating blind. Flag in the PR that constants are first-guess.
