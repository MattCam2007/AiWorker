const { expect } = require('chai');
const sinon = require('sinon');
const { PromptDetector } = require('./prompt-detector');

describe('PromptDetector', () => {
  let clock;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
  });

  describe('prompt pattern detection', () => {
    it('fires task_complete when output ends with default prompt after substantial output', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector('\\$\\s*$', callback);

      // Simulate substantial command output
      detector.recordOutput('t1', 'line 1 of output\n');
      detector.recordOutput('t1', 'line 2 of output\n');
      detector.recordOutput('t1', 'line 3 of output\n');
      // Prompt appears at end
      detector.recordOutput('t1', 'user@host:~$ ');

      // Advance past debounce period (2 seconds)
      clock.tick(2100);

      expect(callback.calledOnce).to.be.true;
      expect(callback.calledWith('t1')).to.be.true;
    });

    it('does not fire when there is no prior output (just hitting enter)', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector('\\$\\s*$', callback);

      // Just a prompt with no substantial output before it
      detector.recordOutput('t1', 'user@host:~$ ');

      clock.tick(2100);

      expect(callback.called).to.be.false;
    });

    it('uses custom prompt pattern from config', () => {
      const callback = sinon.stub();
      // Pattern for zsh: ends with %
      const detector = new PromptDetector('%\\s*$', callback);

      detector.recordOutput('t1', 'lots of command output here\n');
      detector.recordOutput('t1', 'more output lines\n');
      detector.recordOutput('t1', 'user@host % ');

      clock.tick(2100);

      expect(callback.calledOnce).to.be.true;
      expect(callback.calledWith('t1')).to.be.true;
    });

    it('default pattern matches "$ " at end of line', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector('\\$\\s*$', callback);

      // Enough output to exceed threshold
      detector.recordOutput('t1', 'a'.repeat(60) + '\n');
      detector.recordOutput('t1', '$ ');

      clock.tick(2100);

      expect(callback.calledOnce).to.be.true;
    });
  });

  describe('debounce behavior', () => {
    it('does not fire before debounce period expires', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector('\\$\\s*$', callback);

      detector.recordOutput('t1', 'some output\n');
      detector.recordOutput('t1', '$ ');

      // Only advance 1 second (not enough)
      clock.tick(1000);

      expect(callback.called).to.be.false;
    });

    it('resets debounce timer on new output', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector('\\$\\s*$', callback);

      detector.recordOutput('t1', 'a'.repeat(60) + '\n');
      detector.recordOutput('t1', '$ ');
      clock.tick(1500); // 1.5s in

      // More output resets the timer
      detector.recordOutput('t1', 'b'.repeat(60) + '\n');
      clock.tick(500); // 2s total from first, but only 0.5s from last

      expect(callback.called).to.be.false;

      // Wait for full debounce from last output
      detector.recordOutput('t1', '$ ');
      clock.tick(2100);

      expect(callback.calledOnce).to.be.true;
    });

    it('prevents rapid-fire notifications from repeated empty prompts', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector('\\$\\s*$', callback);

      // Mashing enter on empty prompt - each prompt is small output
      detector.recordOutput('t1', '$ ');
      clock.tick(2100);
      expect(callback.called).to.be.false;

      detector.recordOutput('t1', '$ ');
      clock.tick(2100);
      expect(callback.called).to.be.false;

      detector.recordOutput('t1', '$ ');
      clock.tick(2100);
      expect(callback.called).to.be.false;
    });
  });

  describe('ANSI stripping', () => {
    it('strips ANSI escape sequences before matching prompt', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector('\\$\\s*$', callback);

      // Substantial output
      detector.recordOutput('t1', 'building project...\ncompleted\n');
      // Prompt with ANSI color codes
      detector.recordOutput('t1', '\x1b[32muser@host\x1b[0m:\x1b[34m~\x1b[0m$ ');

      clock.tick(2100);

      expect(callback.calledOnce).to.be.true;
    });
  });

  describe('multi-terminal tracking', () => {
    it('tracks multiple terminals independently', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector('\\$\\s*$', callback);

      // Terminal 1 has substantial output (>50 bytes)
      detector.recordOutput('t1', 'a'.repeat(60) + '\n');
      detector.recordOutput('t1', '$ ');

      // Terminal 2 has no substantial output
      detector.recordOutput('t2', '$ ');

      clock.tick(2100);

      // Only t1 should fire
      expect(callback.calledOnce).to.be.true;
      expect(callback.calledWith('t1')).to.be.true;
    });

    it('fires for each terminal that completes a task', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector('\\$\\s*$', callback);

      detector.recordOutput('t1', 'a'.repeat(60) + '\n');
      detector.recordOutput('t1', '$ ');
      detector.recordOutput('t2', 'b'.repeat(60) + '\n');
      detector.recordOutput('t2', '$ ');

      clock.tick(2100);

      expect(callback.calledTwice).to.be.true;
      expect(callback.calledWith('t1')).to.be.true;
      expect(callback.calledWith('t2')).to.be.true;
    });
  });

  describe('removeTerminal', () => {
    it('cleans up terminal state and timers', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector('\\$\\s*$', callback);

      detector.recordOutput('t1', 'some output\n');
      detector.recordOutput('t1', '$ ');
      detector.removeTerminal('t1');

      clock.tick(2100);

      // Timer was cleared, no callback
      expect(callback.called).to.be.false;
    });
  });

  describe('state reset after task_complete', () => {
    it('resets output counter after firing so next empty prompt does not fire', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector('\\$\\s*$', callback);

      // First command completes (>50 bytes of output)
      detector.recordOutput('t1', 'a'.repeat(60) + '\n');
      detector.recordOutput('t1', '$ ');
      clock.tick(2100);
      expect(callback.calledOnce).to.be.true;

      // User hits enter on empty prompt - should not fire again
      callback.resetHistory();
      detector.recordOutput('t1', '$ ');
      clock.tick(2100);
      expect(callback.called).to.be.false;
    });

    it('fires again after a new command produces output', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector('\\$\\s*$', callback);

      // First command (>50 bytes)
      detector.recordOutput('t1', 'a'.repeat(60) + '\n');
      detector.recordOutput('t1', '$ ');
      clock.tick(2100);
      expect(callback.calledOnce).to.be.true;

      // Second command (>50 bytes)
      callback.resetHistory();
      detector.recordOutput('t1', 'b'.repeat(60) + '\n');
      detector.recordOutput('t1', '$ ');
      clock.tick(2100);
      expect(callback.calledOnce).to.be.true;
    });
  });
});
