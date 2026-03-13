# TerminalDeck

Web-based persistent terminal dashboard. Terminal sessions run inside tmux and persist across browser disconnects, device switches, and reconnections. The frontend is a sci-fi themed dashboard with a configurable grid layout engine, xterm.js terminal rendering, and drag-to-swap interaction.

## Stack

- **Container:** Debian bookworm-slim base
- **Backend:** Node.js 20 LTS, node-pty, ws (WebSocket)
- **Frontend:** Vanilla ES6 JavaScript, xterm.js, CSS Grid
- **Session persistence:** tmux
- **Config:** Single JSON file on mounted volume, hot-reloaded on change

## Quick Start

### Docker (recommended)

```bash
docker compose up --build
# Open http://localhost:3000
```

The `config/` directory is volume-mounted, so edits to `config/terminaldeck.json` on your host trigger a live reload inside the container. The `workspace/` directory is mounted at `/workspace` for terminal access.

### Local

```bash
npm install
npm start
# Server runs on http://localhost:3000
```

Requires tmux, bash, and Node.js 20+ installed locally.

## Configuration

All configuration lives in `config/terminaldeck.json`. The file is watched for changes with 500ms debounce — edits are picked up live without restarting.

```json
{
  "settings": {
    "theme": {
      "defaultColor": "#33ff33",
      "background": "#0a0a0a",
      "fontFamily": "Fira Code, monospace",
      "fontSize": 14
    },
    "shell": "/bin/bash",
    "defaultLayout": "dev"
  },
  "terminals": [
    {
      "id": "claude",
      "name": "Claude Code",
      "command": "claude",
      "workingDir": "/workspace/project",
      "autoStart": true
    },
    {
      "id": "logs",
      "name": "Log Watcher",
      "command": "tail -f /var/log/syslog",
      "workingDir": "/workspace",
      "autoStart": true
    },
    {
      "id": "shell1",
      "name": "Shell",
      "workingDir": "/workspace",
      "autoStart": true
    },
    {
      "id": "git",
      "name": "Git Ops",
      "workingDir": "/workspace/project",
      "autoStart": true
    }
  ],
  "layouts": {
    "dev": {
      "grid": "2x2",
      "cells": [
        ["claude", "logs"],
        ["shell1", "git"]
      ]
    },
    "focus": {
      "grid": "1x1",
      "cells": [["claude"]]
    },
    "monitoring": {
      "grid": "1x3",
      "cells": [["logs", "shell1", "git"]]
    }
  }
}
```

### Terminal Options

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `id` | Yes | — | Unique identifier |
| `name` | Yes | — | Display name shown in headers and strip |
| `command` | No | `settings.shell` | Command to run in the terminal |
| `workingDir` | No | `/home` | Starting directory |
| `autoStart` | No | `false` | Start tmux session on server launch |

### Settings

| Field | Default | Description |
|-------|---------|-------------|
| `theme.defaultColor` | `#33ff33` | Terminal text color |
| `theme.background` | `#0a0a0a` | Terminal background |
| `theme.fontFamily` | `Fira Code, monospace` | Terminal font |
| `theme.fontSize` | `14` | Terminal font size in px |
| `shell` | `/bin/bash` | Default shell for terminals without a command |
| `defaultLayout` | `default` | Layout to apply on page load |

### Layouts

Layouts define grid arrangements of terminals.

- **`grid`**: Dimensions as `CxR` string. Available presets: `1x1`, `2x1`, `1x2`, `2x2`, `2x3`, `3x2`, `3x1`, `1x3`
- **`cells`**: 2D array of terminal IDs filling the grid row-by-row

All referenced terminal IDs must exist in the `terminals` array. Terminals not placed in a layout appear in the minimized strip at the bottom.

## Hot Reload

Editing `config/terminaldeck.json` while the server is running triggers:

1. **Config diff**: added, removed, and modified terminals are detected
2. **Session management**: new `autoStart` terminals get tmux sessions created; removed terminals get their sessions destroyed
3. **Client broadcast**: all connected browsers receive the updated config
4. **Frontend update**: theme changes apply instantly, layout buttons rebuild, new terminal connections are created, removed ones are cleaned up

Invalid JSON is safely ignored — the server retains the last valid config and logs the error.

## Activity Monitoring

The server tracks terminal output timestamps and broadcasts activity status to all clients every 2 seconds. Terminals with output in the last 3 seconds show as "active" with a green status dot. Minimized terminals in the strip pulse when they receive new output.

## Ephemeral Terminals

Click the **+** button in the header to create a temporary terminal session. Ephemeral terminals:
- Get an auto-generated ID prefixed with `ephemeral-`
- Appear in the minimized strip
- Can be dragged into grid cells like any other terminal
- Can be destroyed (kills the tmux session)

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Dashboard UI (static files) |
| `/api/config` | GET | Current configuration |
| `/api/sessions` | GET | Active terminal sessions |
| `/ws/terminal/{id}` | WebSocket | Terminal I/O stream |

