const { expect } = require('chai');
const sinon = require('sinon');
const { ActivityTracker } = require('./activity');

describe('ActivityTracker', () => {
  let clock;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
  });

  it('isActive() returns false for unknown terminals', () => {
    const tracker = new ActivityTracker();
    expect(tracker.isActive('nonexistent')).to.be.false;
  });

  it('isActive() returns true after recordOutput within 3 seconds', () => {
    const tracker = new ActivityTracker();
    tracker.recordOutput('shell1');
    expect(tracker.isActive('shell1')).to.be.true;
  });

  it('isActive() returns false after 3 seconds without output', () => {
    const tracker = new ActivityTracker();
    tracker.recordOutput('shell1');
    clock.tick(3001);
    expect(tracker.isActive('shell1')).to.be.false;
  });

  it('isActive() resets on new output', () => {
    const tracker = new ActivityTracker();
    tracker.recordOutput('shell1');
    clock.tick(2500);
    tracker.recordOutput('shell1');
    clock.tick(2500);
    // 2500ms since last output — still active
    expect(tracker.isActive('shell1')).to.be.true;
  });

  it('getStatuses() returns status of all tracked terminals', () => {
    const tracker = new ActivityTracker();
    tracker.recordOutput('shell1');
    tracker.recordOutput('logs');
    clock.tick(2000);
    tracker.recordOutput('logs'); // refresh logs

    clock.tick(1500);
    // shell1: 3500ms since last output → inactive
    // logs: 1500ms since last output → active
    const statuses = tracker.getStatuses();
    expect(statuses.shell1).to.be.false;
    expect(statuses.logs).to.be.true;
  });

  it('broadcasts activity every 2 seconds when started', () => {
    const tracker = new ActivityTracker();
    const broadcastFn = sinon.stub();

    tracker.recordOutput('shell1');
    tracker.startBroadcasting(broadcastFn);

    clock.tick(2000);
    expect(broadcastFn.calledOnce).to.be.true;
    const call = broadcastFn.firstCall.args[0];
    expect(call).to.have.property('type', 'activity');
    expect(call).to.have.property('statuses');
    expect(call.statuses.shell1).to.be.true;

    tracker.stopBroadcasting();
  });

  it('broadcast includes all terminal statuses', () => {
    const tracker = new ActivityTracker();
    const broadcastFn = sinon.stub();

    tracker.recordOutput('claude');
    tracker.recordOutput('logs');
    tracker.recordOutput('shell1');

    tracker.startBroadcasting(broadcastFn);
    clock.tick(2000);

    const statuses = broadcastFn.firstCall.args[0].statuses;
    expect(statuses).to.have.property('claude', true);
    expect(statuses).to.have.property('logs', true);
    expect(statuses).to.have.property('shell1', true);

    tracker.stopBroadcasting();
  });

  it('stopBroadcasting() stops the interval', () => {
    const tracker = new ActivityTracker();
    const broadcastFn = sinon.stub();

    tracker.startBroadcasting(broadcastFn);
    tracker.stopBroadcasting();

    clock.tick(5000);
    expect(broadcastFn.called).to.be.false;
  });

  it('removeTerminal() removes a terminal from tracking', () => {
    const tracker = new ActivityTracker();
    tracker.recordOutput('shell1');
    expect(tracker.isActive('shell1')).to.be.true;

    tracker.removeTerminal('shell1');
    expect(tracker.isActive('shell1')).to.be.false;
    expect(tracker.getStatuses()).to.not.have.property('shell1');
  });
});
