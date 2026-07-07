# TerminalDeck Usability Audit — 2026-07-06

Scope: day-to-day usability of the web terminal (interaction, terminal fidelity, feel).
Not a security audit. All findings below were **observed live** by running the server
locally (`node server/index.js`, tmux 3.4, the shipped `config/tmux.conf` installed as
`~/.tmux.conf`) and driving the real UI in headless Chromium (Playwright, 1440×900
desktop viewport, clipboard permissions granted). Every finding cites the code
responsible. Execution of fixes is a separate step — this document is written so a
smaller model can implement it phase by phase without re-deriving the analysis.

**Architecture context that shapes everything below:** the browser xterm.js instance is
attached (via WebSocket → node-pty) to `tmux attach-session`. tmux puts the *outer*
terminal on the **alternate screen** for its entire lifetime. Verified live:
`buffer.active.type === 'alternate'` from the moment the prompt appears, xterm buffer
length stays == rows (20), `scrollHeight === clientHeight` always. Consequences:

- xterm.js's own 5000-line scrollback (`terminal.js:49`) is **never populated**.
- The only real scrollback is tmux's `history-limit 10000`, reachable only through
  tmux copy-mode.
- Any client feature that scrolls the xterm viewport (wheel default behavior, the
  touch scroll rail) is a no-op by construction.

---

## Reproduction of the two reported symptoms

### Symptom A: "Scrolling doesn't always work"

**Confirmed, and on desktop it is worse than "doesn't always work" — mouse-wheel
scrollback never works at the shell.** Findings F2, F3(rail), and the speed issue in
full-screen apps below.

Observed matrix (all live):

| Context | Wheel result | Why |
|---|---|---|
| Shell prompt / main screen | **Nothing at all** | F2: forwarding handler never fires; alt-screen buffer has no local scrollback |
| `less` / `vim` (inner alt screen) | Scrolls, but ~8 lines per tick (way too fast) | xterm.js "alternate scroll" converts wheel→arrow keys itself; the intended SGR-forwarding path is dead |
| PageUp key | Works (tmux copy-mode via `config/tmux.conf` `bind -n PageUp copy-mode -eu`) | keyboard path doesn't involve the broken wheel handler |
| Touch scroll rail | **Never appears** | rail scrolls the xterm viewport, which never has overflow (alt screen), so it always gets `td-scroll-hidden` |

**Root cause of the dead wheel (F2):** `client/js/terminal.js:160-186` registers the
wheel→SGR-mouse forwarder on the *mount element* (`.cell-terminal`), in the bubble
phase. xterm.js registers its own wheel listener on the `.xterm` element *inside* the
mount and **stops propagation**. Instrumented live: 3 real wheel events over the
terminal → xterm element listener fired 3×, mount listener fired **0×**, 0 SGR
messages on the WebSocket. Dispatching a synthetic wheel event directly on the mount
produced 3 SGR messages and tmux scrolled — i.e. the forwarding code itself works; it
is simply attached where events can no longer reach it. (The vendored xterm.js 5.3.0
has no `attachCustomWheelEventHandler`, so the listener must win by using the capture
phase instead.)

Secondary causes stacked on top:

- **Speed/multiplier stacking:** the handler sends a fixed 3 SGR scroll events per DOM
  wheel event regardless of `deltaY`/`deltaMode` (`terminal.js:179-186`). Trackpads
  emit dozens of small-delta events per flick; each would become 3 tmux scroll
  events → far too fast, and at 3 JSON messages per event a flick can exceed the
  server's silent 100-msgs/sec input limit (`server/websocket.js:456`), which drops
  *keystrokes* too (F9).
- **Strip-regex fragility (F10):** the client strips mouse-tracking enables so xterm
  selection keeps working (`terminal.js:290-294`). The regex only matches sequences
  fully contained in one WebSocket frame; a `\x1b[?1000h` split across two pty chunks
  leaks through and flips xterm into real mouse-tracking mode (selection breaks until
  reload). The `_mouseTrackingStripped` flag is also never reset on `l` (disable), and
  the range `100[0-6]` wrongly includes 1004 (focus reporting) and 1005, while
  missing 1015. This explains intermittent "sometimes selection/scroll behaves
  differently" reports.

