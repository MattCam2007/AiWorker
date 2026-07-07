# Test Upgrade Plan — 2026-07-07

Goal: get every behavior that matters under test, then push line coverage as
close to 100% as is honest for a DOM/pty-heavy codebase. Eight phases; each is
a single PR-sized, independently green unit of work. Later phases depend on
earlier ones only where stated.

## Baseline (measured with c8 on this date)

`npm test`: **343 passing**, ~10s.
`npm run test:integration`: **6 of 9 FAILING** — the WS upgrade path now
requires a `?t=<serverToken>` query param (`server/websocket.js:62-68`) and
`test/integration.test.js` was never updated. The suite has rotted, which means
the "gates before done" rule in AGENTS.md is currently unenforceable.
`npm run test:e2e`: **does not exist** — plan 00 (verification harness) has not
landed; no playwright devDep, no `test/e2e/`, no script in package.json.
CI: **none** (no `.github/workflows`), so nothing prevents further rot.

Line coverage (c8, unit suite only):

| File | Lines | Cov | Notes |
|---|---|---|---|
| **server** overall | | **66.9%** | |
| server/activity.js, prompt-detector.js, log.js, utils.js | | 100% | done |
| server/files.js, history.js, fileops.js | | 83–88% | good |
| server/websocket.js | 600 | 71% | gaps are the *dangerous* paths (see P2) |
| server/sessions.js | 578 | 74% | health check + diagnostics untested |
| server/config.js | 251 | 70% | merge/hot-reload branches |
| server/foreground.js | 53 | 68% | poll loop untested |
| server/index.js | 685 | 52% | notes API, listdeck proxy, SSE, claude/opencode trees |
| server/folders.js | 157 | 34% | FolderManager only exercised indirectly |
| server/filetree.js | 144 | 18% | 0 of 3 functions called by tests |
| **client/js** overall | | **35.9%** | |
| command-palette.js, folder-cell.js | | 93–99% | done |
| app.js | 2778 | 52% | mobile toolbar, folder dialog, file-open flows untested |
| layout.js | 1645 | 55% | supersize, gutters, tab context menu untested |
| terminal.js | 807 | 40% | wheel forwarding, copy-on-select, strip logic untested |
| terminal-list.js | 489 | 39% | only smoke-tested via app.test.js |
| filetree.js | 733 | 0%* | *false zero — see measurement artifact below* |
| editor-panel.js | 1513 | 0% | largest untested file in the repo |
| note-panel.js | 333 | 0% | |
| today-tasks.js | 274 | 0% | |
| editor-settings.js | 92 | 0% | |

**Measurement artifact:** client tests load code two different ways.
Most `require('./module')` after globalizing `window` (coverage attributes, but
needs `delete require.cache` hacks and shares one module instance per file).
`filetree.test.js` instead injects the source as a `<script>` element into
jsdom — genuinely tested, but V8 coverage can't attribute it, hence the false
0%. Phase 1 unifies this.

## Priorities (what "important things tested" means here)

1. **The suites themselves must be trustworthy** — a broken integration suite
   is worse than a missing one (P0).
2. **Data-loss / session-loss paths**: pty exit → re-attach loop, disconnect
   grace period, health check, reconnect-within-grace (P2).
3. **Security-relevant surfaces**: WS origin + token checks, path traversal in
   filetree/notes/fileops routes, listdeck proxy (P2/P3).
4. **AGENTS.md architecture truths and the "verified-good — do NOT fix" list**:
   wheel→SGR forwarding, mouse-tracking strip, copy-on-select, the
   compositionend Android hack. These are explicitly regression-sensitive and
   almost entirely untested today (P4).
5. Everything else, in descending size-of-blast-radius order (P5–P7).

Raw % is the trailing indicator; the phase gates below are behavioral.

## Coordination with the usability-remediation program

Plans 01–07 will deliberately change behavior (rate limits, wheel scrollback,
resize reconciliation). This plan tests **current** behavior; where current
behavior is a documented bug, encode it plan-00-style as an *inverted
assertion with a loud comment* naming the plan that flips it — never `it.skip`.
Phase 6 of this plan **is** remediation plan 00; do not implement an e2e
harness twice.

---

## Phase 0 — Repair the gates, add measurement

*No product code changes except one accessor.*

Code work:
- Expose the WS auth token on the `createApp()` return value
  (`app.serverToken`) so tests stop reaching into `app.wsServer._serverToken`
  (as `server/index.test.js:133` already does).
- Update `test/integration.test.js` to append `?t=<token>` on every WS URL
  (fetchable via `GET /api/config`, or `app.serverToken`). Migrate
  `index.test.js` to the new accessor.

