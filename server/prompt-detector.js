const MIN_OUTPUT_BYTES = 50;
const DEBOUNCE_MS = 2000;
const MAX_BUFFER = 1024;

class PromptDetector {
  constructor(promptPattern, onTaskComplete) {
    this._pattern = new RegExp(promptPattern);
    this._onTaskComplete = onTaskComplete;
    this._terminals = new Map(); // terminalId -> state
  }

  /**
   * Call this on every PTY output chunk.
   * Tracks output volume and debounces prompt detection.
   */
  recordOutput(terminalId, data) {
    let state = this._terminals.get(terminalId);
    if (!state) {
      state = { outputSince: 0, timer: null, recentOutput: '' };
      this._terminals.set(terminalId, state);
    }

    state.outputSince += data.length;
    state.recentOutput += data;
    // Keep only last MAX_BUFFER chars for pattern matching
    if (state.recentOutput.length > MAX_BUFFER) {
      state.recentOutput = state.recentOutput.slice(-MAX_BUFFER);
    }

    // Reset debounce timer
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      this._checkPrompt(terminalId, state);
    }, DEBOUNCE_MS);
  }

  _checkPrompt(terminalId, state) {
    // Strip ANSI escape sequences for matching
    const clean = state.recentOutput.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    if (state.outputSince > MIN_OUTPUT_BYTES && this._pattern.test(clean)) {
      // Substantial output followed by prompt = task complete
      this._onTaskComplete(terminalId);
    }

    // Reset for next command
    state.outputSince = 0;
    state.recentOutput = '';
  }

  removeTerminal(terminalId) {
    const state = this._terminals.get(terminalId);
    if (state && state.timer) clearTimeout(state.timer);
    this._terminals.delete(terminalId);
  }
}

module.exports = { PromptDetector };
