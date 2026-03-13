# Mobile Terminal Scroll & CLI Research

## TL;DR

**No viable xterm.js replacement exists** for full PTY-backed web terminals. The best path forward is layering scroll/touch improvements on top of xterm.js. xterm.js has had open mobile issues since 2017 with no official fix.

---

## 1. Alternative Terminal Libraries Evaluated

| Library | Mobile-Ready | Full VT100/PTY | Verdict |
|---------|-------------|----------------|---------|
| **xterm.js** (current) | Poor | Yes | Keep -- only real option for raw PTY |
| **jQuery Terminal** | Good | No (command interpreter) | Can't pipe tmux/PTY output |
| **vanilla-terminal** | Claims support | No | Too basic, no ANSI |
| **terminal.js** | Reported OK | No | Minimal, abandoned |
| **ttyd** | Uses xterm.js | Yes (wraps xterm.js) | Same scroll problems |
| **Ink/blessed/terminal-kit** | N/A | Server-side only | Not browser-based |

**Bottom line**: Nothing replaces xterm.js for what TerminalDeck does. jQuery Terminal has the best mobile story but is a command interpreter, not a terminal emulator.

---

## 2. Scroll Alternatives (Ranked by Recommended Priority)

### A. Scroll Overlay Buttons (DO FIRST -- Low Effort, Medium Impact)
- Floating up/down arrow buttons on terminal edges
- Send Page Up/Down or scroll commands to tmux
- Always visible, no gesture conflicts
- ttyd and web SSH clients use this pattern

### B. Swipe-to-Arrow-Key Translation (DO SECOND -- Medium Effort, High Impact)
- Convert vertical touch swipes into ANSI arrow/Page Up/Down sequences
- Works great for alternate screen apps (less, vim, tmux scroll mode)
- User in xterm.js Issue #1007 implemented this successfully
- Need to detect buffer mode: normal buffer = viewport scroll, alternate buffer = send keys

### C. Scroll Mode Toggle (Medium Effort, High Impact)
- Inspired by Termius "Gesture Mode" button
- Toggle between "interact mode" (touch = terminal input) and "scroll mode" (touch = scroll)
- Could be a button on existing mobile toolbar
- Cleanly separates scroll intent from terminal interaction

### D. Dedicated Scroll Strip/Gesture Zone (Medium Effort, Medium Impact)
- Reserve left or right 15% of terminal as a scroll strip
- Swiping in that zone scrolls; elsewhere interacts with terminal
- No extra UI elements needed
- Downside: reduces usable terminal width, hard to discover

### E. Two-Finger Scroll (Medium Effort, Medium Impact)
- One finger = terminal interaction, two fingers = scroll
- Familiar from maps/browsers
- Unreliable: browser may intercept for page scroll or pinch-to-zoom
- Experimental -- worth trying but don't rely on it

### F. Momentum/Inertia Scrolling (High Effort, Medium Impact)
- Custom touchmove handler with velocity tracking and animation after finger lift
- Feels native but hard to implement: xterm.js viewport sits underneath row divs (Issue #594)
- Would need to bypass xterm.js rendering model

---

## 3. Mobile App UX Inspiration

### Termux (Android)
- Single-finger swipe scrolls scrollback buffer
- Extra keyboard row: Tab, Ctrl, Alt, Esc, arrows
- **Problem**: Mouse tracking mode (tmux) captures scroll as mouse buttons, blocking scrollback
- **Lesson**: Need scroll/mouse mode toggle

### Blink Shell (iOS)
- Two-finger tap = new shell; swipe LR = switch shells; pinch = resize
- Relies on tmux for scrollback
- Context bar via double-tap home bar
- **Lesson**: Gesture-based shell switching is elegant

### Termius (iOS/Android)
- **Best mobile terminal UX discovered**
- Press-and-hold then drag = arrow keys
- Hold Space + drag = arrow keys
- "Gesture Mode" button toggles scroll behavior
- Extended keyboard panel with special keys, signals, history, snippets
- **Lesson**: Gesture-to-arrow-key + mode toggle is the gold standard

### a-Shell (iOS)
- Even native apps struggle with scroll vs. history disambiguation
- Local Unix terminal, not SSH-focused

---

## 4. xterm.js Mobile Status

### Key Open Issues (All Unresolved)
- **#5377** (2025): "Limited touch support" -- NO dedicated touch event handling in CoreBrowserTerminal.ts
- **#1101**: "Support mobile platforms" -- long-standing meta-issue
- **#594** (2017): "Support ballistic scrolling via touch" -- viewport under row divs makes it hard
- **#1007**: "Touch scrolling should send arrow keys" -- user-implemented workaround exists
- **#2403**: "Accommodate predictive keyboard" -- Android GBoard composition corruption
- **#3727**: "Copy/paste on touch devices" -- broken
- **#3600**: "Erratic text on Android Chrome" -- ongoing

### No Official Mobile Addon
Official addons: fit, web-links, search, serialize, image, unicode11, webgl, clipboard. **None address touch/mobile.**

### Known Workarounds
1. Password input field (`<input type="password">`) bypasses predictive text
2. Custom touchmove handler translating swipes to arrow sequences
3. Overlay UI: scroll buttons + extra keyboard row on top of xterm.js

---

## 5. Recommended Implementation Plan

### Phase 1: Quick Wins
1. **Add scroll buttons to mobile toolbar** -- Up/Down arrows that send tmux scroll commands
2. **Add "Scroll Mode" toggle** -- button on toolbar that switches touch behavior
3. When scroll mode active: touch drag = scroll viewport; when inactive: touch = terminal input

### Phase 2: Gesture Enhancement
4. **Swipe-to-key translation** -- vertical swipe on terminal sends Page Up/Down in alternate screen mode
5. **Two-finger scroll experiment** -- detect touch count, route accordingly
6. **Hold-and-drag for arrow keys** -- Termius-style press-hold-drag gesture

### Phase 3: Polish
7. **Momentum scrolling** -- velocity-based animation for smooth feel
8. **Auto-detect buffer mode** -- switch between viewport scroll and key sending based on whether terminal is in alternate screen

---

## Sources
- [xterm.js #5377 - Limited touch support](https://github.com/xtermjs/xterm.js/issues/5377)
- [xterm.js #594 - Ballistic scrolling](https://github.com/xtermjs/xterm.js/issues/594)
- [xterm.js #1007 - Touch scroll → arrow keys](https://github.com/xtermjs/xterm.js/issues/1007)
- [xterm.js #1101 - Mobile support](https://github.com/xtermjs/xterm.js/issues/1101)
- [jQuery Terminal Mobile Wiki](https://github.com/jcubic/jquery.terminal/wiki/Mobile-Web-Terminal-and-Responsive-Text)
- [Termius Extended Keyboard Docs](https://github.com/smanask/Termius-Documentation/blob/master/ios/features/extended_keyboard.md)
- [Termux #4302 - Mouse tracking blocks scroll](https://github.com/termux/termux-app/issues/4302)
- [Blink Shell Docs](https://docs.blink.sh/)
