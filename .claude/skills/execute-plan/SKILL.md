---
name: execute-plan
description: Workflow for implementing one numbered plan from plans/usability-remediation/ (pre-flight checks, scope lock, gates, live verification, commit). Use when asked to implement/execute/do plan NN or a remediation phase. Pass the plan number as the argument.
---

# Execute remediation plan $ARGUMENTS

## Pre-flight (do all before touching code)

1. Read `plans/usability-remediation/README.md` — decisions D1–D6 and ground
   rules bind you.
2. Read `plans/usability-remediation/<NN>-*.md` for the given number. Extract:
   allowed files, steps, acceptance criteria, "Depends on".
3. Verify dependencies landed: check git log and the artifacts earlier plans
   create (e.g. plan 00 ⇒ `test/e2e/` exists; plan 01 ⇒ trailing resize
   throttle in `server/websocket.js`). Missing dependency ⇒ STOP, report.
4. Read the audit sections for the plan's finding IDs
   (`plans/usability-audit-2026-07-06.md`) — they contain the root-cause
   evidence your change must address.
5. Baseline: `npm test && npm run test:integration` (and `npm run test:e2e` if
   it exists) must be green BEFORE you start. If not, stop and report — never
   build on a red baseline.

## Implement

- Touch only the plan's named files/functions. Client code is ES5 IIFE style
  (var/prototypes, no arrows); server is CommonJS. Never edit `client/vendor/*`.
- Byte-stream parsing ⇒ pure function + unit test incl. a chunk-split case
  (load the `terminal-escapes` skill for the domain rules).
- If the plan turns out to be wrong/incomplete against the real code, stop and
  surface the conflict with evidence. Do not redesign on the fly.

## Gates (in order, all required)

1. `npm test`
2. `npm run test:integration`
3. Flip any `DOCUMENTS BUG` e2e assertion this plan fixes to its enforcing
   form, then `npm run test:e2e`.
4. Live verification: use the `drive-terminaldeck` skill to observe the fixed
   behavior in the running app once. Tests passing without an observed
   behavior change = not done.

## Finish

- Commit only in-scope files; message: `Plan NN: <title> (fixes F<ids>)` plus
  a body listing behavior changes. Push only if instructed.
- Report: files changed (one line each), each gate's result verbatim, live
  evidence, deviations/questions. Red results are reported as red.
