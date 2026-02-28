const { expect } = require('chai');
const sinon = require('sinon');
const { PromptDetector, visibleLength } = require('./prompt-detector');

describe('PromptDetector', () => {
  let clock;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
  });

  describe('visibleLength', () => {
    it('counts printable characters only', () => {
      expect(visibleLength('hello world')).to.equal(11);
    });

    it('strips CSI sequences', () => {
      expect(visibleLength('\x1b[32mhello\x1b[0m')).to.equal(5);
    });

    it('strips private mode sequences', () => {
      expect(visibleLength('$ \x1b[?2004h')).to.equal(2);
    });

    it('strips OSC sequences', () => {
      expect(visibleLength('\x1b]0;window title\x07hello')).to.equal(5);
    });

    it('strips control characters', () => {
      expect(visibleLength('line1\r\nline2\n')).to.equal(10);
    });

    it('returns near-zero for a tmux status bar redraw', () => {
      // Typical status bar: mostly cursor positioning + a small label
      const statusRedraw = '\x1b[24;1H\x1b[42m\x1b[30m[0] 0:bash*\x1b[0m\x1b[24;80H\x1b[1;1H';
      expect(visibleLength(statusRedraw)).to.be.below(80);
    });
  });

  describe('task completion detection', () => {
    it('fires task_complete after substantial visible output followed by silence', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordOutput('t1', 'This is a real response with plenty of visible text.\n');
      detector.recordOutput('t1', 'It spans multiple lines and has real content.\n');

      clock.tick(2100);

      expect(callback.calledOnce).to.be.true;
      expect(callback.calledWith('t1')).to.be.true;
    });

    it('does not fire for escape-heavy output with little visible content', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      // Simulate tmux status bar redraw — lots of bytes, minimal visible text
      detector.recordOutput('t1', '\x1b[24;1H\x1b[42m\x1b[30m[0] 0:bash*\x1b[0m\x1b[24;80H\x1b[1;1H');

      clock.tick(2100);

      expect(callback.called).to.be.false;
    });

    it('does not fire when visible output is below threshold', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordOutput('t1', '$ ');

      clock.tick(2100);

      expect(callback.called).to.be.false;
    });
  });

  describe('BEL detection', () => {
    it('fires immediately when BEL character is detected', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      // BEL fires immediately — no debounce needed
      detector.recordOutput('t1', 'some output\x07');

      expect(callback.calledOnce).to.be.true;
      expect(callback.calledWith('t1')).to.be.true;
    });

    it('fires every BEL with no cooldown', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordOutput('t1', '\x07');
      expect(callback.calledOnce).to.be.true;

      // Second BEL immediately — should still fire
      callback.resetHistory();
      detector.recordOutput('t1', '\x07');
      expect(callback.calledOnce).to.be.true;
    });

    it('BEL is not suppressed by input or resize', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      // User just typed and terminal just resized
      detector.recordInput('t1');
      detector.recordResize('t1');

      // BEL should still fire — it's an explicit signal
      detector.recordOutput('t1', '\x07');
      expect(callback.calledOnce).to.be.true;
    });

    it('does not fire for BEL inside OSC sequences', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      // OSC sequence uses BEL as terminator — should not trigger
      detector.recordOutput('t1', '\x1b]0;window title\x07');

      expect(callback.called).to.be.false;
    });
  });

  describe('input suppression', () => {
    it('does not fire when output is echo from user typing', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      for (let i = 0; i < 100; i++) {
        detector.recordInput('t1');
        clock.tick(50);
        detector.recordOutput('t1', 'a');
      }

      clock.tick(2100);

      expect(callback.called).to.be.false;
    });

    it('resets visible counter on user input', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordOutput('t1', 'a'.repeat(40));

      detector.recordInput('t1');
      clock.tick(600);
      detector.recordOutput('t1', 'x'.repeat(20));

      clock.tick(2100);

      expect(callback.called).to.be.false;
    });

    it('fires after user runs a command (input then substantial output)', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordInput('t1');

      clock.tick(600);
      detector.recordOutput('t1', 'a'.repeat(200));

      clock.tick(2100);

      expect(callback.calledOnce).to.be.true;
    });
  });

  describe('resize suppression', () => {
    it('ignores output shortly after a resize (terminal redraw)', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordResize('t1');

      clock.tick(100);
      detector.recordOutput('t1', 'a'.repeat(500));

      clock.tick(2100);

      expect(callback.called).to.be.false;
    });

    it('fires for output well after a resize', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordResize('t1');

      clock.tick(1600);
      detector.recordOutput('t1', 'a'.repeat(200));

      clock.tick(2100);

      expect(callback.calledOnce).to.be.true;
    });
  });

  describe('cooldown', () => {
    it('does not double-ding if output pauses mid-stream then resumes', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordOutput('t1', 'a'.repeat(200));

      clock.tick(2100);
      expect(callback.calledOnce).to.be.true;

      callback.resetHistory();
      detector.recordOutput('t1', 'b'.repeat(200));

      clock.tick(2100);
      expect(callback.called).to.be.false;
    });

    it('fires again after cooldown period expires', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordOutput('t1', 'a'.repeat(200));
      clock.tick(2100);
      expect(callback.calledOnce).to.be.true;

      callback.resetHistory();
      clock.tick(5000);

      detector.recordOutput('t1', 'b'.repeat(200));
      clock.tick(2100);
      expect(callback.calledOnce).to.be.true;
    });
  });

  describe('debounce behavior', () => {
    it('does not fire before debounce period expires', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordOutput('t1', 'a'.repeat(100));

      clock.tick(1000);

      expect(callback.called).to.be.false;
    });

    it('resets debounce timer on new output', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordOutput('t1', 'a'.repeat(100));
      clock.tick(1500);

      detector.recordOutput('t1', 'b'.repeat(100));
      clock.tick(500);

      expect(callback.called).to.be.false;

      clock.tick(1600);

      expect(callback.calledOnce).to.be.true;
    });
  });

  describe('multi-terminal tracking', () => {
    it('tracks multiple terminals independently', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordOutput('t1', 'a'.repeat(100));
      detector.recordOutput('t2', '$ ');

      clock.tick(2100);

      expect(callback.calledOnce).to.be.true;
      expect(callback.calledWith('t1')).to.be.true;
    });

    it('fires for each terminal that completes a task', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordOutput('t1', 'a'.repeat(100));
      detector.recordOutput('t2', 'b'.repeat(100));

      clock.tick(2100);

      expect(callback.calledTwice).to.be.true;
      expect(callback.calledWith('t1')).to.be.true;
      expect(callback.calledWith('t2')).to.be.true;
    });
  });

  describe('removeTerminal', () => {
    it('cleans up terminal state and timers', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordOutput('t1', 'a'.repeat(100));
      detector.removeTerminal('t1');

      clock.tick(2100);

      expect(callback.called).to.be.false;
    });
  });

  describe('state reset after task_complete', () => {
    it('resets visible counter after firing so small follow-up does not fire', () => {
      const callback = sinon.stub();
      const detector = new PromptDetector(callback);

      detector.recordOutput('t1', 'a'.repeat(100));
      clock.tick(2100);
      expect(callback.calledOnce).to.be.true;

      callback.resetHistory();
      clock.tick(5000);

      detector.recordOutput('t1', '$ ');
      clock.tick(2100);
      expect(callback.called).to.be.false;
    });
  });
});