### WebSocket Protocol

Messages are JSON-framed:

```
Client -> Server:
  { "type": "input", "data": "ls -la\n" }
  { "type": "resize", "cols": 120, "rows": 40 }
  { "type": "create_ephemeral", "name": "Temp Shell" }
  { "type": "destroy_ephemeral", "id": "ephemeral-xxx" }

Server -> Client:
  { "type": "output", "data": "..." }
  { "type": "sessions", "sessions": [...] }
  { "type": "config_reload", "config": {...} }
  { "type": "activity", "statuses": { "shell1": true, "logs": false } }
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TERMINALDECK_PORT` | `3000` | HTTP server port |

## Testing

```bash
npm test                # Unit tests (server + client)
npm run test:integration # Integration tests (full stack)
npm run test:all        # All tests
```

Tests use Mocha + Chai + Sinon. Unit test files live alongside source files with `.test.js` suffix. Integration tests are in `test/`. Backend and integration tests require tmux. Frontend tests use jsdom for DOM simulation.

## Architecture

```
Browser                    Server                     tmux
┌──────────┐  WebSocket   ┌────────────┐  node-pty  ┌──────────┐
│ xterm.js ├─────────────►│ ws bridge  ├───────────►│ sessions │
│ layout   │◄─────────────┤ activity   │◄───────────┤          │
│ app.js   │              │ config mgr │            │          │
└──────────┘              └────────────┘            └──────────┘
                               │
                          config.json
                          (fs.watch)
```

- **Node.js HTTP server** serves static files and API endpoints
- **WebSocket server** bridges browser terminals to tmux sessions via node-pty
- **tmux** provides session persistence — sessions survive browser disconnects
- **Config watcher** detects file changes, computes diffs, broadcasts to clients
- **Activity tracker** monitors pty output and broadcasts status every 2 seconds
- **Frontend** uses vanilla ES6 IIFEs — no build step, no framework

## Project Structure

```
├── Dockerfile
├── docker-compose.yml
├── package.json
├── config/
│   └── terminaldeck.json        # Main configuration (hot-reloaded)
├── server/
│   ├── index.js                 # HTTP server, entry point
│   ├── config.js                # Config loader, validator, watcher
│   ├── config-diff.js           # Config diff engine
│   ├── activity.js              # Terminal activity tracker
│   ├── sessions.js              # tmux session manager
│   ├── websocket.js             # WebSocket terminal bridge
│   └── *.test.js                # Co-located unit tests
├── client/
│   ├── index.html               # Dashboard HTML shell
│   ├── vendor/
│   │   ├── xterm.js             # xterm.js v5.3.0 UMD bundle
│   │   ├── xterm.css            # xterm.js stylesheet
│   │   └── xterm-addon-fit.js   # FitAddon v0.8.0 UMD bundle
│   ├── css/
│   │   └── style.css            # Sci-fi theme, grid layout, responsive
│   └── js/
│       ├── app.js               # App orchestrator, config fetch, chrome
│       ├── terminal.js          # xterm.js + WebSocket connection manager
│       ├── layout.js            # CSS Grid layout engine, swap, fullscreen
│       ├── test-helpers.js      # Mock classes for frontend tests
│       └── *.test.js            # Co-located unit tests
├── test/
│   └── integration.test.js     # Full-stack integration tests
└── docs/
    └── build-report.md          # Detailed build report
```

## Troubleshooting

**Terminals show "connecting..." but never connect**
- Ensure tmux is installed and running: `tmux -V`
- Check server logs for session creation errors
- Verify the terminal ID in config matches what the WebSocket connects to

**Config changes not detected**
- File watcher has a 500ms debounce — wait at least 1 second after saving
- Check server logs for "Config error" messages (invalid JSON)
- Ensure the config file is valid JSON with required `terminals` and `layouts` fields

**Blank terminal after layout switch**
- Terminal resize is triggered automatically; if it doesn't render, click the terminal to focus it
- The FitAddon needs the container to have non-zero dimensions

**Docker: terminals can't find commands**
- The container has bash, git, curl, and tmux. Other tools need to be added to the Dockerfile
- The `/workspace` directory is mounted from the host's `workspace/` folder

**WebSocket disconnects frequently**
- The client auto-reconnects with exponential backoff (1s to 30s)
- Check network stability and proxy/firewall WebSocket support

## Current Status

**All phases complete (Phases 1-10). 130/130 tests passing.**

- Backend: config loading with hot-reload + diff engine, tmux session management, WebSocket terminal bridge, activity monitoring, HTTP server
- Frontend: xterm.js terminal rendering, CSS Grid layout engine (8 presets), drag-to-swap, fullscreen mode, ephemeral terminals, hot-reload handling, activity status dots, sci-fi theme, mobile responsive
- Docker: Debian bookworm-slim container with Node 20 LTS, tmux, git
- Integration tests: full startup, terminal I/O, multi-client, session persistence, ephemeral lifecycle, hot reload, config validation
