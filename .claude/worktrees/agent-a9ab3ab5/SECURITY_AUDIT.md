# TerminalDeck Security Audit

**Date:** 2026-02-28
**Scope:** Full attack surface analysis of browser-based CLI application

---

## Architecture Overview

Terminal multiplexer web app: browser → WebSocket → node-pty → tmux → bash.
Runs in Docker with `network_mode: host` and mounted SSH agent.

---

## Findings

### CRITICAL

#### 1. Unrestricted Shell Execution
- `node-pty` spawns `/bin/bash` with no `ulimit`, no cgroup constraints, no seccomp profile
- Anyone with access can fork-bomb, mine crypto, or pivot to the network
- Container runs `network_mode: host`, giving the shell full network access to anything the host can reach
- **Files:** `server/websocket.js`, `docker-compose.yml`

#### 2. SSH Agent Mounted into Container
- `docker-compose.yml` mounts `/ssh-agent` and sets `SSH_AUTH_SOCK`
- Any terminal session can use SSH keys to authenticate to remote hosts (git push, SSH into servers, etc.)
- **File:** `docker-compose.yml`

#### 3. No Per-User Isolation
- Single shared token — every connected client can see, attach to, and kill every terminal session
- No concept of user ownership of sessions
- **Files:** `server/index.js`, `server/websocket.js`

---

### HIGH

#### 4. ~~Control WebSocket Has No Rate Limiting~~ **FIXED**
- Terminal data channel has 100 msg/sec limit, but control channel (`create_terminal`, `kill_terminal`, etc.) had none
- Attacker could spam terminal creation to exhaust PTY allocations, file descriptors, and memory
- **Fix applied:** Per-client rate limiter on control WebSocket — 10 messages/sec, same sliding-window pattern as data channel
- **File:** `server/websocket.js`

#### 5. No HTTPS Enforcement
- Auth token sent as WebSocket query parameter over plaintext
- Anyone on the same network can sniff it
- No `Strict-Transport-Security` header
- **File:** `server/index.js`

#### 6. ~~No Content-Security-Policy~~ **FIXED**
- Previously had no CSP header
- If any XSS vector exists (e.g., terminal escape sequences rendered in the DOM), there was no defense-in-depth
- **Fix applied:** Added `Content-Security-Policy` header: `default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self' ws: wss:; script-src 'self'`
- `X-Frame-Options: DENY` and other security headers were already present
- **File:** `server/index.js`

---

### MEDIUM

#### 7. ~~Path Traversal via Symlinks~~ **FIXED**
- `server/notes.js` and `server/filetree.js` validated paths but didn't resolve symlinks
- A symlink inside the allowed directory could point to `/etc/shadow` or any file readable by the container user
- **Fix applied:** Added `fs.realpathSync()` / `fs.promises.realpath()` calls before path prefix checks in `_isPathSafe()`, `openFile()` (notes.js), and `listDirectory()` (filetree.js). If the resolved real path escapes the allowed root, the request is rejected.
- **Files:** `server/notes.js`, `server/filetree.js`

#### 8. Ephemeral Token
- Token regenerates on server restart, disconnecting all clients
- Pushes toward weak token practices (hardcoding, env vars that get committed)
- **File:** `server/index.js`

#### 9. No Audit Logging
- No record of who connected, what commands were run, or what files were accessed
- Cannot detect or investigate a breach

---

## Summary Table

| # | Area | Severity | Risk |
|---|------|----------|------|
| 1 | Shell execution | CRITICAL | Fork bomb, crypto mining, network pivot |
| 2 | SSH agent exposed | CRITICAL | SSH key abuse, unauthorized remote access |
| 3 | No user isolation | CRITICAL | Users can interfere with each other's sessions |
| 4 | ~~Control channel rate limiting~~ | ~~HIGH~~ | **FIXED** — 10 msg/sec per client |
| 5 | No HTTPS | HIGH | Token sniffing on network |
| 6 | ~~No CSP header~~ | ~~HIGH~~ | **FIXED** — CSP restricts to `'self'` |
| 7 | ~~Symlink path traversal~~ | ~~MEDIUM~~ | **FIXED** — realpath() resolves symlinks before checks |
| 8 | Ephemeral token | MEDIUM | Weak token management patterns |
| 9 | No audit logging | MEDIUM | Cannot detect or investigate breaches |

---

## Recommendations (Priority Order)

### Immediate (before any non-localhost deployment)

1. **TLS termination** — Put behind a reverse proxy (nginx/caddy) with HTTPS. Redirect HTTP → HTTPS. Use WSS for WebSockets.
2. **Resource limits on spawned shells** — Set `ulimit -u 256`, memory caps, and CPU limits on PTY processes.
3. ~~**Rate limit the control WebSocket**~~ — **DONE.** 10 msg/sec per client on control channel.
4. **Drop SSH agent mount** — Remove from `docker-compose.yml` unless explicitly needed. Require opt-in with documentation of risk.
5. **Switch from `network_mode: host`** — Use bridge networking with explicit port exposure.

### Before production

6. ~~**Add security headers**~~ — **DONE.** CSP, X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy all set. (`Strict-Transport-Security` deferred until TLS is enabled.)
7. ~~**Fix symlink traversal in notes**~~ — **DONE.** `fs.realpathSync()` / `fs.promises.realpath()` added to notes.js and filetree.js.
8. **Implement audit logging** — Log connections, terminal lifecycle, and file access.
9. **Multi-user authentication** — Per-user tokens or session-based auth with terminal ownership.

---

## Bottom Line

This is **remote code execution as a service**. The Docker container provides a boundary, but `network_mode: host` + SSH agent mounting significantly widens the blast radius.

- **Single-user on localhost:** Acceptable, with the understanding that anything reaching the port owns your shell.
- **Any other deployment:** Requires the hardening measures listed above.