Test/tooling work:
- Add `c8` as a devDependency; add scripts
  `"coverage": "c8 --all --src server --src client/js --exclude '**/*.test*.js' --exclude 'client/vendor/**' --exclude 'client/js/test-helpers.js' npm test"`.
  Add `coverage/` and `.nyc_output/` to `.gitignore`.
- Record the baseline table above in `plans/` (this file) so ratchets in P7
  have a reference.

Acceptance: `npm test` and `npm run test:integration` fully green;
`npm run coverage` emits a report. **This phase unblocks the AGENTS.md gates
and must land first.**

## Phase 1 — One client test harness

*Test-only. Fixes the false-zero measurement and the require-cache hacks.*

- Add `loadClientScript(window, relPath)` to `client/js/test-helpers.js`:
  read the source and evaluate it in the jsdom window via
  `vm.runInContext(code, ctx, { filename: absolutePath })` — the filename makes
  V8/c8 attribute coverage, and every test gets a fresh IIFE execution with no
  `require.cache` surgery.
- Migrate all client tests to it: `filetree.test.js` (script-injection
  pattern), and the `require('./x')` + `delete require.cache` pattern in
  `app.test.js`, `layout.test.js`, `command-palette.test.js`,
  `folder-cell.test.js`, `terminal.test.js`, `notifications.test.js`.

Acceptance: all 343 tests still green; `npm run coverage` now shows real
numbers for `client/js/filetree.js` (expect >50%) and no client test touches
`require.cache`.

## Phase 2 — Server lifeline paths (`websocket.js`, `sessions.js`)

*The highest-stakes gap: these paths run when things go wrong, and they are
exactly the ones with no tests.*

Code work (testability only, no behavior change):
- Make the magic intervals injectable via existing options objects:
  `PTY_GRACE_PERIOD` (`websocket.js`), health-check interval (`sessions.js`),
  `POLL_INTERVAL_MS` (`foreground.js`). Default to current values.

New tests in `server/websocket.test.js` (extend existing harness):
- **pty exit → re-attach**: session still alive ⇒ re-attaches and rewires
  handlers; repeats up to `MAX_REATTACH` then gives up; session gone ⇒ clients
  get `{type:'exited'}` and terminal state is torn down after the delay.
- **Disconnect grace period**: last client disconnect arms the kill timer;
  reconnect within grace cancels it (`disconnectTimer` cleared); expiry kills
  the pty and cleans all trackers.
- **Connect to an exited terminal**: client receives `exited` then close code
  4001.
- **Upgrade guards**: wrong/absent token ⇒ 403 (partially covered); origin
  mismatch ⇒ socket destroyed (`websocket.js:53-58`, currently uncovered).
- **Folder control messages**: `create_folder` / `update_folder` /
  `delete_folder` / `move_terminal` round-trip to a `folders_update`
  broadcast, scoped to the right instance; malformed control JSON produces an
  `error` message, not a crash.
- **Broadcast wiring**: `startActivityBroadcasting` routes activity/foreground
  messages to the owning instance only; history watcher debounces to one
  `history_update` per 500ms burst (sinon fake timers).

New tests in `server/sessions.test.js`:
- Health check with fake timers: tmux server death detected, dead session
  pruned exactly once, recovery logged when server returns.
- `attachSession` failure paths; `updateSession` /`destroySession` on unknown
  ids; instance bookkeeping (`_addToInstance`/`_removeFromInstance`,
  `getInstanceForSession`) including a corrupt instances file.
- Diagnostics (`_dumpDiagnostics`, `_dumpPaneDeathInfo`, `_dumpShellProcInfo`):
  smoke-test that they don't throw with a dead session — do **not** chase 100%
  here, it's best-effort logging by design.

Acceptance: websocket.js ≥ 90% lines, sessions.js ≥ 85% (diagnostics
excepted); all suites green.

## Phase 3 — HTTP API completeness (`index.js`, `folders.js`, server `filetree.js`, stragglers)

Route tests via the existing `createApp({port:0,...})` pattern in
`server/index.test.js` (or a new `index.test.routes.js`):
- **File-editor API** (`/api/notes`): GET list; POST open (missing/invalid
  `filePath` ⇒ 400, bad JSON ⇒ 400); GET/PUT/DELETE `/api/notes/:id` including
  unknown id and save-conflict behavior in `files.js`.
- **`/api/claude-files`, `/api/opencode-files`, `/api/files`**: happy path +
  `..` traversal ⇒ 403 (mirrors `fileops-routes.test.js:111`).
