const { expect } = require('chai');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');
const { MockTerminal, MockFitAddon, MockWebSocket } = require('./test-helpers');

describe('TerminalConnection', function () {
  let dom, window, cleanup;

  function setup() {
    dom = new JSDOM('<!DOCTYPE html><html><body><div id="mount"></div></body></html>', {
      url: 'http://localhost:3000'
    });
    window = dom.window;

    // Set globals for the IIFE
    global.window = window;
    global.document = window.document;
    global.WebSocket = MockWebSocket;

    // Attach mock constructors to window
    window.Terminal = function (opts) {
      var t = new MockTerminal(opts);
      window._lastTerminal = t;
      return t;
    };
    window.FitAddon = {
      FitAddon: function () {
        var f = new MockFitAddon();
        window._lastFitAddon = f;
        return f;
      }
    };
    window.WebSocket = MockWebSocket;

    global.requestAnimationFrame = function (cb) {
      cb();
    };

    // Clear module cache and load terminal.js
    delete require.cache[require.resolve('./terminal')];
    require('./terminal');
  }

  beforeEach(function () {
    setup();
  });

  afterEach(function () {
    delete global.window;
    delete global.document;
    delete global.WebSocket;
    delete global.requestAnimationFrame;
    sinon.restore();
  });

  it('TerminalConnection exists on window.TerminalDeck namespace', function () {
    expect(window.TerminalDeck).to.exist;
    expect(window.TerminalDeck.TerminalConnection).to.be.a('function');
  });

  it('constructor stores terminal ID and config', function () {
    var config = { theme: { defaultColor: '#00ff00' } };
    var tc = new window.TerminalDeck.TerminalConnection('test1', config);
    expect(tc.id).to.equal('test1');
    expect(tc.config).to.deep.equal(config);
  });

  it('attach() creates xterm Terminal with theme settings from config', function (done) {
    var config = {
      theme: {
        fontFamily: 'JetBrains Mono',
        fontSize: 16,
        defaultColor: '#00ff00',
        background: '#111111'
      }
    };
    var tc = new window.TerminalDeck.TerminalConnection('t1', config);
    var el = window.document.getElementById('mount');
    tc.attach(el);

    expect(window._lastTerminal).to.exist;
    expect(window._lastTerminal.options.fontFamily).to.equal('JetBrains Mono');
    expect(window._lastTerminal.options.fontSize).to.equal(16);
    expect(window._lastTerminal.options.theme.foreground).to.equal('#00ff00');
    expect(window._lastTerminal.options.theme.background).to.equal('#111111');

    // Cleanup after WS opens
    setTimeout(function () {
      tc.destroy();
      done();
    }, 10);
  });

  it('attach() loads FitAddon into the terminal', function (done) {
    var tc = new window.TerminalDeck.TerminalConnection('t2', {});
    var el = window.document.getElementById('mount');
    tc.attach(el);

    expect(window._lastTerminal.loadAddon.calledOnce).to.be.true;
    expect(window._lastFitAddon).to.exist;

    setTimeout(function () {
      tc.destroy();
      done();
    }, 10);
  });

  it('attach() calls terminal.open(element) and fitAddon.fit()', function (done) {
    var tc = new window.TerminalDeck.TerminalConnection('t3', {});
    var el = window.document.getElementById('mount');
    tc.attach(el);

    expect(window._lastTerminal.open.calledOnce).to.be.true;
    expect(window._lastTerminal.open.firstCall.args[0]).to.equal(el);
    expect(window._lastFitAddon.fit.calledOnce).to.be.true;

    setTimeout(function () {
      tc.destroy();
      done();
    }, 10);
  });

  it('attach() uses double-rAF to defer fit until after a full render cycle', function (done) {
    // Collect rAF callbacks instead of executing them synchronously
    var rafCallbacks = [];
    global.requestAnimationFrame = function (cb) {
      rafCallbacks.push(cb);
    };

    var tc = new window.TerminalDeck.TerminalConnection('dblraf-test', {});
    var el = window.document.getElementById('mount');
    tc.attach(el);

    var fitAddon = window._lastFitAddon;
    fitAddon.fit.resetHistory();

    // First rAF should schedule the inner rAF, NOT call fit yet
    expect(rafCallbacks.length).to.equal(1);
    rafCallbacks.shift()();
    expect(fitAddon.fit.callCount).to.equal(0);

    // Second (inner) rAF should call fit
    expect(rafCallbacks.length).to.equal(1);
    rafCallbacks.shift()();
    expect(fitAddon.fit.callCount).to.equal(1);

    // No more rAFs queued
    expect(rafCallbacks.length).to.equal(0);

    setTimeout(function () {
      tc.destroy();
      done();
    }, 150);
  });

  it('attach() opens WebSocket to correct URL', function (done) {
    var tc = new window.TerminalDeck.TerminalConnection('myterm', {});
    var el = window.document.getElementById('mount');
    tc.attach(el);

    expect(tc._ws).to.exist;
    expect(tc._ws.url).to.equal('ws://localhost:3000/ws/terminal/myterm');

    setTimeout(function () {
      tc.destroy();
      done();
    }, 10);
  });

  it('attach() sends resize message on WS open', function (done) {
    var tc = new window.TerminalDeck.TerminalConnection('t4', {});
    var el = window.document.getElementById('mount');
    tc.attach(el);

    // Wait for WS to auto-open
    setTimeout(function () {
      var found = tc._ws._sent.some(function (msg) {
        var parsed = JSON.parse(msg);
        return parsed.type === 'resize' && parsed.cols && parsed.rows;
      });
      expect(found).to.be.true;
      tc.destroy();
      done();
    }, 10);
  });

  it('terminal onData callback sends input message over WS', function (done) {
    var tc = new window.TerminalDeck.TerminalConnection('t5', {});
    var el = window.document.getElementById('mount');
    tc.attach(el);

    // Wait for WS to open, then simulate terminal input
    setTimeout(function () {
      var onDataCb = window._lastTerminal._onDataCallbacks[0];
      expect(onDataCb).to.be.a('function');
      onDataCb('hello');

      var found = tc._ws._sent.some(function (msg) {
        var parsed = JSON.parse(msg);
        return parsed.type === 'input' && parsed.data === 'hello';
      });
      expect(found).to.be.true;
      tc.destroy();
      done();
    }, 10);
  });

  it('incoming output message writes to xterm instance', function (done) {
    var tc = new window.TerminalDeck.TerminalConnection('t6', {});
    var el = window.document.getElementById('mount');
    tc.attach(el);

    setTimeout(function () {
      tc._ws._receive({ type: 'output', data: 'hello world' });
      expect(window._lastTerminal.write.calledWith('hello world')).to.be.true;
      tc.destroy();
      done();
    }, 10);
  });

  it('detach() disposes terminal and closes WebSocket', function (done) {
    var tc = new window.TerminalDeck.TerminalConnection('t9', {});
    var el = window.document.getElementById('mount');
    tc.attach(el);

    setTimeout(function () {
      var term = window._lastTerminal;
      var ws = tc._ws;
      tc.detach();

      expect(term.dispose.calledOnce).to.be.true;
      expect(ws.readyState).to.equal(MockWebSocket.CLOSED);
      expect(tc._terminal).to.be.null;
      expect(tc._ws).to.be.null;
      done();
    }, 10);
  });

  it('detach() does NOT trigger reconnection', function (done) {
    var tc = new window.TerminalDeck.TerminalConnection('t10', {});
    var el = window.document.getElementById('mount');
    tc.attach(el);

    setTimeout(function () {
      tc.detach();
      // After detach, _detaching should prevent reconnection
      expect(tc._reconnectTimer).to.be.null;
      done();
    }, 10);
  });

  it('refit() calls fitAddon.fit() and sends resize message', function (done) {
    var tc = new window.TerminalDeck.TerminalConnection('t11', {});
    var el = window.document.getElementById('mount');
    tc.attach(el);

    setTimeout(function () {
      // Reset call counts
      window._lastFitAddon.fit.resetHistory();
      tc._ws._sent = [];

      tc.refit();

      expect(window._lastFitAddon.fit.calledOnce).to.be.true;
      var found = tc._ws._sent.some(function (msg) {
        var parsed = JSON.parse(msg);
        return parsed.type === 'resize';
      });
      expect(found).to.be.true;
      tc.destroy();
      done();
    }, 10);
  });

  it('isActive() returns true when WS is OPEN, false when CLOSED', function (done) {
    var tc = new window.TerminalDeck.TerminalConnection('t12', {});
    var el = window.document.getElementById('mount');
    tc.attach(el);

    // Initially WS is CONNECTING
    expect(tc.isActive()).to.be.false;

    setTimeout(function () {
      // Now WS should be OPEN
      expect(tc.isActive()).to.be.true;

      tc.detach();
      expect(tc.isActive()).to.be.false;
      done();
    }, 10);
  });

  it('WS close triggers reconnection with exponential backoff', function (done) {
    var tc = new window.TerminalDeck.TerminalConnection('t14', {});
    var el = window.document.getElementById('mount');
    tc.attach(el);

    setTimeout(function () {
      // Spy on _scheduleReconnect
      var spy = sinon.spy(tc, '_scheduleReconnect');
      tc._ws.close();

      // Should have called _scheduleReconnect
      expect(spy.calledOnce).to.be.true;
      expect(tc._reconnectAttempts).to.equal(1);

      // Clean up
      tc.destroy();
      done();
    }, 10);
  });

  it('destroy() prevents reconnection and performs full cleanup', function (done) {
    var tc = new window.TerminalDeck.TerminalConnection('t15', {});
    var el = window.document.getElementById('mount');
    tc.attach(el);

    setTimeout(function () {
      tc.destroy();

      expect(tc._destroyed).to.be.true;
      expect(tc._terminal).to.be.null;
      expect(tc._ws).to.be.null;
      expect(tc._reconnectTimer).to.be.null;
      done();
    }, 10);
  });
});
