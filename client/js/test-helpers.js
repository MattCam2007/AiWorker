const sinon = require('sinon');

class MockTerminal {
  constructor(opts) {
    this.options = opts || {};
    this._onDataCallbacks = [];
    this._onResizeCallbacks = [];
    this.open = sinon.stub();
    this.write = sinon.stub();
    this.loadAddon = sinon.stub();
    this.dispose = sinon.stub();
    this.onData = sinon.stub().callsFake((cb) => {
      this._onDataCallbacks.push(cb);
      return { dispose: sinon.stub() };
    });
    this.onResize = sinon.stub().callsFake((cb) => {
      this._onResizeCallbacks.push(cb);
      return { dispose: sinon.stub() };
    });
    this.onSelectionChange = sinon.stub().returns({ dispose: sinon.stub() });
    this.getSelection = sinon.stub().returns('');
    this.hasSelection = sinon.stub().returns(false);
    this.cols = 80;
    this.rows = 24;
  }
}

class MockFitAddon {
  constructor() {
    this.fit = sinon.stub();
    this.proposeDimensions = sinon.stub().returns({ cols: 80, rows: 24 });
  }
}

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this._sent = [];
    this._listeners = {};
    this.readyState = MockWebSocket.CONNECTING;

    // Auto-open via setTimeout
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this._emit('open', {});
    }, 0);
  }

  send(data) {
    this._sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this._emit('close', { code: 1000 });
  }

  addEventListener(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
  }

  removeEventListener(event, handler) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter((h) => h !== handler);
  }

  _emit(event, data) {
    const handlers = this._listeners[event] || [];
    for (const h of handlers) {
      h(data);
    }
  }

  _receive(msg) {
    const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
    this._emit('message', { data });
  }
}

MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

module.exports = { MockTerminal, MockFitAddon, MockWebSocket };
