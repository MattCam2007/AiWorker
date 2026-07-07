// Validated TerminalDeck driver (used for the 2026-07-06 usability audit).
// Copy to a scratch dir with `npm i playwright`, then: node drive.js
// Exports helpers for scenario scripts; running directly boots + dumps UI state.
const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = process.env.TD_URL || 'http://localhost:3000/';
const SHOT_DIR = process.env.SHOT_DIR || __dirname + '/shots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

async function boot(opts = {}) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH
      || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
    ...opts.contextOpts,
  });
  const page = await context.newPage();
  if (opts.logConsole) page.on('console', (m) => console.log('[console]', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  // NOTE: 'networkidle' never fires (open WebSockets + failing LAN proxy).
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  return { browser, context, page };
}

// Create a terminal through the real UI. keyboardToggle: click #mt-kb-toggle
// (required before plan 01 landed; on desktop after plan 01, pass false).
async function createTerminal(page, { keyboardToggle = true } = {}) {
  await page.locator('.grid-cell .cell-add-btn').first().click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Create")').click();
  await page.waitForSelector('.xterm', { timeout: 10000 });
  await page.waitForTimeout(2000); // tmux attach + prompt
  if (keyboardToggle) {
    await page.locator('#mt-kb-toggle').click();
    await page.waitForTimeout(200);
  }
  await page.locator('.xterm').first().click();
}

async function run(page, cmd, wait = 600) {
  await page.keyboard.type(cmd, { delay: 5 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(wait);
}

// Read the first terminal's xterm buffer + connection state from inside the page.
async function readBuffer(page, idx = 0) {
  return page.evaluate((i) => {
    const app = window.TerminalDeck && window.TerminalDeck.app;
    const out = [];
    const engine = app && app._engine;
    if (engine && engine._cellMap) {
      for (const [cell, info] of engine._cellMap) {
        if (info && info.connection && info.connection._terminal) {
          const t = info.connection._terminal;
          const buf = t.buffer.active;
          const lines = [];
          for (let y = 0; y < buf.length; y++) {
            const line = buf.getLine(y);
            lines.push(line ? line.translateToString(true) : '');
          }
          out.push({
            id: info.connection.id,
            bufferType: buf.type,          // 'alternate' is normal under tmux
            viewportY: buf.viewportY, baseY: buf.baseY, length: buf.length,
            rows: t.rows, cols: t.cols,
            mouseStripped: info.connection._mouseTrackingStripped,
            text: lines.join('\n'),
          });
        }
      }
    }
    return out[i] || null;
  }, idx);
}

// Visible rows only (what the user sees right now).
function visibleRows(st) {
  return st.text.split('\n').slice(st.viewportY, st.viewportY + st.rows);
}

async function shot(page, name) {
  const p = `${SHOT_DIR}/${name}.png`;
  await page.screenshot({ path: p });
  console.log('shot:', p);
}

// tmux ground truth (adjust socket for isolated test runs).
const { execSync } = require('child_process');
function tmux(cmd, socket = 'terminaldeck') {
  try { return execSync(`tmux -L ${socket} ${cmd} 2>&1`).toString().trim(); }
  catch (e) { return 'ERR: ' + e.message; }
}

module.exports = { boot, createTerminal, run, readBuffer, visibleRows, shot, tmux, SHOT_DIR };

if (require.main === module) {
  (async () => {
    const { browser, page } = await boot({ logConsole: true });
    await createTerminal(page);
    await run(page, 'echo smoke-$((6*7))');
    const st = await readBuffer(page);
    console.log('roundtrip ok:', /smoke-42/.test(st.text),
      '| bufferType:', st.bufferType, '| size:', st.cols + 'x' + st.rows,
      '| mouseStripped:', st.mouseStripped);
    await shot(page, 'smoke');
    await browser.close();
  })();
}
