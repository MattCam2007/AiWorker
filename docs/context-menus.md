# Context-Aware Footer Menus

The mobile toolbar's "Slash" panel adapts based on the foreground process running
in the active terminal. This document defines all context menus. Edit freely.

---

## How It Works

1. Server polls tmux every 2s: `tmux list-panes -a -F '#{session_name} #{pane_current_command}'`
2. Server broadcasts changes: `{ type: 'pane_context', contexts: { termId: 'bash', ... } }`
3. Client maps process names to context categories (see mapping below)
4. Client rebuilds the slash panel with the matching menu
5. The "Slash" tab label updates to show the context name

---

## Process-to-Context Mapping

| Process Name(s)                        | Context    | Tab Label |
|----------------------------------------|------------|-----------|
| `bash`, `zsh`, `sh`, `fish`, `dash`   | `shell`    | Shell     |
| `ssh`                                  | `shell`    | Shell     |
| `claude`                               | `claude`   | Claude    |
| `vim`, `nvim`, `vi`                   | `vim`      | Vim       |
| `nano`                                 | `nano`     | Nano      |
| `emacs`                                | `emacs`    | Emacs     |
| `less`, `more`, `man`                 | `pager`    | Pager     |
| `python`, `python3`, `ipython`        | `python`   | Python    |
| `node`                                 | `node`     | Node      |
| `htop`, `top`, `btop`                 | `monitor`  | Monitor   |
| *(anything else)*                      | `generic`  | Cmds      |

---

## Menu Definitions

Each menu has 2 always-visible rows (8 buttons) and up to 2 expanded rows
(shown when toolbar is swiped up). 4-column grid, same as current layout.

Button types:
- **submit**: types text + presses Enter (like current `data-prompt`)
- **slash**: types text + presses Enter, displayed with `/` prefix (like current `data-slash`)
- **raw**: types text with NO Enter (for vim keys, pager navigation, partial input)
- **ctrl**: sends a ctrl sequence (Ctrl+C = `\x03`, etc.)

---

### shell — Bash / Zsh / Fish / SSH

| Row | Col 1        | Col 2       | Col 3       | Col 4        |
|-----|-------------|-------------|-------------|--------------|
| 1   | git status *(submit)* | git diff *(submit)* | git log --oneline -10 *(submit)* | ls -la *(submit)* |
| 2   | cd .. *(submit)* | clear *(submit)* | pwd *(submit)* | exit *(submit)* |
| 3   | git add -A *(submit)* | git commit *(submit)* | git push *(submit)* | git pull *(submit)* |
| 4   | docker ps *(submit)* | npm run *(raw)* | make *(raw)* | grep -r "" . *(raw)* |

---

### claude — Claude Code

| Row | Col 1        | Col 2       | Col 3       | Col 4        |
|-----|-------------|-------------|-------------|--------------|
| 1   | /clear *(slash)* | /compact *(slash)* | /status *(slash)* | /help *(slash)* |
| 2   | /commit *(slash)* | /review *(slash)* | /fast *(slash)* | /exit *(slash)* |
| 3   | commit & push *(submit)* | run tests *(submit)* | git status *(submit)* | git log *(submit)* |
| 4   | explain error *(submit)* | fix bug *(submit)* | summarize *(submit)* | undo *(submit)* |

---

### vim — Vim / Neovim

| Row | Col 1    | Col 2   | Col 3   | Col 4    |
|-----|---------|---------|---------|----------|
| 1   | :w *(submit)* | :q *(submit)* | :wq *(submit)* | :q! *(submit)* |
| 2   | i *(raw)* | v *(raw)* | / *(raw)* | u *(raw)* |
| 3   | :wqa *(submit)* | dd *(raw)* | yy *(raw)* | p *(raw)* |
| 4   | gg *(raw)* | G *(raw)* | :s/ *(raw)* | :%s/ *(raw)* |

---

### pager — less / more / man

| Row | Col 1   | Col 2   | Col 3     | Col 4   |
|-----|--------|---------|-----------|---------|
| 1   | q *(raw)* | / *(raw)* | n *(raw)* | N *(raw)* |
| 2   | g *(raw)* | G *(raw)* | space *(raw)* | b *(raw)* |
| 3   | h *(raw)* | d *(raw)* | u *(raw)* | F *(raw)* |

