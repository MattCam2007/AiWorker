const MIN_VISIBLE_CHARS = 80;
const DEBOUNCE_MS = 2000;
const COOLDOWN_MS = 5000;
const INPUT_SUPPRESS_MS = 500;
const RESIZE_SUPPRESS_MS = 1500;

/**
 * Strip ANSI escape sequences and control characters, returning only
 * visible printable text.
 */
function visibleLength(data) {
  return data
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')    // CSI sequences
    .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')   // OSC sequences
    .replace(/\x1b[^[\]]/g, '')                  // Other escape sequences
    .replace(/[\x00-\x1f\x7f]/g, '')             // Control characters (CR, LF, BEL, etc.)
    .length;
}

class PromptDetector {
  constructor(onTaskComplete) {
    this._onTaskComplete = onTaskComplete;
    this._terminals = new Map(); // terminalId -> state
  }

  _getState(terminalId) {
    let state = this._terminals.get(terminalId);
    if (!state) {
      state = { visibleChars: 0, timer: null, lastInput: null, lastResize: null, lastFired: null };
      this._terminals.set(terminalId, state);
    }
    return state;
  }

  /**
   * Call this on every PTY output chunk.
   * Two detection paths:
   *   1. BEL character (\x07) = explicit "pay attention" signal (e.g. Claude Code hooks).
   *      Fires immediately, subject only to cooldown.
   *   2. Idle detection = substantial visible output followed by silence.
   *      Fallback for programs that don't emit BEL (plain shell commands, etc.).
   */
  recordOutput(terminalId, data) {
    const state = this._getState(terminalId);
    const now = Date.now();

    // BEL detection — explicit signal, fire immediately (subject to cooldown)
    // Strip OSC sequences first so their BEL terminators don't false-trigger
    const stripped = data.replace(/\x1b\].*?\x07/g, '');
    if (stripped.includes('\x07')) {
      console.warn(new Date().toISOString().slice(0, 23), '[DING] BEL path —', terminalId.slice(0, 8));
      state.lastFired = now;
      state.visibleChars = 0;
      if (state.timer) { clearTimeout(state.timer); state.timer = null; }
      this._onTaskComplete(terminalId);
      return;
    }

    // Ignore output that is likely echo from user typing
    if (state.lastInput !== null && now - state.lastInput < INPUT_SUPPRESS_MS) return;

    // Ignore output that is likely a redraw from resize/focus
    if (state.lastResize !== null && now - state.lastResize < RESIZE_SUPPRESS_MS) return;

    // Only count visible characters — escape sequences don't count
    state.visibleChars += visibleLength(data);

    // Reset debounce timer
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      this._checkIdle(terminalId, state);
    }, DEBOUNCE_MS);
  }

  /**
   * Call this when the user sends input to the terminal.
   * Resets output tracking so keystroke echo doesn't accumulate.
   */
  recordInput(terminalId) {
    const state = this._getState(terminalId);
    state.lastInput = Date.now();
    state.visibleChars = 0;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  /**
   * Call this when the terminal is resized.
   * Suppresses output briefly to ignore redraw/repaint data.
   */
  recordResize(terminalId) {
    const state = this._getState(terminalId);
    state.lastResize = Date.now();
    state.visibleChars = 0;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  _checkIdle(terminalId, state) {
    const now = Date.now();

    if (state.visibleChars > MIN_VISIBLE_CHARS && (state.lastFired === null || now - state.lastFired > COOLDOWN_MS)) {
      console.warn(new Date().toISOString().slice(0, 23), '[DING] idle path —', terminalId.slice(0, 8), 'chars:', state.visibleChars);
      state.lastFired = now;
      this._onTaskComplete(terminalId);
    }

    // Reset for next cycle
    state.visibleChars = 0;
  }

  removeTerminal(terminalId) {
    const state = this._terminals.get(terminalId);
    if (state && state.timer) clearTimeout(state.timer);
    this._terminals.delete(terminalId);
  }
}

module.exports = { PromptDetector, visibleLength };
