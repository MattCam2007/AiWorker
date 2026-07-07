---
name: drive-terminaldeck
description: Boot TerminalDeck locally and drive it in headless Chromium with Playwright — create terminals through the real UI, send keys/wheel/clicks, read the xterm buffer, query tmux ground truth, take screenshots. Use whenever a task requires observing or verifying real terminal behavior (bug repro, fix verification, e2e work).
---

# Driving TerminalDeck for real

Working, previously-validated driver code is in `scripts/drive.js` next to this
file — copy it to your scratchpad and adapt; don't rewrite from scratch.
Assertion snippets for common checks are in `references/recipes.md`.

## Boot sequence

```bash
cp config/tmux.conf ~/.tmux.conf          # prod parity: mouse on, 10k history
npm install                                # if node_modules missing (node-pty builds)
node server/index.js > /tmp/td-server.log 2>&1 &   # port 3000
curl -s http://localhost:3000/api/config | head -c 100   # sanity: JSON appears
```

For isolated runs (tests, parallel work) use `createApp(options)` from
`server/index.js` with `{ port: 0, tmuxSocket: 'td-e2e', sessionPrefix: 'tde2e-',
instancesPath: '<tmpfile>' }` instead of `npm start`.

Playwright: `npm i playwright` in your scratchpad (2s, no browser download —
Chromium already exists). Launch with
`executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`
and context `{ viewport:{width:1440,height:900}, permissions:['clipboard-read','clipboard-write'] }`.

## Non-obvious facts that WILL waste your time if unknown

1. `page.goto(..., { waitUntil: 'networkidle' })` **never resolves** — open
   WebSockets plus a known-failing LAN proxy (500s on `/api/.../daily/...` are
   expected noise, not your bug). Use `'domcontentloaded'` + `waitForTimeout(2500)`.
2. **Typing may be dead until you click `#mt-kb-toggle`** (audit finding F1:
   `keyboardHidden` defaults true). If plan 01 has landed, desktop no longer
   needs this. When "typing does nothing", check
   `window.TerminalDeck.TerminalConnection.keyboardHidden` before debugging
   anything else.
3. The outer terminal is **always on tmux's alternate screen**: xterm's buffer
   length == rows, scrollback empty, `scrollHeight == clientHeight`. Normal.
4. Create terminals through the real UI: click `.grid-cell .cell-add-btn` →
   click `button:has-text("Create")` → wait for `.xterm` → **wait ~2s** for
   tmux attach + prompt.
5. tmux ground truth beats screen-scraping:
   ```bash
   tmux -L terminaldeck list-sessions -F '#{session_name} #{session_attached}'
   tmux -L terminaldeck display -p -t <session> '#{pane_width}x#{pane_height} #{pane_in_mode} #{alternate_on}'
   ```
   Copy-mode shows on screen as a `[n/m]` indicator top-right — regex `/\[\d+\/\d+\]/`.
6. Read terminal content from the xterm buffer, not the DOM: see `readBuffer`
   in `scripts/drive.js` (walks `TerminalDeck.app._engine._cellMap` →
   `connection._terminal.buffer.active`, `translateToString(true)` per line).
   Also available per connection: `_mouseTrackingStripped`, `_ws.readyState`.
7. To prove "did event X reach Y", instrument instead of guessing: wrap
   `conn._ws.send` to count messages containing `'[<'` (SGR mouse), or add
   counting listeners at multiple DOM levels. Label synthetic `dispatchEvent`
   results as synthetic — xterm stops propagation of real wheel events at
   `.xterm`, so synthetic dispatch on ancestors behaves differently from real
   input.

## Cleanup (always)

```bash
pkill -f "node server/index.js"; tmux -L terminaldeck kill-server 2>/dev/null
git checkout -- config/instances.json   # session creation dirties it
git status --short                       # must be clean of your run
```
