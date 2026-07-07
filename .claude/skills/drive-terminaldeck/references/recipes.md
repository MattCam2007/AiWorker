# Assertion recipes (all validated live in the 2026-07-06 audit)

Assumes `const d = require('./drive')` and a booted page with a terminal.

## Copy-mode / scrollback

```js
// In copy-mode? tmux draws [n/m] top-right of the pane:
const st = await d.readBuffer(page);
const inCopyMode = d.visibleRows(st).some(l => /\[\d+\/\d+\]/.test(l));
// Ground truth: d.tmux(`display -p -t ${sess} '#{pane_in_mode}'`) === '1'
// Enter via keyboard: page.keyboard.press('PageUp')  (tmux.conf binds it)
// Exit: page.keyboard.press('q')
```

## Wheel over the terminal

```js
const box = await page.locator('.xterm').first().boundingBox();
await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(80); }
// Count what actually got sent (SGR mouse = ESC-encoded as [< in the JSON frame):
await page.evaluate(() => {
  const e = window.TerminalDeck.app._engine; window.__sgr = 0;
  for (const [c, i] of e._cellMap) if (i && i.connection && i.connection._ws) {
    const ws = i.connection._ws, orig = ws.send.bind(ws);
    ws.send = (m) => { if (m.indexOf('[<') !== -1) window.__sgr++; return orig(m); };
  }
});
```

## Clipboard round-trips (secure context / granted permissions only)

```js
await page.evaluate(() => navigator.clipboard.writeText('echo p1\necho p2\n'));
// right-click menu:
await page.mouse.click(cx, cy, { button: 'right' });
await page.locator('.ep-ctx-item', { hasText: 'Paste' }).click();
// safe paste == commands NOT executed until Enter (no `p1` output line yet)
const clip = await page.evaluate(() => navigator.clipboard.readText());
```

## Drag-select at cell precision

```js
// Pixel geometry from xterm internals (cell width/height + screen origin):
const geo = await page.evaluate(() => {
  const e = window.TerminalDeck.app._engine; let conn;
  for (const [c, i] of e._cellMap) if (i && i.connection) conn = i.connection;
  const t = conn._terminal;
  const dims = t._core._renderService.dimensions.css.cell;
  const r = conn._element.querySelector('.xterm-screen').getBoundingClientRect();
  return { left: r.left, top: r.top, cw: dims.width, chh: dims.height };
});
// row/col → pixels: x = geo.left + col*geo.cw ; y = geo.top + (row+0.5)*geo.chh
// triple-click selects a (wrapped) line: page.mouse.click(x, y, { clickCount: 3 })
```

## Resize ground truth

```js
await page.setViewportSize({ width: 1100, height: 700 });
await page.waitForTimeout(1500);
const st = await d.readBuffer(page);
const pane = d.tmux(`display -p -t ${sess} '#{pane_width}x#{pane_height}'`);
// healthy: pane === `${st.cols}x${st.rows}`  (mismatch == audit finding F4a)
```

## Two clients on one terminal

```js
const page2 = await context.newPage();
await page2.setViewportSize({ width: 800, height: 500 });
await page2.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page2.waitForTimeout(4000);   // auto-restores the existing terminal
// compare readBuffer(page).cols vs readBuffer(page2).cols vs tmux pane size
```

## Flood / integrity

```js
await d.run(page, 'seq 1 100000; echo DONE-$((6*7))', 0);
// poll readBuffer until /DONE-42/; then type `echo after-ok` and assert it echoes
// server-side drops would show in the server log: grep "skipping send" /tmp/td-server.log
```
