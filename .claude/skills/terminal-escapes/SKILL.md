---
name: terminal-escapes
description: Domain reference for the escape sequences, tmux behaviors, and xterm.js quirks this codebase manipulates — DECSET mouse modes, SGR mouse encoding, alternate screen, bracketed paste, copy-mode. Load before writing or reviewing any code that parses, filters, or synthesizes terminal byte streams (terminal.js output handling, wheel forwarding, paste paths, strip logic).
---

# Terminal escape sequences as used by TerminalDeck

## DECSET private modes you will encounter (`\x1b[?<n>h` set / `l` reset)

| Mode | Meaning | TerminalDeck relevance |
|------|---------|------------------------|
| 1000 | mouse click tracking | tmux (`mouse on`) sends on attach; client strips it |
| 1002 | + drag tracking | same |
| 1003 | + all-motion tracking | same |
| 1004 | **focus in/out reporting** | NOT mouse tracking — must pass through to xterm (audit F10: current regex wrongly eats it) |
| 1005 | UTF-8 mouse coords (legacy) | leave alone |
| 1006 | SGR mouse encoding | stripped together with 1000-1003 |
| 1015 | urxvt mouse encoding | not used here |
| 1049 | alternate screen + cursor save | tmux holds the OUTER terminal on alt screen for its whole lifetime — this is why xterm's local scrollback is always empty |
| 2004 | bracketed paste | bash 5 / readline enables it; xterm's `term.paste()` honors it; raw `ws.send` of pasted text bypasses it (audit F4b) |

**Chunk-boundary rule:** pty output arrives in arbitrary chunks; `\x1b[?1000h`
can be split anywhere (even mid-`\x1b`). Any filter must carry a bounded tail
(chars matching `/\x1b(\[(\?[\d;]*)?)?$/`, ≤12 bytes) into the next chunk.
Literal text like `[?100` with no ESC must never be altered.

## SGR mouse reports (what the client synthesizes for wheel forwarding)

```
\x1b[<{btn};{col};{row}M     press / wheel event   (col,row are 1-based)
\x1b[<{btn};{col};{row}m     release (not needed for wheel)
btn 64 = wheel up, 65 = wheel down
```
tmux with `mouse on` consumes these; wheel-up over a live pane enters
copy-mode and scrolls. No release event is required for buttons 64/65.

## tmux behaviors that shape the UX

- Copy-mode indicator: `[position/history]` drawn top-right of the pane —
  detect with `/\[\d+\/\d+\]/` on visible rows; ground truth `#{pane_in_mode}`.
- Exit copy-mode programmatically: `tmux send-keys -t <sess> -X cancel`
  (no-op error when not in a mode — safe; this replaces the literal-`q` hack,
  audit F5). Literal `q` only means "exit" *inside* copy-mode; elsewhere it's
  input (quits `less`, arms a vim macro).
- Inner app on its own alt screen without mouse support (e.g. `less` with tmux
  `mouse on`): tmux converts wheel into arrow keys itself. If the browser ALSO
  synthesizes extra events, scroll speed multiplies (audit F2 secondary).
- Full repaint on demand: `tmux refresh-client -t <sess>` (preferred over
  replaying captured output; replay slices can start mid-sequence, audit F12).
- `history-limit` (10000 here) is the ONLY scrollback; per-pane, set at pane
  creation.

## Device Attributes (DA)

tmux queries `\x1b[c` / `\x1b[>c` on attach; the terminal answers
`\x1b[?...c` / `\x1b[>...c`. The client currently filters ALL such answers
(`terminal.js` — workaround for a mobile-reconnect echo bug); consequence:
tmux feature detection times out. Match pattern: `/^\x1b\[[\?>][\d;]*c$/`.

## xterm.js 5.3.0 (vendored — do not upgrade casually)

- Stops propagation of wheel events at `.xterm`; ancestor bubble listeners
  never fire. Winning requires `{ capture: true }`. There is **no**
  `attachCustomWheelEventHandler` in 5.3.0.
- `attachCustomKeyEventHandler(fn)` exists — return `false` to swallow a key
  before xterm encodes it (used for the Ctrl+Shift+P palette chord, plan 07).
- `term.paste(text)` applies bracketed paste when mode 2004 is active and
  normalizes `\n`→`\r`. Always prefer it over sending clipboard text raw.
- Wheel in alternate-screen buffers: xterm applies "alternate scroll"
  (arrow-key synthesis) itself when it handles the event — one more reason the
  forwarding path must fully consume events it forwards
  (`preventDefault` + `stopPropagation`), and ONLY those.
- `buffer.active.type` is `'normal' | 'alternate'`; under tmux the outer
  buffer is always `'alternate'` — never use it as a copy-mode detector
  (that's exactly the F5 bug).
- Selection: `getSelection()` respects wrapped-line joins (`isWrapped`); a
  screen-region selection copies whatever tmux painted, including copy-mode
  indicators if visible.
- deltaMode on wheel events: 0 = pixels (trackpads, many small events),
  1 = lines. Fixed lines-per-event constants are always wrong for one of the
  two device classes; scale by delta (plan 02).
