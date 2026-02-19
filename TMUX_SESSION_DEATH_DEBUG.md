# Tmux Session Death — Debug Log

## The Problem

Terminal sessions die unexpectedly when running long-lived processes (specifically Claude Code CLI). The user sees `[exited]` in the terminal after ~5-10 minutes of use. There are no errors in the Docker console or browser console — the death is completely silent.

## Architecture

- **Container**: Debian bookworm-slim, node 20, tmux 3.3a
- **PID 1**: `node server/index.js` (wrapped by `tini` via `init: true`)
- **Session lifecycle**: `tmux new-session -d` creates a detached tmux session with `/bin/bash`. Then `node-pty` spawns `tmux attach-session` to connect to it. The PTY is bridged to the browser via WebSocket.
- **Key files**: `server/websocket.js` (WS + PTY management), `server/sessions.js` (tmux session management), `config/tmux.conf`

## Root Cause — FOUND

### Claude Code runs `tmux kill-session` from inside the terminal

Two factors combine to cause session death:

**Factor 1: Claude Code discovers tmux sessions via the default socket.**
Even after unsetting `TMUX` and `TMUX_PANE` env vars (so Claude Code doesn't know it's _inside_ tmux), Claude Code can still run `tmux list-sessions` against the default tmux socket at `/tmp/tmux-1000/default`. This lists all our `terminaldeck-*` sessions.

**Factor 2: Claude Code has whitelisted tmux permissions.**
The `.claude/settings.local.json` had accumulated these permissions during earlier debugging:
```json
"Bash(tmux:*)",
"Bash(while read s)",
"Bash(do tmux kill-session -t \"$s\")",
"Bash(done)",
```
The `Bash(tmux:*)` wildcard allows any tmux command without user confirmation. Claude Code could freely run `tmux kill-session -t <session-name>`.

Tmux verbose server logging (`-vvv`) captured the exact commands:
```
kill-session -t terminaldeck-fec12c48-bc01-4379-bfd3-f5abc46d1b3b
kill-session -t terminaldeck-1cf886c6-1238-4faf-b5e5-c47f19967bfc
kill-session -t terminaldeck-95b9d650-2e29-4d43-b367-f03f32ed09da
```

This explains all the symptoms:
- **No `PANE_DIED` hook fired** — session was killed directly, not through pane process exit
- **`remain-on-exit on` had no effect** — `kill-session` bypasses `remain-on-exit` entirely
- **All tmux options were correctly set** — they protect against pane exit cascade, but not explicit `kill-session`
- **`unset TMUX TMUX_PANE` alone was insufficient** — Claude Code doesn't need those vars to run tmux commands; it can access the default socket independently

### Fix Applied (Two-Pronged)

**Fix 1: Dedicated tmux socket (`-L terminaldeck`)**

All tmux operations now use a dedicated socket name instead of the default:
```javascript
const TMUX_SOCKET = 'terminaldeck';
// Every tmux command now includes: ['-L', TMUX_SOCKET, ...]
await execFileAsync('tmux', ['-L', TMUX_SOCKET, 'new-session', '-d', '-s', tmuxName, ...]);
```

This creates a completely separate tmux server instance. Processes inside the terminals that run `tmux list-sessions` (which uses the default socket) won't see our sessions. They'd have to explicitly specify `-L terminaldeck` to find them.

**Fix 2: Removed dangerous Claude Code permissions**

Removed from `.claude/settings.local.json`:
```json
"Bash(tmux:*)",
"Bash(while read s)",
"Bash(do tmux kill-session -t \"$s\")",
"Bash(done)",
```

These were accumulated during earlier debugging sessions and gave Claude Code blanket permission to run any tmux command without confirmation.

**Fix 3 (retained from earlier): Unset TMUX env vars**
```javascript
const sessionCmd = `unset TMUX TMUX_PANE; exec ${shell}`;
```
Still valuable as defense in depth — prevents processes from knowing they're inside tmux.

**Status: Fixes applied, awaiting test confirmation.**

## What Didn't Work

### Attempt 1: `unset TMUX TMUX_PANE` alone
- **Hypothesis**: Claude Code detects tmux via env vars and kills the session
- **Result**: Sessions still died. Claude Code doesn't need env vars — it can independently run `tmux list-sessions` on the default socket to discover and kill sessions
- **Lesson**: Env var scrubbing is necessary but not sufficient for tmux isolation

### Attempt 2: Protective tmux options
- `destroy-unattached off`, `exit-unattached off`, `exit-empty off`, `remain-on-exit on`
- **Result**: All correctly set, all irrelevant. These protect against _natural_ session death (pane exit cascade), not against explicit `kill-session` commands

### Attempt 3: `set -g` vs `setw -g` for `remain-on-exit`
- **Result**: Correctly diagnosed as a window option, but irrelevant for the same reason

## Investigation Timeline

### Phase 1: tmux SERVER dying (FIXED early)
- Without `init: true` in docker-compose, the tmux server daemon had no proper init process. Server died almost instantly.
- **Fix**: `init: true` in `docker-compose.yml` + `set -g exit-empty off` in `tmux.conf`

### Phase 2: Confirming tmux options (ruled out)
Verified all protective tmux options were correctly set at runtime:
- `destroy-unattached off` — confirmed via `show-options -g`
- `exit-unattached off` — confirmed
- `exit-empty off` — confirmed
- `remain-on-exit on` — confirmed at both global window level and per-session level

Despite all options being correct, sessions still died. Proved the death wasn't from process exit cascade.

