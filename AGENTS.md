# TerminalDeck — Agent Guide

Web-based persistent terminal dashboard: xterm.js in the browser ⇄ WebSocket ⇄
node-pty ⇄ `tmux attach`. Sessions live in tmux and survive disconnects.
**No build step, no framework**: client is vanilla ES5-style IIFEs served
statically; server is Node 20 CommonJS.

## Commands

```bash
npm start                 # server on :3000 (needs tmux + bash locally)
npm test                  # unit tests (mocha; server/*.test.js + client/*.test.js)
npm run test:integration  # full stack (needs tmux; 30s timeouts)
npm run test:all          # both
npx mocha server/websocket.test.js --exit          # single file
npm run test:e2e          # Playwright e2e (exists once plans/usability-remediation/00 lands)
```

Prod parity when testing by hand: `cp config/tmux.conf ~/.tmux.conf` first —
it sets `mouse on`, `history-limit 10000`, `remain-on-exit`, status off.
The app's tmux runs on a dedicated socket: always `tmux -L terminaldeck …`
(tests use `-L td-e2e`). Kill test servers with `tmux -L <socket> kill-server`.

## Map

| Area | Files |
|---|---|
| HTTP + API + static | `server/index.js` (`createApp(options)` supports port 0 + isolated tmux socket for tests) |
| WS bridge, pty lifecycle, rate limits | `server/websocket.js` |
| tmux session mgmt | `server/sessions.js` (socket `terminaldeck`, prefix `terminaldeck-`) |
| xterm + WS client, copy/paste, wheel, context menu | `client/js/terminal.js` |
| App orchestration, mobile toolbar, keyboard toggle | `client/js/app.js` |
| Grid/layout/supersize | `client/js/layout.js` |
| Vendored xterm.js **5.3.0** (UMD) | `client/vendor/xterm.js` — do not upgrade or edit vendor files |

Active work program: `plans/usability-audit-2026-07-06.md` (findings F1–F13,
evidence, decisions D1–D6) and `plans/usability-remediation/` (numbered,
PR-sized plans with acceptance criteria). If you are implementing a fix, a
plan for it almost certainly exists — follow it, don't improvise.

## Architecture truths (get these wrong and your fix will be wrong)

1. **The outer terminal always sits on tmux's alternate screen.** xterm.js's
   local scrollback is permanently empty (`buffer.active.type === 'alternate'`,
   buffer length == rows). ALL scrollback is tmux copy-mode. Any feature that
   scrolls the xterm viewport is a no-op by construction.
2. **xterm.js consumes wheel and most key events before document/parent
   listeners.** Listeners meant to win must use capture phase (vendored 5.3.0
   has no `attachCustomWheelEventHandler`; it DOES have
   `attachCustomKeyEventHandler`).
3. **Mouse-tracking escapes are stripped client-side** (`terminal.js`
   `_mouseTrackingStripped`) so drag-select keeps working; wheel is (meant to
   be) forwarded manually as SGR sequences (`\x1b[<64;col;rowM` up / 65 down).
   Pty output arrives in arbitrary chunks — any escape-sequence parsing must
   survive sequences split across WebSocket frames.
4. **One pty per terminal id, shared by all connected clients.** Size is
   last-writer-wins; server echoes are the reconciliation mechanism (plan 05).
5. **Server drops things silently today** (input >100 msg/s, output when socket
   buffer >256KB, resizes <100ms apart). Plans 01/04 change these — never add
   new silent drops.
6. **The mobile toolbar owns input policy**: `TerminalConnection.keyboardHidden`
   blurs the xterm textarea when true. The `compositionend` textarea-clearing
   hack in `terminal.js` works around a real Android/Gboard duplication bug
   (xterm CompositionHelper `after.replace(before,'')` re-sends everything on
   autocorrect — see `docs/mobile-input-duplication-bug.md`). Do not remove it.

## Verified-good — do NOT "fix" these

Copy-on-select (one clipboard write per drag, wrapped-line fidelity survives
redraws) · reload/reattach (no duplication) · 100k-line flood throughput (tmux
collapses off-screen output; DOM renderer is fine, don't add canvas/webgl) ·
Home/End/Ctrl+Arrow key fidelity · PageUp → tmux copy-mode.

## Project agents & skills (use them — they encode validated knowledge)

- Skills (`.claude/skills/`): **drive-terminaldeck** (boot + Playwright-drive
  the real app; includes working driver code and assertion recipes),
  **terminal-escapes** (DECSET/SGR/tmux/xterm 5.3.0 domain reference — load
  before touching byte-stream code), **execute-plan** (the plan-implementation
  workflow with gates; `/execute-plan NN`).
- Subagents (`.claude/agents/`): **plan-executor** (implements one remediation
  plan end to end), **usability-verifier** (evidence-based behavior
  verification, never edits app code), **terminal-code-reviewer** (reviews
  diffs against this repo's known failure modes before commit).
- Recommended loop for each plan: plan-executor (or `/execute-plan NN`) →
  terminal-code-reviewer on the diff → usability-verifier for the live
  before/after → commit.

## Working rules

- **Evidence over inference.** UI/terminal claims must be observed in the real
  app (use the `drive-terminaldeck` skill), not deduced from reading code.
  Verify tmux-side ground truth with `tmux -L <socket> display -p '#{...}'`.
- **Scope discipline.** Change only the files/functions the active plan names.
  Match surrounding style (ES5 IIFE client / CommonJS server, sparse comments).
  No drive-by refactors, no dependency additions unless the plan says so.
- **Gates before done:** `npm test` + `npm run test:integration` + `npm run
  test:e2e` green. Expected-fail e2e tests flip to enforcing in the plan that
  fixes them — flipping is part of that plan's definition of done.
- **Deviation = stop and ask.** Decisions D1–D6 in
  `plans/usability-remediation/README.md` are settled; don't re-litigate.
- Deployment target is HTTPS over Tailscale; treat `navigator.clipboard`
  absence (plain-HTTP LAN) as a degraded mode needing visible feedback, not a
  case to engineer around.
- Escape-sequence sanity: prefer pure, unit-testable functions for anything
  that parses/filters pty bytes (see the `terminal-escapes` skill for the
  domain reference).
