# Plan 05 — Multi-Client Size Mirroring

**Goal:** two browser tabs (or phone + desktop) on the same terminal stop fighting
over pty size. Policy (approved: D2): **mirror at pty size** — the pty has one
authoritative size; every client renders exactly that, letterboxed inside its
cell when the cell is bigger. This is native tmux multi-client behavior.

**Depends on:** plans 00 and 01 (needs the trailing-edge resize throttle so the
authoritative size settles deterministically). **Audit refs:** F7.

## Design

- Authoritative size = the **most recent resize request from any client**
  (last-writer-wins, unchanged) — but now the server *echoes the applied size to
  every client* of that terminal, so no client is left rendering a stale grid.
- Clients stop trusting FitAddon as the final word: fit still *proposes* a size
  (that client's preference, sent as `resize`), but the terminal's actual
  cols/rows always follow the server echo.

## Changes

### Server — `server/websocket.js`

1. In the (post-plan-01) `applyResize()`: after `terminal.pty.resize(cols, rows)`,
   store `terminal.size = {cols, rows}` and broadcast
   `{type:'resize', cols, rows}` to **all** clients of the terminal (including
   the requester — single code path).
2. On new client connect to an existing pty: if `terminal.size` exists, send the
   current `{type:'resize', ...}` to that client immediately after attach
   (before/with the tmux refresh from plan 04-C).

### Client — `client/js/terminal.js`

3. Handle `case 'resize':` in `_ws.onmessage`: if the terminal exists and
   `(cols, rows)` differ from current, call `this._terminal.resize(cols, rows)`.
   Do NOT call FitAddon here and do NOT send a resize back (no echo loops:
   client only sends `resize` from fit/refit paths, never from this handler).
4. `refit()` / `_sendResize()` stay as-is: they propose the new size; the echo
   applies it everywhere.
5. **Letterbox visibility:** when the applied size is smaller than what fit
   would propose (compare against `proposeDimensions()`), add a class
   `td-mirrored` to the mount and set a `title` on the cell header name element:
   `mirrored at <cols>×<rows> (resized by another client)`. Remove both when
   sizes match again. Keep it to tooltip + subtle class — no layout chrome.

### CSS — `client/css/style.css`

6. `.td-mirrored .xterm` gets a faint outline or reduced-opacity border cue
   (pick something consistent with the theme; one rule, no new UI elements).

## Acceptance criteria

- e2e (extends the audit's two-tab repro): tab A 1440×900, tab B 800×500 on the
  same terminal. After B connects: A's `term.cols/rows` == B's == tmux
  `#{pane_width}x#{pane_height}`; typing a 100-char line in A shows identical
  wrapping in both tabs (no 82-col-rendered-at-45 garbage). Close B, resize A →
  A's fit wins again and the mirrored cue clears.
- Reload with a single client behaves exactly as before (echo == own proposal;
  no visible change).
- All prior suites green.

## Risks / rollback

- Echo loops are the classic failure mode — the rule in step 3 (never send from
  the echo handler) prevents them; add a unit test asserting no `resize` WS
  message is emitted in response to a server `resize`.
- FitAddon may re-fit on its own triggers (ResizeObserver via `refitAll`) and
  re-propose a bigger size, flapping with a smaller client. That's inherent to
  last-writer-wins and settles at whichever client acted last — acceptable per
  D2. If flapping proves annoying in practice, note it for a follow-up
  ("smallest client wins" variant) — do not implement speculatively.
