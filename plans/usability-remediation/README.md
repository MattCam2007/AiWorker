# Usability Remediation — Work Plan Index

Source analysis: `plans/usability-audit-2026-07-06.md` (read it first; every plan
below references its finding IDs). Each numbered file is one independent piece of
work sized for a single PR. Execute in numeric order unless the dependency notes
say otherwise.

## Locked decisions (owner-approved 2026-07-06)

These resolve the audit's open questions. Do not re-litigate them during execution.

| # | Decision |
|---|----------|
| D1 | Wheel-up at the shell entering tmux copy-mode is the desired behavior. |
| D2 | Multi-client policy: **mirror at pty size** — every client renders the pty's true size. |
| D3 | Touch scroll rail: **rewire** it to drive tmux copy-mode scrolling (don't delete). |
| D4 | Palette chord: **Ctrl+Shift+P** opens the palette from anywhere; plain Ctrl+K stays readline kill-line in terminals. |
| D5 | Long-term deployment is **HTTPS over Tailscale** — `navigator.clipboard` will be available; no server-side clipboard hack; keep a clear toast fallback for insecure origins. |
| D6 | Keyboard (⌨) toggle state **persists in localStorage** per device. |

## Work pieces and dependencies

| Plan | Title | Depends on | Audit findings |
|------|-------|-----------|----------------|
| 00 | Verification harness (Playwright e2e) | — | all |
| 01 | Quick P0s: keyboard default, resize throttle, safe paste | 00 | F1, F4a, F4b |
| 02 | Wheel scrollback restoration | 00, 01 | F2, F9a (client half) |
| 03 | Scroll-to-bottom correctness + mouse-strip robustness | 00 | F5, F10 |
| 04 | Backpressure & rate limits | 00 | F9a (server half), F9b, F12 |
| 05 | Multi-client size mirroring | 00, 01 | F7 |
| 06 | Touch scroll rail → copy-mode | 02 | F3 |
| 07 | Desktop chrome polish | 01 | F8, F13 |

## Ground rules for the executor (apply to every plan)

- Read the audit section for the finding IDs before touching code.
- Change only the files/functions each plan names. Match surrounding style:
  client is vanilla ES5-style IIFEs (no build step), server is CommonJS.
- After every plan: `npm test` and `npm run test:integration` must pass
  (tmux required), plus the plan's own e2e assertions via `npm run test:e2e`.
- Expected-fail e2e tests created in plan 00 flip to enforcing in the plan that
  fixes them — flipping the test is part of that plan's definition of done.
- Behavior changes are pre-approved exactly as specified here (they came off the
  audit's "flag, don't silently do" list). If implementation forces a deviation
  from the spec, stop and ask instead of improvising.
- Never commit secrets, and don't touch `SECURITY_AUDIT.md` scope items — the
  one security note in the audit appendix is explicitly out of scope.
