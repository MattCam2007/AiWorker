# TerminalDeck

Web-based persistent terminal dashboard. Terminal sessions run inside tmux and persist across browser disconnects, device switches, and reconnections. The frontend (upcoming) is a sci-fi themed dashboard with a configurable grid layout engine.

## Stack

- **Container:** Debian-slim base
- **Backend:** Node.js, node-pty, ws (WebSocket)
- **Frontend:** Vanilla ES6 JavaScript, xterm.js, CSS Grid (upcoming)
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

Tests use Mocha + Chai. Test files live alongside source files with `.test.js` suffix. tmux must be installed for session and integration tests to run.

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
│   ├── activity.js              # Activity tracking (placeholder)
│   └── *.test.js                # Co-located tests
├── client/
│   ├── index.html               # Dashboard HTML
│   ├── vendor/                  # xterm.js UMD bundles (upcoming)
│   ├── css/style.css            # Styles (upcoming)
│   └── js/
│       ├── app.js               # App entry (upcoming)
│       ├── terminal.js          # Terminal widget (upcoming)
│       └── layout.js            # Grid layout engine (upcoming)
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

**Foundation complete (Phases 1-4). 36/36 tests passing.**

The backend is fully functional: config loading with hot-reload, tmux session management, WebSocket terminal bridge, and HTTP server with static file serving and API endpoints.

Frontend phases (dashboard UI, xterm.js integration, grid layout, theming) have not been started. Client files are placeholders.

See [docs/build-report.md](docs/build-report.md) for the full build report including challenges, architecture, and known issues.
