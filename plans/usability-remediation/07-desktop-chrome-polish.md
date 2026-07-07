# Plan 07 — Desktop Chrome Polish

**Goal:** small persistent irritations: command palette unreachable from a
focused terminal (F8), mobile toolbar consuming desktop rows, listdeck proxy
failure noise, misc (F13). Lowest priority; land last.

**Depends on:** plan 01 (reuses its coarse-pointer detection). **Decisions:** D4.

## Part A — palette chord: Ctrl+Shift+P from anywhere (F8, D4)

Files: `client/js/terminal.js`, `client/js/command-palette.js`.

1. In `TerminalConnection.attach()`, after creating the xterm instance, register
   `this._terminal.attachCustomKeyEventHandler(function (e) { ... })`:
   - on `keydown` with `ctrlKey && shiftKey && (e.key === 'P' || e.key === 'p')`:
     call the palette's toggle (expose it as `ns.commandPalette` or via
     `ns.app._commandPalette` — follow how app.js wires it in
     `_initCommandPalette`) and `return false` (xterm must not send `\x10` etc.);
   - all other keys `return true`.
2. In `command-palette.js` document keydown (~lines 155-161): add the same
   Ctrl+Shift+P branch (for when focus is outside terminals). **Keep** the
   existing Ctrl+K binding for non-terminal focus (harmless, muscle-memory), but
   note in the palette UI hint text that the universal chord is Ctrl+Shift+P.
3. Note: browser devtools also uses Ctrl+Shift+P only when devtools has focus —
   no conflict in-page. Ctrl+Shift+P reaches page JS in Chrome/Firefox.

## Part B — mobile toolbar hidden on fine-pointer devices (F13)

Files: `client/js/app.js`, `client/css/style.css`.

1. Reuse plan 01's coarse-pointer check: when fine pointer, add
   `body.no-touch-toolbar`; CSS hides `#mobile-toolbar` under that class.
   Terminals gain the freed ~90px automatically via the existing
   ResizeObserver → refit path (verify; if the toolbar isn't in the grid's
   flex flow, trigger one `refitAll()` after toggling the class).
2. Escape hatch: keep the toolbar reachable on desktop via a command-palette
   entry ("Toggle touch toolbar") that flips the class and persists to
   localStorage (`td-toolbar-forced`) — some desktop users may use the key
   buttons. Read the override at init.
3. The ⌨ toggle lives inside the toolbar — with the toolbar hidden, plan 01's
   desktop default (keyboard enabled) makes it unnecessary. Confirm nothing else
   references `#mt-kb-toggle` visibility.

## Part C — listdeck proxy failure noise (F13)

Files: `server/index.js` (proxy route + logging), `client/js/today-tasks.js`.

1. Server: log the proxy target failure **once per process start** (first
   failure at `log.warn`, subsequent at `log.debug`), instead of every request.
2. Server: cache a failure for 60s and answer immediately with 503
   + `{error:'unreachable'}` during that window, rather than re-dialing a dead
   LAN IP on every sidebar render (kills the repeated 5xx console spam).
3. Client: on 503/`unreachable`, render the Today/Projects section in a quiet
   "not available" collapsed state (muted text, no red, no console.error);
   keep the manual refresh button as the retry.

## Part D — one-liners

- `client/index.html` / docs: note that "Fira Code" isn't bundled; either add a
  `@font-face` with a locally-hosted woff2 (preferred, no CDN) or change the
  default `fontFamily` doc to admit the generic-monospace fallback. Owner
  preference not gathered — implement the font bundling only if trivially
  licensable (OFL — it is); otherwise doc-only.
- README "Current Status" claims (130/130 tests) will be stale after this
  program — refresh the counts in whichever plan lands last.

## Acceptance criteria

- e2e: focus a terminal, press Ctrl+Shift+P → palette opens; Escape closes and
  focus returns to the terminal; plain Ctrl+K in a focused terminal still
  performs readline kill-line (assert edit-line change, palette stays hidden).
- Desktop context: `#mobile-toolbar` not visible; terminal rows increase vs
  before (compare `term.rows` pre/post class). Touch context: toolbar unchanged.
- Load the app with the listdeck host unreachable: no red "Failed to load", at
  most one warn line in server logs, no repeated console errors in the page.
- All prior suites green.

## Risks / rollback

- Part A returns `false` only for the exact chord — any bug here risks eating
  keystrokes; the custom handler must default to `return true`.
- Part B could regress mobile if the pointer heuristic misfires on hybrid
  (touchscreen laptop) devices — the palette escape hatch covers it; mention in
  the PR description.