- **Listdeck proxy** (`/api/listdeck/*`): point `config.listdeck.url` at a
  local stub `http.Server`; assert method/body/path forwarding, non-200
  passthrough, unreachable upstream ⇒ 502, invalid configured URL ⇒ 400.
- **Static serving**: traversal ⇒ 403; security headers present on every
  response class (200/403/404).
- **`_connectListdeckSSE`**: stub SSE server emits `daily_task_created` ⇒
  `broadcastTasksUpdate` called with the date; malformed data ignored;
  reconnect scheduled on non-200 (fake timers).

Direct unit tests, new files:
- `server/folders.test.js`: FolderManager CRUD, persistence round-trip,
  corrupt/absent JSON file recovery, `isValidFolderColor`, `moveTerminal` to
  null/unknown folder, nested `parentId` handling.
- `server/filetree.test.js`: `listDirectory` /`listClaudeDirectory` /
  `listOpencodeDirectory` against a fixture tree — ordering, type tags,
  hidden-file policy, and above all traversal containment.
- `server/foreground.test.js`: ForegroundTracker diffing with fake timers —
  only changes broadcast, disappeared terminals reported, `removeTerminal`.
- Top up `server/config.js` uncovered branches (lines 53–84: defaults/merge;
  121–157: watch + hot-reload error paths) and `server/utils.js` `deepEqual`
  edge cases. Cheap, mechanical.

Acceptance: server directory ≥ 85% lines overall; index.js ≥ 80%;
folders/filetree/foreground ≥ 90%.

## Phase 4 — `terminal.js`: the protected behaviors

*Everything AGENTS.md marks architecture-critical or "do NOT fix" lives here,
at 40% coverage. Load the `terminal-escapes` skill before this phase.*

Code work (this is the one place testing forces real code change):
- Extract the mouse-tracking-mode filter (`terminal.js:290-292` inline regex)
  into a pure, exported function that **buffers partial escape sequences across
  chunks**. Today a `\x1b[?1000h` split across two WS frames slips through
  unstripped — the exact failure AGENTS.md truth #3 warns about ("any
  escape-sequence parsing must survive sequences split across WebSocket
  frames"). Coordinate with remediation plan 03 (it owns strip-logic changes);
  if 03 hasn't landed, do the extraction here and 03 builds on it. Pattern:
  `filterMouseTracking(chunk, state) -> {out, state}` on the
  `window.TerminalDeck` namespace, unit-testable without jsdom.
- Extract the scroll-rail thumb geometry math (`_wireScrollRail`'s
  `updateThumb`/`scrollToY` ratio calculations) into pure helpers; the touch
  choreography itself is e2e territory (P6).

New tests in `client/js/terminal.test.js` (jsdom + existing mocks):
- **Strip filter**: strips `\x1b[?1000h`…`\x1b[?1006l`, sets/clears
  `_mouseTrackingStripped`, passes unrelated escapes through byte-exact, and
  handles a sequence split at every byte boundary across two chunks.
- **Wheel → SGR forwarding** (`terminal.js:157-185`): wheel event with
  stripping active sends `\x1b[<64;col;rowM` ×3 (up) / 65 (down) with correct
  1-based coords; inactive stripping ⇒ nothing sent; event default prevented.
- **Copy-on-select** (`:120-154`): one clipboard write per selection change
  burst; `navigator.clipboard` absent ⇒ fallback path + visible toast
  (degraded-mode requirement from AGENTS.md); no write on empty selection.
- **compositionend hack** (`:80-91`): textarea cleared after composition —
  pin the Android/Gboard workaround so nobody "cleans it up"
  (docs/mobile-input-duplication-bug.md).
