const POLL_INTERVAL_MS = 2000;

class ForegroundTracker {
  constructor() {
    this._commands = new Map(); // terminalId -> last known command
    this._pollInterval = null;
  }

  removeTerminal(terminalId) {
    this._commands.delete(terminalId);
  }

  startBroadcasting(sessionManager, broadcastFn) {
    this.stopBroadcasting();
    this._pollInterval = setInterval(async () => {
      try {
        const current = await sessionManager.getForegroundCommands();
        const changed = {};
        let hasChanges = false;

        for (const [terminalId, cmd] of Object.entries(current)) {
          if (this._commands.get(terminalId) !== cmd) {
            this._commands.set(terminalId, cmd);
            changed[terminalId] = cmd;
            hasChanges = true;
          }
        }

        // Also detect terminals that disappeared from tmux
        for (const [terminalId] of this._commands) {
          if (!(terminalId in current)) {
            this._commands.delete(terminalId);
          }
        }

        if (hasChanges) {
          broadcastFn({ type: 'pane_context', contexts: changed });
        }
      } catch {
        // tmux not available — skip silently
      }
    }, POLL_INTERVAL_MS);
  }

  stopBroadcasting() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }
}

module.exports = { ForegroundTracker };