### Phase 3: `set -g` vs `setw -g` for `remain-on-exit` (ruled out)
- Changed tmux.conf from `set -g remain-on-exit on` to `setw -g remain-on-exit on`
- Added explicit per-session `set-window-option -t <session>: remain-on-exit on`
- **Result**: Session still died. Ruled out option scope issues.

### Phase 4: tmux lifecycle hooks (key evidence)
Added hooks to tmux.conf:
```
set-hook -g pane-died "run-shell 'echo PANE_DIED >> /tmp/tmux-events.log'"
set-hook -g session-closed "run-shell 'echo SESSION_CLOSED >> /tmp/tmux-events.log'"
```

**Result**: Only `SESSION_CLOSED` and `CLIENT_DETACHED` fired. **No `PANE_DIED` or `PANE_EXITED`**. Proved session was destroyed directly.

### Phase 5: tmux verbose server logging (smoking gun)
- Started tmux server with `-vvv` flag
- `grep -B 50 session_destroy` found `kill-session -t <our-session>` commands

### Phase 6: `unset TMUX TMUX_PANE` (insufficient)
- Applied env var scrubbing — sessions still died
- Proved Claude Code doesn't rely on env vars to interact with tmux

### Phase 7: Root cause identified — Claude Code permissions + default socket
- Found `Bash(tmux:*)` in `.claude/settings.local.json` giving blanket tmux access
- Claude Code runs `tmux list-sessions` (default socket), discovers our sessions, kills them
- `.claude/` directory is bind-mounted into the container, so project-level permissions apply inside terminals too

### Phase 8: Dedicated socket fix
- Moved all tmux commands to `-L terminaldeck` socket
- Removed tmux permissions from Claude Code settings
- Added logging to `destroySession()` with stack traces for future debugging

## All Changes Made

### docker-compose.yml
- Added `init: true` — provides tini as PID 1

### config/tmux.conf
```
set -g mouse on
set -g history-limit 10000
set -g destroy-unattached off
set -g exit-unattached off
set -g exit-empty off
setw -g remain-on-exit on

# Debug hooks (can be removed once fix is confirmed)
set-hook -g pane-died "run-shell 'echo PANE_DIED >> /tmp/tmux-events.log'"
set-hook -g pane-exited "run-shell 'echo PANE_EXITED >> /tmp/tmux-events.log'"
set-hook -g session-closed "run-shell 'echo SESSION_CLOSED >> /tmp/tmux-events.log'"
set-hook -g client-detached "run-shell 'echo CLIENT_DETACHED >> /tmp/tmux-events.log'"
```

### server/sessions.js
- **Dedicated tmux socket**: All tmux commands use `-L terminaldeck`
- Session command wraps shell: `unset TMUX TMUX_PANE; exec /bin/bash`
- Explicit per-session `set-window-option remain-on-exit on` after creation
- tmux server started with `-vvv` verbose logging on dedicated socket
- `destroySession()` logs stack trace for tracing kill-session origins
- Health check with diagnostics dump
- Diagnostics compare sessions on dedicated socket vs default socket

### server/websocket.js
- `destroy_terminal` handler logs when browser sends kill requests
- PTY `onExit()` queries pane state on dedicated socket
- 30-second grace period on WebSocket disconnect
- WebSocket ping/pong heartbeat (15s interval, 10s timeout)

### .claude/settings.local.json
- **Removed**: `Bash(tmux:*)`, `Bash(while read s)`, `Bash(do tmux kill-session -t "$s")`, `Bash(done)`
- These gave Claude Code inside the container blanket permission to kill tmux sessions

### server/index.js
- `uncaughtException` and `unhandledRejection` handlers
- Wired up health check start/stop

### server/log.js (new)
- Shared timestamp logger

### client/js/terminal.js
- Handles `exited` message type — displays exit info in terminal
- Stops reconnection when terminal process has genuinely exited

## Cleanup TODO (after fix is confirmed)

Once the dedicated socket fix is confirmed working:
1. Remove `-vvv` verbose logging from `_ensureVerboseServer()` (saves disk — logs grow to 20-40MB)
2. Remove debug hooks from `tmux.conf`
3. Remove tmux server log grep from `_dumpDiagnostics()`
4. Remove `destroySession()` stack trace logging
5. Keep: health check, option verification, dedicated socket (permanent)

## Key Lessons

1. **`unset TMUX` is not enough for tmux isolation.** Processes can run `tmux list-sessions` without env vars and still interact with sessions on the default socket.
2. **Use `-L <socket>` for true tmux isolation.** A dedicated socket creates a separate tmux server that's invisible to processes using the default socket.
3. **Audit Claude Code permissions regularly.** `Bash(tmux:*)` wildcards accumulated during debugging sessions can have catastrophic side effects.
4. **Bind-mounted config directories carry permissions into containers.** `.claude/settings.local.json` from the host applies inside the container too.

## File Map
- `server/websocket.js` — WebSocket server, PTY lifecycle, heartbeat
- `server/sessions.js` — tmux session CRUD, health monitoring, diagnostics
- `server/index.js` — app entry point, process error handlers
- `server/log.js` — timestamped logging
- `client/js/terminal.js` — browser-side terminal connection, reconnection
- `config/tmux.conf` — tmux configuration (mounted into container at build)
- `docker-compose.yml` — container config (`init: true` is critical)
- `Dockerfile` — container build (copies tmux.conf to `~/.tmux.conf`)
- `.claude/settings.local.json` — Claude Code permissions (no tmux wildcards!)
