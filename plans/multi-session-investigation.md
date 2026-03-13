# Multi-Session / Instance System Investigation

## How the instance system works

`_initInstanceId()` (client/js/app.js:34-57) is the key:

1. It checks the URL for `?instance=<id>`
2. If not in the URL, it checks `localStorage` for a previously saved instance ID
3. If neither exists, it **generates a new random UUID** via `crypto.randomUUID()`
4. It saves the ID to `localStorage` and uses `history.replaceState` to add `?instance=<id>` to the URL without a page reload

Then all API calls (`/api/sessions`, `/api/folders`) and WebSocket connections (`/ws/control`, `/ws/terminal/<id>`) pass this `instance` parameter so the server scopes everything per-instance.

## Why you can't copy-paste the URL

The instance ID is tied to server-side state that was created during that browser session's lifetime. When you:

1. Open the page fresh → no `?instance` in URL → new UUID generated → written to URL
2. Copy that URL (e.g., `?instance=abc-123`) and open it in another tab/browser

...it "works" in the sense that it connects to instance `abc-123`. But:

- **Same browser**: `localStorage` already has that ID, so you get a second tab viewing the same instance. This should actually work fine — both tabs share the same session list.
- **Different browser**: The server's `SessionManager._instances` Map is **in-memory only during the server process lifetime** (persisted to `config/instances.json` on disk). The instance ID will be recognized and you'll see the same terminals — this should also work.

## Possible failure points

The design should handle sharing the URL. The instance ID is just a namespace key. The possible failure points are:

1. **The `serverToken` (line 140, server/index.js)** — generated fresh on every server start, required on all WebSocket connections (`?t=<token>`). This token is fetched from `/api/config` at init time. If you're hitting the raw URL without the JS app running to fetch the token first, WebSocket auth will fail with a 403.

2. **Static serving strips query strings** (line 51, server/index.js: `filePath.split('?')[0]`) — so `GET /?instance=foo` serves `index.html` correctly. This shouldn't error.

3. **CORS/origin checks on WebSocket upgrade** (websocket.js:53-58) — if the origin header doesn't match the host, the socket is destroyed.

**Most likely scenario**: the page load itself works fine (HTTP), but the WebSocket connections or API calls fail because of the `serverToken` mismatch or some other runtime issue.

## The design intent

The instance system is meant to let **multiple independent workspaces** run on the same server — each with their own set of terminals, folders, etc. A new random ID per-browser gives each visitor their own workspace by default. Sharing the URL *should* let another client join the same workspace. It's not broken by design — something specific is failing.

## Key files

- `client/js/app.js:34-57` — `_initInstanceId()`, generates/reads/writes instance ID
- `server/sessions.js` — `SessionManager._instances` Map, `_loadInstances()`, `_saveInstances()` (persists to `config/instances.json`)
- `server/index.js:140` — `serverToken` generated per server start, passed to client via `/api/config`
- `server/websocket.js:62-68` — WebSocket upgrade checks `?t=<token>` and `?instance=<id>`
