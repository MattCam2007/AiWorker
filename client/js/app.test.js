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
      shell: '/bin/bash'
    }
  };

  var testSessions = [
    { id: 't1', name: 'Terminal 1', active: true },
    { id: 't2', name: 'Terminal 2', active: true }
  ];

  function setupDOM() {
    dom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body>' +
        '<header id="header">' +
        '<span class="title">TerminalDeck</span>' +
        '<div id="grid-presets"></div>' +
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

    // fetch returns config on first call, sessions on second
    var callCount = 0;
    global.fetch = sinon.stub().callsFake(function (url) {
      if (url === '/api/config') {
        return Promise.resolve({ json: () => Promise.resolve(testConfig) });
      }
      if (url === '/api/sessions') {
        return Promise.resolve({ json: () => Promise.resolve(testSessions) });
      }
      return Promise.resolve({ json: () => Promise.resolve({}) });
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
      this._cells = [];
      this._cellMap = new Map();
      this.setGrid = sinon.stub().callsFake(function (spec) {
        // Create mock cells based on spec
        var parts = spec.split('x');
        var total = parseInt(parts[0]) * parseInt(parts[1]);
        this._cells = [];
        this._cellMap = new Map();
        for (var i = 0; i < total; i++) {
          var cell = {};
          this._cells.push(cell);
          this._cellMap.set(cell, { connection: null, terminalId: null });
        }
      });
      this.applyLayout = sinon.stub();
      this.refitAll = sinon.stub();
      this.assignTerminal = sinon.stub().callsFake(function (cell, id, conn) {
        this._cellMap.set(cell, { connection: conn, terminalId: id });
      });
      this._addToStrip = sinon.stub();
      this._removeFromStrip = sinon.stub();
      this._removeFromGrid = sinon.stub();
      this.updateHeader = sinon.stub();
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

  it('init() fetches /api/config and /api/sessions', function () {
    var app = new App();
    return app.init().then(function () {
      expect(global.fetch.calledWith('/api/config')).to.be.true;
      expect(global.fetch.calledWith('/api/sessions')).to.be.true;
    });
  });

  it('init() creates TerminalConnection for each session', function () {
    var app = new App();
    return app.init().then(function () {
      expect(Object.keys(app._connections)).to.have.length(2);
      expect(app._connections.t1).to.exist;
      expect(app._connections.t2).to.exist;
    });
  });

  it('init() creates LayoutEngine and sets default 2x2 grid', function () {
    var app = new App();
    return app.init().then(function () {
      expect(app._engine).to.exist;
      expect(app._engine.setGrid.calledWith('2x2')).to.be.true;
    });
  });

  it('init() connects control WebSocket to /ws/control', function () {
    var app = new App();
    return app.init().then(function () {
      expect(app._controlWs).to.exist;
      expect(app._controlWs.url).to.equal('ws://localhost:3000/ws/control');
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

  it('preset button click calls engine.setGrid() with correct preset', function () {
    var app = new App();
    return app.init().then(function () {
      var btn = document.querySelector('#grid-presets .preset-btn[data-preset="2x2"]');
      btn.click();
      // setGrid is called once during init (2x2) and once on click
      expect(app._engine.setGrid.calledWith('2x2')).to.be.true;
    });
  });

  it('"+" button click shows create terminal dialog', function () {
    var app = new App();
    return app.init().then(function () {
      var addBtn = document.getElementById('add-terminal-btn');
      var dialog = document.getElementById('ephemeral-dialog');
      expect(dialog.classList.contains('hidden')).to.be.true;

      addBtn.click();
      expect(dialog.classList.contains('hidden')).to.be.false;
    });
  });

  it('create button sends create_terminal message via control WS', function () {
    var app = new App();
    return app.init().then(function () {
      // Wait for control WS to open
      return new Promise(function (resolve) { setTimeout(resolve, 10); });
    }).then(function () {
      var nameInput = document.querySelector('.ephemeral-name');
      var cmdInput = document.querySelector('.ephemeral-command');
      nameInput.value = 'Test Terminal';
      cmdInput.value = 'htop';

      document.querySelector('.ephemeral-create').click();

      var sent = app._controlWs._sent;
      expect(sent.length).to.be.greaterThan(0);
      var msg = JSON.parse(sent[sent.length - 1]);
      expect(msg.type).to.equal('create_terminal');
      expect(msg.name).to.equal('Test Terminal');
      expect(msg.command).to.equal('htop');
    });
  });

  it('_sendDestroyTerminal sends destroy_terminal via control WS', function () {
    var app = new App();
    return app.init().then(function () {
      return new Promise(function (resolve) { setTimeout(resolve, 10); });
    }).then(function () {
      app._sendDestroyTerminal('some-id');

      var sent = app._controlWs._sent;
      var msg = JSON.parse(sent[sent.length - 1]);
      expect(msg.type).to.equal('destroy_terminal');
      expect(msg.id).to.equal('some-id');
    });
  });

  it('_handleSessionsUpdate() creates connections for new sessions', function () {
    var app = new App();
    return app.init().then(function () {
      var sessions = [
        { id: 't1', name: 'Terminal 1' },
        { id: 't2', name: 'Terminal 2' },
        { id: 't3', name: 'New Session' }
      ];

      app._handleSessionsUpdate(sessions);

      expect(app._connections['t3']).to.exist;
    });
  });

  it('_handleSessionsUpdate() destroys connections for removed sessions', function () {
    var app = new App();
    return app.init().then(function () {
      // Sessions without t2
      var sessions = [
        { id: 't1', name: 'Terminal 1' }
      ];

      app._handleSessionsUpdate(sessions);

      expect(app._connections['t2']).to.not.exist;
    });
  });

  it('_handleConfigReload() applies updated theme', function () {
    var app = new App();
    return app.init().then(function () {
      var newConfig = {
        settings: {
          theme: {
            defaultColor: '#ff0000',
            background: '#111111',
            fontFamily: 'monospace',
            fontSize: 16
          },
          shell: '/bin/bash'
        }
      };

      app._handleConfigReload(newConfig);

      var root = document.documentElement;
      expect(root.style.getPropertyValue('--td-color')).to.equal('#ff0000');
      expect(root.style.getPropertyValue('--td-bg')).to.equal('#111111');
    });
  });

  it('control WS message dispatches sessions update', function () {
    var app = new App();
    return app.init().then(function () {
      return new Promise(function (resolve) { setTimeout(resolve, 10); });
    }).then(function () {
      // Simulate sessions message from control WS
      app._controlWs._receive({
        type: 'sessions',
        sessions: [
          { id: 't1', name: 'Terminal 1' },
          { id: 't2', name: 'Terminal 2' },
          { id: 't3', name: 'New' }
        ]
      });

      expect(app._connections['t3']).to.exist;
    });
  });

  it('control WS message dispatches config reload', function () {
    var app = new App();
    return app.init().then(function () {
      return new Promise(function (resolve) { setTimeout(resolve, 10); });
    }).then(function () {
      app._controlWs._receive({
        type: 'config_reload',
        config: {
          settings: {
            theme: { defaultColor: '#0000ff', background: '#222', fontFamily: 'mono', fontSize: 12 },
            shell: '/bin/zsh'
          }
        }
      });

      var root = document.documentElement;
      expect(root.style.getPropertyValue('--td-color')).to.equal('#0000ff');
    });
  });

  it('_handleActivity() updates strip status dot and triggers pulse', function () {
    var app = new App();
    return app.init().then(function () {
      app._engine._stripItems.set('t1', {
        element: (function () {
          var el = document.createElement('div');
          el.className = 'strip-item';
          var dot = document.createElement('span');
          dot.className = 'strip-status';
          el.appendChild(dot);
          return el;
        })()
      });

      var activityMsg = {
        statuses: { t1: true, t2: false }
      };

      app._handleActivity(activityMsg);

      var dot = app._engine._stripItems.get('t1').element.querySelector('.strip-status');
      expect(dot.classList.contains('status-active')).to.be.true;
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

  it('engine._onCloseTerminal is wired to _sendDestroyTerminal', function () {
    var app = new App();
    return app.init().then(function () {
      return new Promise(function (resolve) { setTimeout(resolve, 10); });
    }).then(function () {
      expect(app._engine._onCloseTerminal).to.be.a('function');

      app._engine._onCloseTerminal('test-id');

      var sent = app._controlWs._sent;
      var msg = JSON.parse(sent[sent.length - 1]);
      expect(msg.type).to.equal('destroy_terminal');
      expect(msg.id).to.equal('test-id');
    });
  });

  it('_handleSessionsUpdate() calls refitAll after rAF', function () {
    var rafCallbacks = [];
    global.requestAnimationFrame = function (cb) {
      rafCallbacks.push(cb);
    };

    var app = new App();
    return app.init().then(function () {
      var callsBefore = app._engine.refitAll.callCount;

      app._handleSessionsUpdate([
        { id: 't1', name: 'Terminal 1' },
        { id: 't2', name: 'Terminal 2' },
        { id: 't3', name: 'New' }
      ]);

      // Drain all rAF callbacks (double-rAF means outer callbacks schedule inner ones)
      while (rafCallbacks.length > 0) { rafCallbacks.shift()(); }

      expect(app._engine.refitAll.callCount).to.be.greaterThan(callsBefore);
    });
  });

  it('_applySessions() calls refitAll after rAF', function () {
    var rafCallbacks = [];
    global.requestAnimationFrame = function (cb) {
      rafCallbacks.push(cb);
    };

    var app = new App();
    return app.init().then(function () {
      // refitAll should not have been called yet (rAF is deferred)
      var callsBefore = app._engine.refitAll.callCount;

      // Drain all rAF callbacks (double-rAF means outer callbacks schedule inner ones)
      while (rafCallbacks.length > 0) { rafCallbacks.shift()(); }

      expect(app._engine.refitAll.callCount).to.be.greaterThan(callsBefore);
    });
  });

  it('_sendUpdateTerminal sends update_terminal via control WS', function () {
    var app = new App();
    return app.init().then(function () {
      return new Promise(function (resolve) { setTimeout(resolve, 10); });
    }).then(function () {
      app._sendUpdateTerminal('some-id', 'New Name', '#ff0000', '#ffffff');

      var sent = app._controlWs._sent;
      var msg = JSON.parse(sent[sent.length - 1]);
      expect(msg.type).to.equal('update_terminal');
      expect(msg.id).to.equal('some-id');
      expect(msg.name).to.equal('New Name');
      expect(msg.headerBg).to.equal('#ff0000');
      expect(msg.headerColor).to.equal('#ffffff');
    });
  });

  it('engine._onUpdateTerminal is wired to _sendUpdateTerminal', function () {
    var app = new App();
    return app.init().then(function () {
      return new Promise(function (resolve) { setTimeout(resolve, 10); });
    }).then(function () {
      expect(app._engine._onUpdateTerminal).to.be.a('function');

      app._engine._onUpdateTerminal('test-id', 'Name', '#000', '#fff');

      var sent = app._controlWs._sent;
      var msg = JSON.parse(sent[sent.length - 1]);
      expect(msg.type).to.equal('update_terminal');
      expect(msg.id).to.equal('test-id');
    });
  });

  it('_handleSessionsUpdate() propagates name and color changes to existing sessions', function () {
    var app = new App();
    return app.init().then(function () {
      var sessions = [
        { id: 't1', name: 'Renamed', headerBg: '#ff0000', headerColor: '#ffffff' },
        { id: 't2', name: 'Terminal 2' }
      ];

      app._handleSessionsUpdate(sessions);

      expect(app._connections['t1'].config.name).to.equal('Renamed');
      expect(app._connections['t1'].config.headerBg).to.equal('#ff0000');
      expect(app._connections['t1'].config.headerColor).to.equal('#ffffff');
    });
  });

  it('_createConnection() passes headerBg and headerColor to config', function () {
    var app = new App();
    return app.init().then(function () {
      var conn = app._createConnection('test', 'Test', '#123456', '#abcdef');
      expect(conn.config.headerBg).to.equal('#123456');
      expect(conn.config.headerColor).to.equal('#abcdef');
    });
  });

  it('shows empty state when no sessions exist', function () {
    // Override fetch to return empty sessions
    global.fetch = sinon.stub().callsFake(function (url) {
      if (url === '/api/config') {
        return Promise.resolve({ json: () => Promise.resolve(testConfig) });
      }
      if (url === '/api/sessions') {
        return Promise.resolve({ json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ json: () => Promise.resolve({}) });
    });

    var app = new App();
    return app.init().then(function () {
      var grid = document.getElementById('grid-container');
      var emptyState = grid.querySelector('.empty-state');
      expect(emptyState).to.exist;
      expect(emptyState.textContent).to.include('No terminals');
    });
  });
});
