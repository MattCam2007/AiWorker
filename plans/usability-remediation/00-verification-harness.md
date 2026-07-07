# Plan 00 — Verification Harness (Playwright e2e)

**Goal:** a repeatable browser-level test suite that encodes the audit's confirmed
bugs as tests, so every later fix has a red→green signal and regressions get caught.
No application code changes in this plan.

**Audit refs:** all findings; methodology in the audit's final appendix.

## Deliverables

1. `npm i -D playwright` (add to `devDependencies`; do NOT run `playwright install`
   in dev env — Chromium exists at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).
2. `test/e2e/helpers.js` exporting:
   - `startApp()` — call `createApp()` from `server/index.js` with
     `{ port: 0, tmuxSocket: 'td-e2e', sessionPrefix: 'tde2e-', instancesPath: <tmpfile> }`;
     return `{ url, close }`. Clean up: kill the tmux server on socket `td-e2e`
     in `after()` (`tmux -L td-e2e kill-server`).
   - `launchBrowser()` — chromium with
     `executablePath: process.env.CHROMIUM_PATH || undefined`,
     context options `{ viewport: {width:1440,height:900}, permissions: ['clipboard-read','clipboard-write'] }`.
   - `createTerminal(page)` — click `.grid-cell .cell-add-btn` → click
     `button:has-text("Create")` → wait for `.xterm` → wait 2s →
     click `#mt-kb-toggle` → click `.xterm`.
     *(After plan 01 lands, drop the `#mt-kb-toggle` click on desktop viewports —
     that flip is part of plan 01.)*
   - `readBuffer(page)` — evaluate in-page: walk
     `window.TerminalDeck.app._engine._cellMap` to the first connection, return
     `{ text, bufferType, viewportY, baseY, length, rows, cols }` from
     `connection._terminal.buffer.active` (translateToString(true) per line).
   - `tmuxQuery(fmt, session?)` — shell out to `tmux -L td-e2e display -p ...` /
     `list-sessions`.
3. `test/e2e/usability.e2e.js` (mocha, 30s timeouts) with these tests:

| Test | Assertion | Status at creation |
|------|-----------|--------------------|
| connect + IO round-trip | type `echo rt-$((6*7))` → buffer contains `rt-42` | must pass |
| resize settles | 3× `page.setViewportSize` 30ms apart; after 1.5s, tmux `#{pane_width}x#{pane_height}` == xterm cols×rows | **expected-fail (F4a)** — enforce in plan 01 |
| reconnect | `page.reload()`; terminal restores; a pre-reload marker string appears exactly once in the buffer | must pass |
| keyboard scrollback | 200-line loop, press PageUp, visible rows match `/\[\d+\/\d+\]/` (copy-mode indicator), press `q` | must pass |
| wheel scrollback | `page.mouse.wheel(0,-120)` ×3 over the terminal → copy-mode indicator appears | **expected-fail (F2)** — enforce in plan 02 |
| paste round-trip | clipboard `echo p1\necho p2\n`; right-click → Paste; assert `p1` **not executed** (no output line `p1`, text held on edit line) | **expected-fail (F4b)** — enforce in plan 01 |

   Encode expected-fails as *inverted* assertions with a loud comment
   (`// DOCUMENTS BUG F2 — plan 02 must flip this to the positive assertion`),
   not `it.skip`, so they break visibly if behavior changes unexpectedly.
4. `package.json`: add `"test:e2e": "mocha test/e2e/**/*.e2e.js --timeout 60000 --exit"`.
   Do NOT add e2e to `npm test` (needs a browser).

## Implementation notes

- The create dialog and selectors above were verified live in the audit — reuse
  them verbatim. If a selector misses, screenshot and adapt; don't restructure.
- Serialize tests (mocha default) — they share one server+browser per file via
  `before/after`.
- `createApp` already supports the isolation options (see `server/index.js:143-151`).

## Acceptance criteria

- `npm run test:e2e` green locally (with the three documented-bug assertions in
  their inverted form).
- `npm test` and `npm run test:integration` untouched and green.
- No changes under `client/` or `server/` except `package.json` devDeps/scripts.

## Risks / rollback

Zero product risk (test-only). If `node-pty`/browser flakiness appears, add one
retry at the mocha level (`this.retries(1)`) rather than sleeps.
