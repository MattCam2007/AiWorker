# UUID Session Identifiers — Summary

The plan introduces an **instance ID** (UUID) passed via `?instance=<uuid>` in the URL that scopes **terminal sessions and folder layout** per instance. The filesystem is **shared** — all instances operate on the same `/home/terminaldeck/home`, files, and workspace. There is no per-user filesystem isolation.

## What Gets Scoped (per instance)

- Terminal sessions — each instance has its own set of tmux sessions
- Folder organization — how terminals are grouped/arranged
- WebSocket broadcasts — only see your own instance's events

## What Stays Shared (global)

- Filesystem — all files, directories, editor, notes, file operations
- Config — theme, shortcuts, `terminaldeck.json`
- Server token / authentication

## Key Design Decisions

- Client reads/generates UUID from query string, persists to `localStorage`, and passes it on every API call and WebSocket connection
- Server scopes sessions and folders by instance ID; file/note/fileops APIs are untouched (shared filesystem)
- Instance-to-session mapping persists in `config/instances.json` so tmux sessions can be rediscovered after server restart
- Folders get per-instance files (`folders-<uuid>.json`)

## Development Approach

- **TDD** — every phase starts with failing tests, then implementation, then refactor. Tests cover instance isolation, scoping correctness, and cross-instance rejection.
- **Update relevant docs** — any existing documentation describing session management or architecture gets updated as part of each phase
- **Completion report** — after implementation, write `plans/uuid-session-identifiers-results.md` documenting what was done per phase, test results, deviations from plan, and known issues

## Implementation Order (5 phases, each independently testable)

1. Client instance ID lifecycle + localStorage persistence
2. Server session scoping (instance-keyed Maps in SessionManager)
3. WebSocket broadcast scoping + terminal access validation
4. API route scoping (sessions/folders only — not files)
5. Per-instance folder configs

## Edge Cases

- **Stale instances**: Instances with no active connections accumulate tmux sessions over time — needs a cleanup mechanism (future, not POC)
- **Accidental new instance**: A new tab without `?instance=` creates a fresh UUID instead of rejoining. Mitigated by `localStorage` defaulting to the last-used instance

## Full Plan

See [uuid-session-identifiers.md](uuid-session-identifiers.md) for complete implementation details.
