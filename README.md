# TerminalDeck

Web-based persistent terminal dashboard. Terminal sessions run inside tmux and persist across browser disconnects, device switches, and reconnections. The frontend is a sci-fi themed dashboard with a configurable grid layout engine, xterm.js terminal rendering, and drag-to-swap interaction.

## Stack

- **Container:** Debian-slim base
- **Backend:** Node.js, node-pty, ws (WebSocket)
- **Frontend:** Vanilla ES6 JavaScript, xterm.js, CSS Grid
- **Session persistence:** tmux
- **Config:** Single JSON file on mounted volume

## Quick Start

### Local

```bash
npm install
npm start
# Server runs on http://localhost:3000
```

### Docker

```bash
docker compose up --build
```

## Configuration

All configuration lives in `config/terminaldeck.json`. The file is watched for changes — edits are picked up live without restarting.

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
    }
  ],
  "layouts": {
    "dev": {
      "grid": "2x2",
      "cells": [
        ["claude", "logs"],
        ["shell1", "git"]
      ]
    }
  }
}
```

### Terminal options

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `id` | Yes | — | Unique identifier |
| `name` | Yes | — | Display name |
| `command` | No | `settings.shell` | Command to run in the terminal |
| `workingDir` | No | `/home` | Starting directory |
| `autoStart` | No | `false` | Start on server launch |

### Layouts

Layouts define grid arrangements of terminals. The `grid` field specifies dimensions (e.g., `2x2`), and `cells` is a 2D array of terminal IDs. All referenced terminal IDs must exist in the `terminals` array.

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
  { "type": "activity", "id": "logs", "active": true }
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TERMINALDECK_PORT` | `3000` | HTTP server port |

## Testing

```bash
npm test
```

Tests use Mocha + Chai + Sinon. Test files live alongside source files with `.test.js` suffix. Backend tests require tmux. Frontend tests use jsdom for DOM simulation.

## Project Structure

```
├── Dockerfile
├── docker-compose.yml
├── package.json
├── config/
│   └── terminaldeck.json        # Main configuration
├── server/
│   ├── index.js                 # HTTP server, entry point
│   ├── config.js                # Config loader, validator, watcher
│   ├── sessions.js              # tmux session manager
│   ├── websocket.js             # WebSocket terminal bridge
│   └── *.test.js                # Co-located tests
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
│       └── *.test.js            # Co-located tests
├── test/
│   └── setup.js                 # Test harness
└── docs/
    └── build-report.md          # Detailed build report
```

## Requirements

- Node.js 22+
- tmux 3.x
- bash

## Current Status

**All phases complete (Phases 1-7). 99/99 tests passing.**

The backend is fully functional: config loading with hot-reload, tmux session management, WebSocket terminal bridge, and HTTP server with static file serving and API endpoints.

The frontend is fully functional: xterm.js terminal rendering with WebSocket reconnection, CSS Grid layout engine with 8 presets and swap interaction, fullscreen mode, ephemeral terminal creation, connection status indicator, and a sci-fi themed UI with mobile responsive support.

See [docs/build-report.md](docs/build-report.md) for the full build report including challenges, architecture, and known issues.
