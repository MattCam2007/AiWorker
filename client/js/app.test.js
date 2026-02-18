const { expect } = require('chai');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');
const { MockWebSocket } = require('./test-helpers');

describe('App', function () {
  let dom, window, App;

  var testConfig = {
    settings: {
      theme: {
        defaultColor: '#33ff33',
        background: '#0a0a0a',
        fontFamily: 'Fira Code, monospace',
        fontSize: 14
      },
      shell: '/bin/bash',
      defaultLayout: 'dev'
    },
    terminals: [
      { id: 't1', name: 'Terminal 1', autoStart: true },
      { id: 't2', name: 'Terminal 2', autoStart: true }
    ],
    layouts: {
      dev: { grid: '2x1', cells: [['t1', 't2']] },
      focus: { grid: '1x1', cells: [['t1']] }
    }
  };

  function setupDOM() {
    dom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body>' +
        '<header id="header">' +
        '<span class="title">TerminalDeck</span>' +
        '<div id="grid-presets"></div>' +
        '<div id="named-layouts"></div>' +
        '<div class="spacer"></div>' +
        '<button id="add-terminal-btn">+</button>' +
        '<div id="connection-status" class="status-indicator"></div>' +
        '</header>' +
        '<main id="grid-container"></main>' +
        '<div id="minimized-strip"></div>' +
        '<div id="fullscreen-overlay" class="hidden">' +
        '<button class="fullscreen-close"></button>' +
        '<div class="fullscreen-terminal"></div>' +
        '</div>' +
        '<div id="ephemeral-dialog" class="hidden">' +
        '<input class="ephemeral-name" />' +
        '<input class="ephemeral-command" />' +
        '<button class="ephemeral-create">Create</button>' +
        '<button class="ephemeral-cancel">Cancel</button>' +
        '</div>' +
        '</body></html>',
      { url: 'http://localhost:3000' }
    );
    window = dom.window;

    global.window = window;
    global.document = window.document;
    global.WebSocket = MockWebSocket;
    global.fetch = sinon.stub().resolves({
      json: sinon.stub().resolves(testConfig)
    });
    global.ResizeObserver = undefined;
    global.requestAnimationFrame = function (cb) {
      cb();
    };

    // Prevent auto-init on DOMContentLoaded
    window.TerminalDeck = window.TerminalDeck || {};
    window.TerminalDeck._noAutoInit = true;

    // Stub TerminalConnection
    window.TerminalDeck.TerminalConnection = function (id, config) {
      this.id = id;
      this.config = config;
      this._ws = null;
      this._onActivity = null;
      this._onStatusChange = null;
      this._onSessions = null;
      this._onConfigReload = null;
      this.attach = sinon.stub();
      this.detach = sinon.stub();
      this.refit = sinon.stub();
      this.isActive = sinon.stub().returns(false);
      this.getLastOutput = sinon.stub().returns('');
      this.destroy = sinon.stub();
    };

    // Stub LayoutEngine
    window.TerminalDeck.LayoutEngine = function (grid, strip) {
      this._gridContainer = grid;
      this._stripContainer = strip;
      this._stripItems = new Map();
      this.setGrid = sinon.stub();
      this.applyLayout = sinon.stub();
      this.refitAll = sinon.stub();
      this._addToStrip = sinon.stub();
      this._removeFromStrip = sinon.stub();
    };
    window.TerminalDeck.LayoutEngine.GRID_PRESETS = {
      '1x1': { cols: 1, rows: 1 },
      '2x1': { cols: 2, rows: 1 },
      '1x2': { cols: 1, rows: 2 },
      '2x2': { cols: 2, rows: 2 },
      '2x3': { cols: 2, rows: 3 },
      '3x2': { cols: 3, rows: 2 },
      '3x1': { cols: 3, rows: 1 },
      '1x3': { cols: 1, rows: 3 }
    };

    delete require.cache[require.resolve('./app')];
    require('./app');

    App = window.TerminalDeck.App;
  }

  beforeEach(function () {
    setupDOM();
  });

  afterEach(function () {
    delete global.window;
    delete global.document;
    delete global.WebSocket;
    delete global.fetch;
    delete global.ResizeObserver;
    delete global.requestAnimationFrame;
    sinon.restore();
  });

  it('App exists on window.TerminalDeck namespace', function () {
    expect(App).to.be.a('function');
  });

  it('init() fetches /api/config', function () {
    var app = new App();
    return app.init().then(function () {
      expect(global.fetch.calledOnce).to.be.true;
      expect(global.fetch.firstCall.args[0]).to.equal('/api/config');
    });
  });

  it('init() creates TerminalConnection for each configured terminal', function () {
    var app = new App();
    return app.init().then(function () {
      expect(Object.keys(app._connections)).to.have.length(2);
      expect(app._connections.t1).to.exist;
      expect(app._connections.t2).to.exist;
    });
  });

  it('init() creates LayoutEngine and calls applyLayout with default layout', function () {
    var app = new App();
    return app.init().then(function () {
      expect(app._engine).to.exist;
      expect(app._engine.applyLayout.calledOnce).to.be.true;
      var call = app._engine.applyLayout.firstCall;
      expect(call.args[0]).to.deep.equal(testConfig.layouts.dev);
    });
  });

  it('_applyTheme() sets CSS custom properties on document root', function () {
    var app = new App();
    return app.init().then(function () {
      var root = document.documentElement;
      expect(root.style.getPropertyValue('--td-bg')).to.equal('#0a0a0a');
      expect(root.style.getPropertyValue('--td-color')).to.equal('#33ff33');
    });
  });

  it('_buildHeader() creates 8 grid preset buttons', function () {
    var app = new App();
    return app.init().then(function () {
      var btns = document.querySelectorAll('#grid-presets .preset-btn');
      expect(btns.length).to.equal(8);
    });
  });

  it('_buildHeader() creates named layout buttons from config', function () {
    var app = new App();
    return app.init().then(function () {
      var btns = document.querySelectorAll('#named-layouts .layout-btn');
      expect(btns.length).to.equal(2);
      var names = Array.from(btns).map(function (b) {
        return b.textContent;
      });
      expect(names).to.include('dev');
      expect(names).to.include('focus');
    });
  });

  it('preset button click calls engine.setGrid() with correct preset', function () {
    var app = new App();
    return app.init().then(function () {
      var btn = document.querySelector('#grid-presets .preset-btn[data-preset="2x2"]');
      btn.click();
      expect(app._engine.setGrid.calledWith('2x2')).to.be.true;
    });
  });

  it('named layout button click calls engine.applyLayout() with correct layout', function () {
    var app = new App();
    return app.init().then(function () {
      var btn = document.querySelector('#named-layouts .layout-btn[data-layout="focus"]');
      btn.click();
      expect(app._engine.applyLayout.calledWith(testConfig.layouts.focus)).to.be.true;
    });
  });

  it('"+" button click shows ephemeral dialog', function () {
    var app = new App();
    return app.init().then(function () {
      var addBtn = document.getElementById('add-terminal-btn');
      var dialog = document.getElementById('ephemeral-dialog');
      expect(dialog.classList.contains('hidden')).to.be.true;

      addBtn.click();
      expect(dialog.classList.contains('hidden')).to.be.false;
    });
  });

  it('ephemeral create sends create_ephemeral message via WS', function () {
    var app = new App();
    return app.init().then(function () {
      // Give a connection an active WS
      var mockWs = { readyState: 1, send: sinon.stub() };
      app._connections.t1._ws = mockWs;
      app._connections.t1.isActive = sinon.stub().returns(true);

      var nameInput = document.querySelector('.ephemeral-name');
      var cmdInput = document.querySelector('.ephemeral-command');
      nameInput.value = 'Test Ephemeral';
      cmdInput.value = 'htop';

      document.querySelector('.ephemeral-create').click();

      expect(mockWs.send.calledOnce).to.be.true;
      var msg = JSON.parse(mockWs.send.firstCall.args[0]);
      expect(msg.type).to.equal('create_ephemeral');
      expect(msg.name).to.equal('Test Ephemeral');
      expect(msg.command).to.equal('htop');
    });
  });

  it('ephemeral destroy sends destroy_ephemeral message', function () {
    var app = new App();
    return app.init().then(function () {
      var mockWs = { readyState: 1, send: sinon.stub() };
      app._connections.t1._ws = mockWs;
      app._connections.t1.isActive = sinon.stub().returns(true);

      app._sendEphemeralDestroy('ephemeral-123');

      expect(mockWs.send.calledOnce).to.be.true;
      var msg = JSON.parse(mockWs.send.firstCall.args[0]);
      expect(msg.type).to.equal('destroy_ephemeral');
      expect(msg.id).to.equal('ephemeral-123');
    });
  });

  it('_handleSessionsUpdate() creates connections for new ephemeral sessions', function () {
    var app = new App();
    return app.init().then(function () {
      var sessions = [
        { id: 't1', name: 'Terminal 1' },
        { id: 't2', name: 'Terminal 2' },
        { id: 'ephemeral-1', name: 'New Session' }
      ];

      app._handleSessionsUpdate(sessions);

      expect(app._connections['ephemeral-1']).to.exist;
      expect(app._engine._addToStrip.called).to.be.true;
    });
  });

  it('_handleSessionsUpdate() destroys connections for removed sessions', function () {
    var app = new App();
    return app.init().then(function () {
      // Add ephemeral
      app._connections['ephemeral-1'] = new window.TerminalDeck.TerminalConnection('ephemeral-1', {
        name: 'Temp',
        ephemeral: true
      });

      // Sessions without ephemeral-1
      var sessions = [
        { id: 't1', name: 'Terminal 1' },
        { id: 't2', name: 'Terminal 2' }
      ];

      app._handleSessionsUpdate(sessions);

      expect(app._connections['ephemeral-1']).to.not.exist;
    });
  });

  it('connection status reflects aggregate state', function () {
    var app = new App();
    return app.init().then(function () {
      var statusEl = document.getElementById('connection-status');

      // None active
      app._updateStatus();
      expect(statusEl.classList.contains('status-red')).to.be.true;

      // One active
      app._connections.t1.isActive = sinon.stub().returns(true);
      app._updateStatus();
      expect(statusEl.classList.contains('status-yellow')).to.be.true;

      // All active
      app._connections.t2.isActive = sinon.stub().returns(true);
      app._updateStatus();
      expect(statusEl.classList.contains('status-green')).to.be.true;
    });
  });
});
