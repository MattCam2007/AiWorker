const ACTIVE_THRESHOLD_MS = 3000;
const BROADCAST_INTERVAL_MS = 2000;

class ActivityTracker {
  constructor() {
    this._lastOutput = new Map(); // terminalId -> timestamp
    this._broadcastInterval = null;
  }

  recordOutput(terminalId) {
    this._lastOutput.set(terminalId, Date.now());
  }

  isActive(terminalId) {
    const timestamp = this._lastOutput.get(terminalId);
    if (timestamp == null) return false;
    return (Date.now() - timestamp) < ACTIVE_THRESHOLD_MS;
  }

  getStatuses() {
    const statuses = {};
    for (const [id] of this._lastOutput) {
      statuses[id] = this.isActive(id);
    }
    return statuses;
  }

  removeTerminal(terminalId) {
    this._lastOutput.delete(terminalId);
  }

  startBroadcasting(broadcastFn) {
    this.stopBroadcasting();
    this._broadcastInterval = setInterval(() => {
      broadcastFn({
        type: 'activity',
        statuses: this.getStatuses()
      });
    }, BROADCAST_INTERVAL_MS);
  }

  stopBroadcasting() {
    if (this._broadcastInterval) {
      clearInterval(this._broadcastInterval);
      this._broadcastInterval = null;
    }
  }
}

module.exports = { ActivityTracker };