- **`refresh()`/`moveTo()`/`focus()`** and the keyboardHidden blur contract
  (truth #6, shared with app.js).
- Pure-function tests for thumb geometry (clamping, min height 24px, ratio at
  boundaries).

Acceptance: terminal.js ≥ 75% lines (rail touch handlers and context-menu DOM
excepted — P6 covers those end-to-end); split-frame strip test green (or, if
plan 03 is deliberately deferred, present as an inverted-assertion documented
bug); all suites green.

## Phase 5 — Client orchestration (`app.js`, `layout.js`, `terminal-list.js`)

Largest raw line count, best done after P1's harness. Split into three
commits, one per file, in this order:

`terminal-list.js` (39%): render from sessions+folders, selection callback,
activity badge updates, folder collapse, drag-reorder message emission,
empty-state. Test directly (new `terminal-list.test.js`), not via app.js.

`layout.js` (55%): the untested blocks are nameable features —
- supersize/exitSupersize (`:1165-1421`): fast path reparents the live
  terminal without detach (assert no `detach()` call — that's the
  reload-duplication protection), slow path, `clearSupersize`.
- grid gutters (`:1447-1641`): proportion apply/persist, drag with synthetic
  mouse events, `_resetProportions`.
- tab context menu / rename popover / folder more-menu (`:413-666`).

`app.js` (52%), by feature:
- **Mobile toolbar** (`:1722-2302`, truth #6): `_TOOLBAR_KEYS` emission,
  Ctrl/Alt latching + deactivation, keyboard toggle driving
  `keyboardHidden` blur, swipe state cycling (extract the swipe state machine
  to a pure function if the DOM choreography fights jsdom), toolbar state
  persistence.
- Folder settings dialog (`:824-981`): populate, validate color, emit
  `update_folder`, start-command field.
- Control WS lifecycle (`:204-265`): reconnect backoff, `_handleSessionsUpdate`
  add/remove/rename diffing, `_handleConfigReload` theme application.
- File-open flows (`:1562-1669`): editor vs note routing; claude/opencode
  file tree init (`:1376-1443`) with stubbed fetch.
- Instance id init (`:34-58`) from URL param.

Acceptance: app.js ≥ 75%, layout.js ≥ 75%, terminal-list.js ≥ 85%; zero new
silent-failure assertions (every test asserts observable behavior, not
"doesn't throw").

## Phase 6 — e2e harness = remediation plan 00, plus editor smoke

Execute `plans/usability-remediation/00-verification-harness.md` **verbatim**
(playwright devDep, `test/e2e/helpers.js`, `usability.e2e.js` with the six
specified tests, three as inverted expected-fails, `test:e2e` script). That
plan is already written and pre-verified; don't redesign it.

Then extend the same harness with what jsdom cannot honestly cover:
- **editor-panel.js**: open a file from the tree, type, dirty indicator, save
  (assert on-disk content), close-with-unsaved prompt. CodeMirror 6 in jsdom
  is not worth fighting; the browser is the right instrument.
- Scroll-rail touch drag (P4's deferred surface) via `page.touchscreen`.
- Copy-on-select against the real clipboard permission grant.

Acceptance: `npm run test:e2e` green; `npm test`/`test:integration` untouched.
This phase satisfies plan 00's definition of done — record that in the
remediation README.

## Phase 7 — Remaining panels, ratchet, and CI

- Unit tests for `note-panel.js`, `today-tasks.js` (stub the listdeck fetch
  paths), `editor-settings.js`; extract editor-panel pure logic (tab/dirty/
  path bookkeeping) into testable functions where it doesn't require CM6,
  unit-test those.
- **Ratchet**: add `c8 check-coverage` thresholds to a `test:coverage` script —
  start at the numbers actually achieved (expect ≈85% lines global, with
  per-file floors of 90% for websocket/sessions/folders/filetree and 75% for
  the big client files) so the gate can only move up. Never set a threshold
  above what's real.
- **CI**: add a GitHub Actions workflow running `npm test`,
  `npm run test:integration` (ubuntu runner has tmux; `apt-get install tmux`
  if not), and `test:coverage`. e2e in CI only if a Chromium install proves
  stable; otherwise keep it a local gate.
- Update AGENTS.md: refresh the file map (editor-panel, note-panel,
  terminal-list, today-tasks, command-palette, folders, files/fileops,
  history, activity, foreground, prompt-detector are all unmapped today) and
  add `npm run coverage` to the commands block.

Acceptance: thresholds enforced and green in CI; AGENTS.md map matches the
tree.

---

## Explicitly out of scope / not worth chasing

- `client/vendor/**` (vendored xterm 5.3.0, CodeMirror bundle) — never
  instrument or test vendor internals.
- 100% of `sessions.js` diagnostics dumps and `log.js` formatting — smoke
  tests only; they are best-effort by design.
- The `scripts/bundle-codemirror.js` build script.
- Rewriting `server/index.js` into a router framework. The route-handler
  monolith is testable as-is through `createApp`; a refactor is a separate
  decision, not a testing prerequisite.
- xterm rendering fidelity (DOM renderer output) — covered indirectly by e2e
  buffer reads; per AGENTS.md, do not add canvas/webgl or fight the renderer.

## Honest ceiling

After all phases, expect ~85–90% line coverage overall. The remainder is
touch/gesture handlers, clipboard permission branches, and pty/tmux error
races that only the e2e and integration layers exercise meaningfully — they
are *covered by tests*, just not by the instrumented unit suite. That is the
correct trade: the number that matters is that every architecture truth,
every "verified-good" behavior, and every data-loss path has a test that fails
when it breaks.