---

### python — Python REPL

| Row | Col 1       | Col 2      | Col 3      | Col 4      |
|-----|------------|------------|------------|------------|
| 1   | exit() *(submit)* | help() *(submit)* | import  *(raw)* | dir() *(submit)* |
| 2   | print() *(raw)* | type() *(raw)* | len() *(raw)* | list() *(raw)* |
| 3   | try: *(submit)* | for i in  *(raw)* | def  *(raw)* | class  *(raw)* |

---

### node — Node.js REPL

| Row | Col 1          | Col 2          | Col 3          | Col 4              |
|-----|---------------|---------------|---------------|-------------------|
| 1   | .exit *(submit)* | .help *(submit)* | .break *(submit)* | .clear *(submit)* |
| 2   | require() *(raw)* | console.log() *(raw)* | typeof  *(raw)* | JSON.stringify() *(raw)* |
| 3   | process.exit() *(submit)* | async  *(raw)* | const  *(raw)* | function  *(raw)* |

---

### nano — Nano Editor

| Row | Col 1         | Col 2         | Col 3         | Col 4         |
|-----|--------------|--------------|--------------|--------------|
| 1   | Ctrl+O save *(ctrl:\x0f)* | Ctrl+X exit *(ctrl:\x18)* | Ctrl+W find *(ctrl:\x17)* | Ctrl+K cut *(ctrl:\x0b)* |
| 2   | Ctrl+U paste *(ctrl:\x15)* | Ctrl+G help *(ctrl:\x07)* | Ctrl+C pos *(ctrl:\x03)* | Ctrl+_ goto *(ctrl:\x1f)* |

---

### monitor — htop / top / btop

| Row | Col 1   | Col 2   | Col 3     | Col 4   |
|-----|--------|---------|-----------|---------|
| 1   | q *(raw)* | / *(raw)* | k *(raw)* | F5 *(raw)* |
| 2   | F6 *(raw)* | F9 *(raw)* | space *(raw)* | u *(raw)* |

---

### generic — Unknown / Fallback

| Row | Col 1       | Col 2       | Col 3       | Col 4    |
|-----|------------|------------|------------|----------|
| 1   | Ctrl+C *(ctrl:\x03)* | Ctrl+D *(ctrl:\x04)* | Ctrl+Z *(ctrl:\x1a)* | q *(raw)* |
| 2   | exit *(submit)* | quit *(submit)* | help *(submit)* | :q *(submit)* |

---

## Implementation Notes

### Button display text vs sent text

The table columns show `display text *(type)*` or `display text *(type:value)*`.

- **submit**: Display and sent text are the same. Appends `\r` (Enter).
- **slash**: Displayed with `/` prefix via CSS. Sends the full `/command\r`.
- **raw**: Sends text exactly as-is. No Enter appended. For partial input, trailing space is preserved.
- **ctrl**: Sends the hex escape. Display shows a friendly label.

### Adding a new context

1. Add process name(s) to the mapping table above
2. Define the menu rows below
3. The code reads this structure from a JS config object — no HTML to edit

### Customizing buttons

Each button in the JS config looks like:

```js
{ label: 'git status', text: 'git status', type: 'submit' }
{ label: 'clear',      text: '/clear',     type: 'slash' }
{ label: 'dd',         text: 'dd',         type: 'raw' }
{ label: 'Ctrl+C',     text: '\x03',       type: 'ctrl' }
```

The `label` is what shows on the button. The `text` is what gets sent to the terminal.
Modify the `CONTEXT_MENUS` object in `client/js/app.js` to change any of these.

### Files involved

| File | Role |
|------|------|
| `server/foreground.js` | New — polls tmux, tracks changes, broadcasts |
| `server/sessions.js` | Add `getForegroundCommands()` method |
| `server/websocket.js` | Wire up ForegroundTracker |
| `client/js/app.js` | Context handling, dynamic panel rebuild, CONTEXT_MAP + CONTEXT_MENUS config |
| `client/index.html` | Remove static slash buttons, keep empty grid container |
| `docs/context-menus.md` | This file — menu reference |