### Symptom B: "Copy/paste behaves oddly"

**Confirmed. Copy is mostly fine; paste has two different behaviors depending on how
you invoke it, and one of them is dangerous.**

Observed live:

- **Copy-on-select works well**: one clipboard write per completed drag (not per
  mousemove), correct text, "Copied!" toast. Triple-click on a 150-char wrapped line
  yields the full 150 chars with **no** injected newlines — and this survives a full
  tmux redraw ("Refresh display"). Good — do not "fix" this.
- **Right-click → Paste executes multi-line clipboard content immediately.** With
  clipboard `echo P1\necho P2\n`, both commands ran the instant Paste was clicked.
  Mechanism: `terminal.js:669-679` sends the raw clipboard string as `input`,
  bypassing xterm's `term.paste()` and therefore **bracketed paste**. The same
  clipboard pasted with Ctrl+Shift+V (xterm's native path) was inserted inertly into
  the readline edit buffer, awaiting Enter — verified side by side. Two paste
  gestures, two behaviors; the more discoverable one (context menu) is the unsafe one.
  In vim, the raw path also produces autoindent staircase; the bracketed path doesn't.
- **On the real deployment, right-click Paste probably does nothing at all.** The
  docker deployment serves plain HTTP on a LAN IP (`http://<host>:3000`); that is an
  insecure origin, where `navigator.clipboard.readText` is undefined. The code path
  ends in `.catch(function(){})` / a silent `if` — no error, no toast
  (`terminal.js:671-678`). Copy still works there because the `execCommand('copy')`
  fallback exists (`terminal.js:140-147`); paste has no fallback. "Paste behaves
  oddly" = *executes instantly when it works, silently does nothing on HTTP*.
- One residual copy oddity to expect (mechanism-level, low frequency): selection is a
  screen-region copy of what tmux painted, so selecting while tmux copy-mode is open
  can capture the `[18/82]` position indicator, and mouse-strip leaks (F10) can kill
  drag-select entirely until reload.

---

## All findings, ranked by daily pain ÷ fix risk

### P0-1 (F1). Keyboard input is dead on every page load until the ⌨ toggle is clicked

- **Observed:** fresh load, click terminal, type — nothing reaches the shell.
  `TerminalConnection.keyboardHidden === true` at startup on a 1440×900 desktop.
  After clicking `#mt-kb-toggle`, typing works. Reproduced 100% of loads.
- **Mechanism:** `client/js/app.js:1841-1844` — `_initMobileToolbar()` runs
  unconditionally (`app.js:83`) and sets `keyboardHidden = true` ("Default: keyboard
  hidden on mobile") with no mobile check. `client/js/terminal.js:64-71` then blurs
  the xterm textarea on every focus attempt, and `focus()` is a no-op
  (`terminal.js:430-435`). The intent (suppress the mobile virtual keyboard) is
  applied to physical keyboards too.
- **Smallest fix:** in `app.js` initialize
  `keyboardHidden = window.matchMedia('(pointer: coarse)').matches` (or the existing
  `_isMobile()` helper), and persist the user's toggle in `localStorage`. Desktop
  gets typing immediately; mobile behavior unchanged.
- **Risk:** minimal. (If the daily driver is mobile, this bug is invisible there —
  which is presumably why it survived.)

### P0-2 (F2). Mouse-wheel scrollback dead on desktop (Symptom A)

- **Observed/mechanism/proof:** see Symptom A above. `terminal.js:160-186`.
- **Smallest fix (three small parts, same handler):**
  1. Register the existing wheel handler with `{ capture: true, passive: false }` on
     the mount, and add `e.stopPropagation()` next to the existing `preventDefault()`
     so xterm's (useless-in-alt-screen) handler never runs. No other logic moves.
  2. Scale events: compute `lines = max(1, round(|deltaY| / (deltaMode === 1 ? 1 : cellHeight)))`
     instead of the fixed 3, and cap per-event lines (e.g. 10).
  3. Coalesce: accumulate wheel deltas and flush once per `requestAnimationFrame`,
     sending at most a handful of SGR messages per frame — keeps a trackpad flick
     under the server's 100 msg/s input limit.
- **Behavior note:** wheel-up at the shell will now drop tmux into copy-mode (tmux
  `mouse on` semantics). That *is* the designed behavior this code intended; it just
  never fired. Still listed in "flag, don't silently do" because users will newly see
  copy-mode.
- **Risk:** moderate — this is the highest-touch fix. Gate it behind the Phase 0
  harness assertions.

### P0-3 (F4). Resize race: final resize silently dropped, terminal wedged at stale size

- **Observed:** three programmatic window resizes ~30ms apart → xterm settled at
  74×17, tmux pane stayed **82×20** indefinitely (checked 1.5s later; nothing
  reconciles it). Real-world trigger: any window-edge drag, sidebar/toolbar
  transitions (which fire multiple `refitAll()`s ~250ms apart, `app.js:1878`),
  mobile keyboard show/hide. Matches the README's own "Blank terminal after layout
  switch" troubleshooting entry and the existence of the "Refresh display" workaround
  button (`terminal.js:401-424`, which itself compensates by waiting 150ms > "the
  server's 100ms throttle").
- **Mechanism:** `server/websocket.js:465-469` — resize messages arriving <100ms
  after the previous one are **discarded** (leading-edge throttle with no trailing
  apply). The client fires-and-forgets (`terminal.js:324-331`). Whoever resizes last
  within a burst loses, and the pty/xterm disagree until some unrelated event.
- **Smallest fix (server-side, one function):** turn the throttle into
  leading+trailing: store `terminal.pendingResize = {cols, rows}` when throttled and
  apply it via a `setTimeout` for the remainder of the window. ~6 lines in
  `websocket.js`.
- **Risk:** minimal; strictly reduces dropped state.

### P0-4 (F5). Context-menu Paste: no bracketed paste + silent failure on HTTP (Symptom B)

- **Observed/mechanism:** see Symptom B. `terminal.js:669-679`.
- **Smallest fix:** replace the raw `ws.send` with `self._terminal.paste(text)` —
  xterm then applies bracketed paste when the app enabled it and normalizes
  newlines; the data still flows through the existing `onData` → WS path. Add a
  user-visible toast ("Clipboard unavailable — use Ctrl+V") in the `catch`/missing-API
  branch instead of silence.
- **Risk:** low. (`term.paste` exists in xterm 5.3.0.)

### P1-1 (F6). "Scroll to bottom" types a literal `q` into whatever is running

- **Observed:** with `less` open, context-menu "Scroll to bottom" **quit less**
  (back at prompt — position lost). In vim it primes `q` (macro recording on the
  next keystroke).
- **Mechanism:** `terminal.js:707-714` sends `'q'` whenever
  `_mouseTrackingStripped && buffer.type === 'alternate'`. Under tmux the outer
  buffer is *always* alternate (see architecture note), so the guard that was meant
  to detect "tmux copy-mode" instead matches every full-screen app. `q` only means
  "exit copy-mode" inside copy-mode.
- **Smallest correct fix:** the client cannot know `pane_in_mode`. Add a tiny server
  control message (`{type:'scroll_to_bottom'}` on the terminal WS) whose handler runs
  `tmux -L <socket> send-keys -t <session> -X cancel` — `-X cancel` is a no-op unless
  the pane is in a mode, so it is safe for less/vim. Client sends that instead of `'q'`.
- **Risk:** low, but it adds a WS message type — flagged below.

### P1-2 (F9a). Input rate limit silently eats keystrokes

- **Mechanism (latent, code-verified):** `server/websocket.js:449-456` drops *any*
  message beyond 100/sec/connection — including typed characters — with no feedback.
  Every keystroke is one JSON message; the wheel fix (F2) and the mobile toolbar's
  multi-message sends (`terminal.js:206-241`) push toward the cap during
  scroll+type bursts.
- **Smallest fix:** exempt or greatly raise the cap for `input` (e.g. budget on
  bytes, 16KB/s, not message count), keep the cap for control types; and pair with
  client-side wheel coalescing from F2. Never silently drop `input` — if a client is
  truly abusive, close the socket so the user *sees* a disconnect instead of losing
  characters.

### P1-3 (F9b). Output frames silently dropped under backpressure

- **Mechanism (latent, code-verified):** `server/websocket.js:276-282` `_safeSend`
  *skips* output frames whenever the socket has >256KB buffered. Dropping arbitrary
  chunks of a terminal byte stream can cut escape sequences in half and desyncs the
  screen until the next full redraw — the classic "corrupted TUI after big output on
  a slow link" (the repo even has a Refresh button and docs for TUI corruption).
  My local flood test (100k lines) didn't trigger it (fast loopback + tmux collapses
  output), but any slow/mobile link under `cat bigfile` will.
- **Smallest fix:** for terminal output, call `terminal.pty.pause()` when
  `bufferedAmount` crosses the high-water mark and `resume()` when it drains
  (node-pty supports pause/resume), instead of dropping. Keep drop behavior for
  non-critical control broadcasts only.

### P1-4 (F7). Two clients on one terminal fight over size; loser renders garbage

- **Observed:** tab2 opened at 800×500 resized the shared pty to 45×8; tab1's xterm
  (82 cols) then rendered output wrapped at 45 columns with visual garbage
  (screenshot: long echo wraps mid-screen; stray `^C` artifacts).
- **Mechanism:** one pty per terminal shared by all clients
  (`server/websocket.js:398-434`); each client sends `resize` on open/refit;
  last-writer-wins; nothing tells the other client the pty size changed.
- **Smallest fix:** when the server applies a resize, broadcast
  `{type:'resize', cols, rows}` to *all* clients of that terminal; the client calls
  `term.resize(cols, rows)` (not FitAddon) so every view renders the pty's true
  size (smaller than the cell → letterboxed but correct, which is exactly what
  native tmux multi-client does). Policy choice flagged below.

### P2-1 (F3). Touch scroll rail is dead code; xterm scrollback config is inert

- **Observed:** `.td-scroll-rail` always carries `td-scroll-hidden`
  (scrollHeight==clientHeight). ~185 lines (`terminal.js:452-637`) of touch UX that
  can never activate; `scrollback: 5000` (`terminal.js:49`) buys memory for nothing.
- **Smallest fix:** after F2 lands, either (a) repoint the rail's drag handler at the
  same SGR-forwarding function wheel uses (rail position ↔ tmux copy-mode scroll), or
  (b) delete the rail. Decision flagged as an open question — (a) is the only way
  mobile gets drag scrollback at all, since the mobile pgup/pgdn buttons are the
  current workaround.

### P2-2 (F8). Command palette unreachable from the terminal; Ctrl+K asymmetry

- **Observed:** with terminal focused, Ctrl+K performed readline kill-line and the
  palette stayed hidden (xterm consumes the keydown before the document listener,
  `command-palette.js:155-161`). Palette only opens when focus is outside every
  terminal — the opposite of the usual "palette from anywhere" expectation. At least
  it doesn't double-fire.
- **Smallest fix:** register a chord that shells rarely use via xterm's
  `attachCustomKeyEventHandler` on each terminal (e.g. Ctrl+Shift+P / Ctrl+Shift+K →
  open palette, return false), leaving plain Ctrl+K to readline. Chord choice = open
  question.

### P2-3 (F10). Mouse-mode strip regex: chunk-boundary leaks, sticky flag, wrong range

- **Mechanism:** described under Symptom A. `terminal.js:290-294`, flag consumed at
  `terminal.js:165`.
- **Smallest fix:** keep a small carry buffer (last ≤8 bytes of a frame ending in a
  partial `\x1b[?...` sequence) so sequences split across frames are still matched;
  set flag false on matching `l`; restrict the set to `1000|1002|1003|1006` (leave
  1004 focus events alone — and stop stripping them, xterm handles 1004 natively and
  apps like vim/Claude Code use it).

### P2-4 (F11). Device-Attributes responses filtered unconditionally

- `terminal.js:193-196` drops every `\x1b[[?>]…c` response from xterm, so tmux's DA
  queries at attach never get answers (workaround for a real mobile-reconnect echo
  bug per the comment). tmux times out its feature detection instead — slower attach
  and potentially conservative feature use. Leave, but note: a better-scoped filter
  would only drop DA responses arriving >Ns after connect, or the server could
  answer tmux's DA itself. Low priority.

### P2-5 (F12). Reconnect replay buffer can start mid-escape-sequence

- `server/websocket.js:327-330, 445-447`: 64KB replay sliced at an arbitrary char
  boundary. Observed reload behaved fine (tmux's full redraw immediately repaints the
  alt screen, masking it), and no duplication occurred. Latent junk-characters risk
  only. Optional fix: drop the replay entirely for alt-screen tmux attaches (the
  attach redraw supersedes it) — flagged, since it changes reconnect visuals.

### P2-6 (F13). Chrome roughness (desktop)

- Mobile toolbar + keys rows occupy the bottom ~90px of a desktop viewport
  (screenshots), stealing terminal rows; `@media` hides exist but the toolbar shows
  at 1440×900. Tie its default visibility to the same coarse-pointer check as F1.
- Hard-coded LAN service proxy (`listdeck`, `server/index.js:438` area) 500s on every
  load away from that LAN; sidebar shows red "Failed to load" and the console gets
  error spam. Fine to keep the feature; quiet the retry/log noise and make the panel
  collapse when unconfigured.
- `settings.theme.fontFamily` defaults to "Fira Code" but no webfont is bundled;
  browsers without it silently fall back to generic monospace (metrics differ from
  the Fira Code the theme was tuned on). One-line note, low value to fix.

### Explicitly NOT problems (leave alone)

- Copy-on-select: single clipboard write per drag, toast, wrapped-line fidelity even
  after redraw — verified good.
- Reload/reattach: session persists, no output duplication, terminal auto-restores
  into its cell — verified good.
- Throughput: 100k-line flood completed in <1s wall time with the UI responsive and
  prompt intact afterward (tmux collapses off-screen output; the alt-screen
  architecture is genuinely great here). DOM renderer is sufficient; do not add
  canvas/webgl speculatively.
- Key fidelity spot checks: Home/End, Ctrl+Arrow word-jump, Ctrl+C all correct
  through tmux (`TERM=screen-256color` inside, `xterm-256color` outside).
- PageUp → tmux copy-mode scrollback works (both hardware key and toolbar button).

---

## "Flag, don't silently do" — behavior changes needing sign-off

1. **F2 wheel fix:** wheel-up at the shell will newly enter tmux copy-mode (status
   `[n/m]` indicator appears; output freezes until exit). That's standard tmux-mouse
   behavior but is *new visible behavior* here.
2. **F5:** "Scroll to bottom" stops sending `q`; adds a new WS control message and
   tmux `send-keys -X cancel` server-side.
3. **F6:** all clients of a shared terminal get resized to the pty's authoritative
   size (smaller tab wins → bigger tab letterboxes). Alternative policies exist.
4. **F1:** desktop defaults to keyboard-enabled (input works immediately). Mobile
   default unchanged, toggle state becomes persistent.
5. **F9a/F9b:** rate-limit and backpressure semantics change (close-instead-of-drop;
   pty pause/resume).
6. **F12:** removing the reconnect replay changes what's on screen for the first
   ~100ms after reconnect.
7. **F13:** hiding the mobile toolbar on desktop removes the on-screen key buttons
   some desktop users may use.

---

## Phased remediation plan (for Sonnet execution)

General rules for the executor:

- One phase per PR/commit-series; run the Phase 0 harness after every phase.
- Do not refactor beyond the lines named. Match surrounding style (vanilla ES5-style
  IIFE client code, CommonJS server).
- `npm test` (mocha unit) and `npm run test:integration` must stay green; they need
  tmux installed.
- Anything in the flag list above: implement exactly as specified here (the human has
  approved this document) — if a deviation seems needed, stop and ask.

### Phase 0 — verification harness (build first, no app changes)

Existing tests don't cover the browser at all (jsdom only). Create
`test/e2e/` with a Playwright harness mirroring what this audit used:

1. `npm i -D playwright` (browser binary already provisioned in dev env at
   `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; use
   `process.env.CHROMIUM_PATH || undefined` for `executablePath` so CI can differ).
2. `test/e2e/helpers.js`: boot the app via `createApp(options)` from
   `server/index.js` on port 0 with isolated `tmuxSocket: 'td-e2e'`,
   `sessionPrefix: 'tde2e-'`, temp `instancesPath`; launch Chromium with
   `permissions: ['clipboard-read','clipboard-write']`; helper
   `createTerminal(page)` = click `.cell-add-btn` → click `button:has-text("Create")`
   → wait `.xterm` → **click `#mt-kb-toggle`** (until F1 lands) → click `.xterm`.
   Helper `buffer(page)` reads the active xterm buffer via
   `window.TerminalDeck.app._engine._cellMap` exactly as in this audit.
3. Assertions (each its own mocha test, 30s timeouts):
   - **connect+io:** type `echo rt-$((6*7))`, expect `rt-42` in buffer.
   - **resize settles:** three `page.setViewportSize` calls 30ms apart; after 1s,
     assert tmux `display -p '#{pane_width}x#{pane_height}'` on socket `td-e2e`
     equals xterm cols×rows. (**Expected to FAIL before Phase 1 — encodes F4.**)
   - **reconnect:** `page.reload()`; assert terminal restores and marker text
     appears exactly once.
   - **scrollback:** run 200-line loop, press PageUp, assert copy-mode indicator
     `/\[\d+\/\d+\]/` in visible rows; press `q`.
   - **wheel scrollback:** `page.mouse.wheel(0,-120)`×3 over the terminal, assert
     copy-mode indicator appears. (**Expected to FAIL before Phase 2 — encodes F2.**)
   - **paste round-trip:** clipboard = `echo p1\necho p2\n`; right-click → Paste;
     assert `p1`/`p2` are **not** executed (bracketed paste holds them on the edit
     line). (**Expected to FAIL before Phase 1 — encodes F4/P0-4.**)
   - Mark the expected-fail tests with `it.skip`+`TODO(phase-N)` or invert into
     "documents current bug" assertions — executor's choice, but they must flip to
     enforcing after their phase lands.
4. Add `test:e2e` npm script. Do not wire into `npm test` (needs browser).

### Phase 1 — the three low-risk P0s (F1, F4-resize, F4-paste)

1. **F1:** `app.js:1843` → `var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;`
   `this._keyboardHidden = coarse;` mirror to `ns.TerminalConnection.keyboardHidden`;
   read/write `localStorage['td-kb-hidden']` override in the toggle handler.
   Update the harness to stop clicking `#mt-kb-toggle` on desktop.
2. **F4 resize:** `server/websocket.js` resize case → trailing-edge throttle:
   ```js
   if (terminal.lastResize && now2 - terminal.lastResize < 100) {
     terminal.pendingResize = msg;               // keep latest
     if (!terminal.resizeTimer) terminal.resizeTimer = setTimeout(() => {
       terminal.resizeTimer = null;
       const p = terminal.pendingResize; terminal.pendingResize = null;
       if (p) applyResize(p);                     // same validation path
     }, 100 - (now2 - terminal.lastResize));
     return;
   }
   ```
   (Extract the existing validated-resize body into `applyResize`.) Clear the timer
   in cleanup paths.
3. **F4 paste:** `terminal.js` context-menu Paste action → replace the
   `ws.send({type:'input',…})` with `self._terminal.paste(text)`; in the
   no-clipboard/catch branch, reuse the existing toast helper to show
   "Clipboard unavailable in this browser — press Ctrl+V".
4. Flip the resize + paste harness tests to enforcing.

### Phase 2 — restore wheel scrollback (F2, plus F9a guard)

1. `terminal.js:160`: move listener registration to
   `el.addEventListener('wheel', handler, { capture: true, passive: false })` and add
   `e.stopPropagation()` after the existing `preventDefault()`.
2. Delta scaling + rAF coalescing as specified in F2 (one accumulator per
   connection; flush ≤10 lines/frame).
3. Server (`websocket.js`): change the input rate limiter to a byte budget for
   `type:'input'` (e.g. 16KB per rolling second → on breach, `ws.close(1008)`), keep
   message-count limit for other types.
4. Flip the wheel harness test to enforcing. Manually verify on a trackpad if
   available; tune the per-frame cap only if scroll feel demands it.

### Phase 3 — copy-mode correctness + strip robustness (F5, F10)

1. **F5:** new terminal-WS message `{type:'scroll_to_bottom'}`; server handler runs
   `execFile('tmux', ['-L', socket, 'send-keys', '-t', tmuxName, '-X', 'cancel'])`
   guarded by session existence, errors ignored. Client "Scroll to bottom" sends it
   instead of `'q'` (keep the existing local `scrollToBottom()` calls).
2. **F10:** make the strip stateful: keep `this._stripCarry` (tail of previous chunk
   if it ends inside `\x1b[?...`), prepend to next chunk before the regex; on `…l`
   matches set `_mouseTrackingStripped = false` only when *all* of 1000/1002/1003 are
   off (track per-mode booleans); narrow regex to `\x1b\[\?(?:1000|1002|1003|1006)[hl]`
   (stop touching 1004/1005).
3. Harness additions: less-quit regression test ("Scroll to bottom" inside `less`
   must NOT return to prompt); split-sequence unit test for the strip function
   (pure-function extract it for testability).

### Phase 4 — robustness under load (F9b, F12)

1. **F9b:** in `_setupPtyHandlers`, watch `client.bufferedAmount` after sends; if any
   client >512KB, `pty.pause()`; poll/`drain`-check at 100ms to `resume()`. Never
   skip terminal `output` frames; keep `_safeSend` drop behavior for control-channel
   broadcasts only.
2. **F12:** on new client connect to an existing pty, skip the `outputBuffer` replay
   and instead trigger a redraw: send a benign `tmux refresh-client -t <session>`
   (or reuse the existing resize-bounce). Keep the buffer for the `exited` case.
3. Harness: slow-client simulation is hard in Playwright — cover F9b with a unit
   test on a mocked ws (`bufferedAmount` high → expect `pty.pause` called).

### Phase 5 — multi-client + chrome (F6, F8, F13) — needs open-question answers

1. **F6:** server broadcasts applied size to all clients of the terminal; client
   handles `{type:'resize'}` by calling `term.resize(cols, rows)` and marking the
   cell "mirrored at N×M" in the header tooltip when it differs from fit size.
2. **F8:** palette chord via `attachCustomKeyEventHandler` (default Ctrl+Shift+P
   unless the open question says otherwise).
3. **F13:** hide `#mobile-toolbar` by default when `(pointer: fine)` (CSS class from
   the F1 check); quiet listdeck proxy failure logging to once-per-boot and give the
   sidebar section an unobtrusive "not configured" state.

---

## Top 5 usability problems (summary)

1. **Typing is dead until you click the ⌨ toggle** — on every load, every device,
   because the mobile keyboard-suppression default is applied unconditionally (F1).
2. **Mouse-wheel scrollback simply doesn't work on desktop** — xterm.js swallows the
   wheel before the tmux-forwarding handler can see it, and the alt-screen
   architecture means there is no local scrollback fallback; only PageUp works (F2).
3. **A burst of resizes wedges the terminal at the wrong size** — the server's
   leading-edge 100ms throttle drops the final resize and nothing reconciles;
   the pty and the screen disagree until you hit "Refresh display" (F4-resize).
4. **Right-click Paste executes multi-line clipboard immediately** (no bracketed
   paste) when it works — and **silently does nothing** on the plain-HTTP LAN
   deployment (F4-paste).
5. **"Scroll to bottom" types `q` into your foreground app** — quits `less`, starts
   a vim macro — because "alt screen" is misused as a copy-mode detector (F5).

## Open questions

1. **Wheel → tmux copy-mode (F2):** acceptable that wheel-up at the shell enters
   copy-mode (standard tmux-mouse feel), or would you rather turn tmux `mouse off`
   and let xterm keep a local scrollback? (The latter is a much bigger architecture
   change — alt-screen would still defeat it — so I recommend the former.)
2. **Multi-client size policy (F6):** mirror-at-pty-size (recommended, matches native
   tmux), or last-focused-client-wins with the others letterboxed? Or is two-tabs-on-
   one-terminal rare enough for you that F6 drops to "won't fix"?
3. **Scroll rail (F3):** rewire it to drive tmux copy-mode on touch (only way mobile
   gets drag-scrollback), or delete ~185 lines of dead code? How much do you use
   mobile scrollback via the pgup/pgdn buttons today?
4. **Palette chord (F8):** is Ctrl+Shift+P (or another chord) acceptable, and should
   plain Ctrl+K keep meaning readline kill-line when a terminal is focused?
5. **Deployment origin:** is plain-HTTP-on-LAN the long-term deployment? If yes,
   clipboard *read* will never work in Chrome; the real fix for paste-on-LAN is
   serving over HTTPS (or a PWA/localhost tunnel) — worth deciding before polishing
   clipboard UX further.
6. **Keyboard toggle persistence (F1):** OK to persist the ⌨ state in localStorage
   per device?

## Appendix: security notes (one-liners only, per scope)

- `GET /api/config` returns `serverToken` (the WS auth token) to any unauthenticated
  requester (`server/index.js:188`), which makes the WS token check decorative —
  out of scope here, but worth a look separately.

## Appendix: how this was tested

- Server: `node server/index.js` (local, tmux 3.4, `config/tmux.conf` as
  `~/.tmux.conf`), default config from `config/terminaldeck.json`.
- Client: Playwright + headless Chromium 1440×900 (and an 800×500 second tab for
  F6), clipboard permissions granted; terminals created through the real "+ →
  Create" dialog; input via real key events; wheel via `page.mouse.wheel`;
  clipboard inspected via `navigator.clipboard.readText()` in-page; xterm state read
  from `TerminalDeck.app._engine._cellMap` (buffer type, viewport, cols/rows,
  `_mouseTrackingStripped`); tmux ground truth via `tmux -L terminaldeck display -p`.
- Key evidence: wheel listener instrumentation (xterm 3 events / mount 0 events /
  0 WS messages; synthetic dispatch on mount → 3 SGR messages + tmux scroll);
  side-by-side context-menu vs Ctrl+Shift+V paste of `echo P1\necho P2\n`;
  `less` quitting on "Scroll to bottom"; xterm 74×17 vs tmux 82×20 after a resize
  burst; two-tab 82-col vs 45-col render fight; 100k-line flood timing; triple-click
  wrapped-line copies before/after forced redraw.
