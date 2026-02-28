#!/usr/bin/env bash
# Verify that test cleanup is isolated from production sessions.
# Run this while terminaldeck is active to confirm tests can't reach production.

echo "=== Production sessions (socket: terminaldeck) ==="
tmux -L terminaldeck list-sessions 2>/dev/null || echo "(none)"

echo ""
echo "=== Test sessions (socket: terminaldeck-test) ==="
tmux -L terminaldeck-test list-sessions 2>/dev/null || echo "(none)"

echo ""
echo "Running test cleanupTmuxSessions logic (terminaldeck-test socket only)..."

sessions=$(tmux -L terminaldeck-test list-sessions -F "#{session_name}" 2>/dev/null || true)
for s in $sessions; do
  if [[ "$s" == terminaldeck-test-* ]]; then
    echo "  KILLING: tmux -L terminaldeck-test kill-session -t \"$s\""
    tmux -L terminaldeck-test kill-session -t "$s" 2>/dev/null
  fi
done

echo ""
echo "=== Production sessions AFTER cleanup (should be unchanged) ==="
tmux -L terminaldeck list-sessions 2>/dev/null || echo "(none)"

echo ""
echo "=== Test sessions AFTER cleanup ==="
tmux -L terminaldeck-test list-sessions 2>/dev/null || echo "(none)"
