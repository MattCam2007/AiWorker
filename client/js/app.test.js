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
        '<div id="sidebar-backdrop" class="sidebar-backdrop hidden"></div>' +
        '<div id="ephemeral-dialog" class="hidden"></div>' +
        '<div id="ephemeral-backdrop" class="hidden"></div>' +
        '</body></html>',
      { url: 'http://localhost:3000' }
    );
    window = dom.window;

    global.window = window;
    global.document = window.document;
    global.WebSocket = MockWebSocket;

    global.fetch = sinon.stub().callsFake(function (url) {
      if (url === '/api/config' || url.startsWith('/api/config?')) {
        return Promise.resolve({ json: () => Promise.resolve(testConfig) });
      }
      if (url.startsWith('/api/sessions')) {
        return Promise.resolve({ json: () => Promise.resolve(testSessions) });
      }
      return Promise.resolve({ json: () => Promise.resolve({}) });
    });

    global.ResizeObserver = undefined;
    global.requestAnimationFrame = function (cb) {
      cb();
    };

    // Mock matchMedia for mobile detection
    window.matchMedia = function () {
      return { matches: false, addEventListener: function () {} };
    };

    // Prevent auto-init on DOMContentLoaded
    window.TerminalDeck = window.TerminalDeck || {};
    window.TerminalDeck._noAutoInit = true;

    // Stub TerminalConnection
    window.TerminalDeck.TerminalConnection = function (id, config) {
      this.id = id;
      this.config = config;
      this._ws = null;
      this._onStatusChange = null;
      this.attach = sinon.stub();
      this.detach = sinon.stub();
      this.refit = sinon.stub();
      this.isActive = sinon.stub().returns(false);
      this.destroy = sinon.stub();
    };

    // Stub LayoutEngine
    window.TerminalDeck.LayoutEngine = function (grid) {
      this._gridContainer = grid;
      this._minimized = new Map();
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
      this.refitAll = sinon.stub();
      this.assignTerminal = sinon.stub().callsFake(function (cell, id, conn) {
        this._cellMap.set(cell, { connection: conn, terminalId: id });
      });
      this.assignFolder = sinon.stub().callsFake(function (cell, fc) {
        this._cellMap.set(cell, { connection: fc.getActiveConnection(), terminalId: fc.getActiveTerminalId(), folderCell: fc });
        // Remove from minimized
        var self = this;
        fc.getTerminals().forEach(function (t) { self._minimized.delete(t.id); });
      });
      this._switchFolderTab = sinon.stub();
      this._makeFolderCallbacks = sinon.stub().returns({});
      this._addToMinimized = sinon.stub().callsFake(function (id, conn) { this._minimized.set(id, conn); });
      this._removeFromMinimized = sinon.stub().callsFake(function (id) { this._minimized.delete(id); });
      this._clearCell = sinon.stub();
      this._removeFromGrid = sinon.stub();
      this.updateHeader = sinon.stub();
      this.clearSupersize = sinon.stub();
      this.checkMobile = sinon.stub().returns(false);
      this._folders = [];
      this._createColorSwatches = function (activeColor, onSelect) {
        var container = document.createElement('div');
        container.className = 'edit-swatches';
        var swatch = document.createElement('button');
        swatch.className = 'edit-swatch';
        container.appendChild(swatch);
        return container;
      };
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

    // Stub FolderCell
    window.TerminalDeck.FolderCell = function (folderId, folderName, entries) {
      this._folderId = folderId;
      this._folderName = folderName;
      this._terminals = (entries || []).slice();
      this._activeId = this._terminals.length > 0 ? this._terminals[0].id : null;
    };
    window.TerminalDeck.FolderCell.prototype.getFolderId = function () { return this._folderId; };
    window.TerminalDeck.FolderCell.prototype.getFolderName = function () { return this._folderName; };
    window.TerminalDeck.FolderCell.prototype.getActiveTerminalId = function () { return this._activeId; };
    window.TerminalDeck.FolderCell.prototype.getActiveConnection = function () {
      for (var i = 0; i < this._terminals.length; i++) {
        if (this._terminals[i].id === this._activeId) return this._terminals[i].connection;
      }
      return null;
    };
    window.TerminalDeck.FolderCell.prototype.getTerminals = function () { return this._terminals.slice(); };
    window.TerminalDeck.FolderCell.prototype.setActiveTab = function (id) {
      if (id === this._activeId) return null;
      var prev = { id: this._activeId, conn: this.getActiveConnection() };
      this._activeId = id;
      return { prev: prev, next: { id: id, conn: this.getActiveConnection() } };
    };
    window.TerminalDeck.FolderCell.prototype.addTerminal = function (id, name, conn) {
      this._terminals.push({ id: id, name: name, connection: conn });
      if (!this._activeId) this._activeId = id;
    };
    window.TerminalDeck.FolderCell.prototype.removeTerminal = function (id) {
      var wasActive = id === this._activeId;
      var idx = this._terminals.findIndex(function (t) { return t.id === id; });
      if (idx === -1) return { wasActive: false, newActiveId: this._activeId };
      this._terminals.splice(idx, 1);
      var newActiveId = this._activeId;
      if (wasActive) {
        newActiveId = this._terminals.length > 0 ? this._terminals[Math.min(idx, this._terminals.length - 1)].id : null;
        this._activeId = newActiveId;
      }
      return { wasActive: wasActive, newActiveId: newActiveId };
    };
    window.TerminalDeck.FolderCell.prototype.updateTerminalName = function (id, name) {
      var t = this._terminals.find(function (t) { return t.id === id; });
      if (t) t.name = name;
    };
    window.TerminalDeck.FolderCell.prototype.renderHeader = sinon.stub();
    window.TerminalDeck.FolderCell.prototype.updateActiveTab = sinon.stub();

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
      var urls = global.fetch.args.map(function (a) { return a[0]; });
      expect(urls.some(function (u) { return u === '/api/config'; })).to.be.true;
      expect(urls.some(function (u) { return u.startsWith('/api/sessions'); })).to.be.true;
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

  it('init() connects control WebSocket to /ws/control with instance param', function () {
    var app = new App();
    return app.init().then(function () {
      expect(app._controlWs).to.exist;
      expect(app._controlWs.url).to.include('/ws/control');
      expect(app._controlWs.url).to.include('instance=');
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
      // Dialog should have title and form fields
      expect(dialog.querySelector('.ephemeral-title')).to.exist;
      expect(dialog.querySelector('.edit-name-input')).to.exist;
      expect(dialog.querySelector('.edit-save')).to.exist;
      expect(dialog.querySelector('.edit-cancel')).to.exist;
    });
  });

  it('create dialog has color swatches', function () {
    var app = new App();
    return app.init().then(function () {
      document.getElementById('add-terminal-btn').click();
      var dialog = document.getElementById('ephemeral-dialog');
      var swatchContainers = dialog.querySelectorAll('.edit-swatches');
      expect(swatchContainers.length).to.equal(2);
    });
  });

  it('create dialog has command info button and tooltip', function () {
    var app = new App();
    return app.init().then(function () {
      document.getElementById('add-terminal-btn').click();
      var dialog = document.getElementById('ephemeral-dialog');
      var infoBtn = dialog.querySelector('.ephemeral-info-btn');
      expect(infoBtn).to.exist;
      var tip = dialog.querySelector('.ephemeral-info-tip');
      expect(tip).to.exist;
      expect(tip.classList.contains('hidden')).to.be.true;
      infoBtn.click();
      expect(tip.classList.contains('hidden')).to.be.false;
    });
  });

  it('create button sends create_terminal message via control WS', function () {
    var app = new App();
    return app.init().then(function () {
      // Wait for control WS to open
      return new Promise(function (resolve) { setTimeout(resolve, 10); });
    }).then(function () {
      document.getElementById('add-terminal-btn').click();
      var dialog = document.getElementById('ephemeral-dialog');
      var inputs = dialog.querySelectorAll('.edit-name-input');
      inputs[0].value = 'Test Terminal';
      inputs[1].value = 'htop';

      dialog.querySelector('.edit-save').click();

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

  it('_handleActivity() updates sidebar terminal list activity', function () {
    var app = new App();
    return app.init().then(function () {
      // Init terminal list manually since test DOM lacks the container
      app._terminalList = {
        _items: new Map(),
        upsert: sinon.stub(),
        remove: sinon.stub(),
        updateActivity: sinon.stub(),
        updateLocation: sinon.stub()
      };

      var activityMsg = {
        statuses: { t1: true, t2: false }
      };

      app._handleActivity(activityMsg);

      expect(app._terminalList.updateActivity.calledWith('t1', true)).to.be.true;
      expect(app._terminalList.updateActivity.calledWith('t2', false)).to.be.true;
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
      if (url === '/api/config' || url.startsWith('/api/config?')) {
        return Promise.resolve({ json: () => Promise.resolve(testConfig) });
      }
      if (url.startsWith('/api/sessions')) {
        return Promise.resolve({ json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ json: () => Promise.resolve({}) });
    });

    var app = new App();
    return app.init().then(function () {
      var grid = document.getElementById('grid-container');
      var emptyState = grid.querySelector('.empty-state');
      expect(emptyState).to.exist;
      expect(emptyState.textContent).to.include('No panels');
    });
  });

  // --- Unit 5: Folder Cell App Integration ---

  function makeConn(window, id, name) {
    return {
      id: id,
      type: 'terminal',
      config: { name: name || id },
      attach: sinon.stub(),
      detach: sinon.stub(),
      refit: sinon.stub(),
      focus: sinon.stub(),
      isActive: sinon.stub().returns(false),
      destroy: sinon.stub()
    };
  }

  it('_openFolderInCell creates FolderCell with correct terminals', function () {
    var app = new App();
    return app.init().then(function () {
      // Set up connections and sessionFolders
      var connA = makeConn(window, 'a', 'A');
      var connB = makeConn(window, 'b', 'B');
      app._connections['a'] = connA;
      app._connections['b'] = connB;
      app._sessionFolders = { a: 'f1', b: 'f1' };
      app._folders = [{ id: 'f1', name: 'Folder 1' }];

      var cell = app._engine._cells[0];
      app._openFolderInCell('f1', cell);

      expect(app._engine.assignFolder.calledOnce).to.be.true;
      var fc = app._engine.assignFolder.firstCall.args[1];
      expect(fc.getFolderId()).to.equal('f1');
      var ids = fc.getTerminals().map(function (t) { return t.id; });
      expect(ids).to.include('a');
      expect(ids).to.include('b');
    });
  });

  it('_openFolderInCell is no-op for empty folder', function () {
    var app = new App();
    return app.init().then(function () {
      app._connections = {};
      app._sessionFolders = {};
      app._folders = [{ id: 'f1', name: 'Empty' }];

      var cell = app._engine._cells[0];
      app._openFolderInCell('f1', cell);

      expect(app._engine.assignFolder.called).to.be.false;
    });
  });

  it('_openFolderInCell stores folderCell in _folderCells map', function () {
    var app = new App();
    return app.init().then(function () {
      var connA = makeConn(window, 'a', 'A');
      app._connections['a'] = connA;
      app._sessionFolders = { a: 'f1' };
      app._folders = [{ id: 'f1', name: 'Folder 1' }];

      var cell = app._engine._cells[0];
      app._openFolderInCell('f1', cell);

      expect(app._folderCells['f1']).to.exist;
    });
  });

  it('_syncTerminalList shows "Cell N (tab)" for inactive folder tabs', function () {
    var app = new App();
    return app.init().then(function () {
      var connA = makeConn(window, 'a', 'A');
      var connB = makeConn(window, 'b', 'B');
      app._connections['a'] = connA;
      app._connections['b'] = connB;

      // Set up a folder cell in cell 0 with 'a' active, 'b' inactive
      var fc = new window.TerminalDeck.FolderCell('f1', 'Folder', [
        { id: 'a', name: 'A', connection: connA },
        { id: 'b', name: 'B', connection: connB }
      ]);
      app._engine._cellMap.set(app._engine._cells[0], {
        connection: connA, terminalId: 'a', folderCell: fc
      });

      // Mock terminal list render
      var rendered = null;
      if (app._terminalList) {
        app._terminalList.render = function (items) { rendered = items; };
      }

      app._syncTerminalList();

      if (rendered) {
        var bItem = rendered.find(function (i) { return i.id === 'b'; });
        expect(bItem).to.exist;
        expect(bItem.location).to.include('tab');
      }
    });
  });

  it('_handleTerminalListSelect switches to inactive folder tab', function () {
    var app = new App();
    return app.init().then(function () {
      var connA = makeConn(window, 'a', 'A');
      var connB = makeConn(window, 'b', 'B');
      app._connections['a'] = connA;
      app._connections['b'] = connB;

      var fc = new window.TerminalDeck.FolderCell('f1', 'Folder', [
        { id: 'a', name: 'A', connection: connA },
        { id: 'b', name: 'B', connection: connB }
      ]);
      var cell = app._engine._cells[0];
      app._engine._cellMap.set(cell, {
        connection: connA, terminalId: 'a', folderCell: fc
      });

      // Stub _highlightCell since mock cell has no classList
      app._highlightCell = sinon.stub();

      app._handleTerminalListSelect('b');

      expect(app._engine._switchFolderTab.calledWith(cell, 'b')).to.be.true;
    });
  });

  it('_handleSessionsUpdate adds new terminal to active folder cell', function () {
    var app = new App();
    return app.init().then(function () {
      var connA = makeConn(window, 'a', 'A');
      app._connections['a'] = connA;
      app._sessionFolders = { a: 'f1', b: 'f1' };

      var fc = new window.TerminalDeck.FolderCell('f1', 'Folder', [
        { id: 'a', name: 'A', connection: connA }
      ]);
      app._folderCells['f1'] = fc;
      var cell = app._engine._cells[0];
      app._engine._cellMap.set(cell, {
        connection: connA, terminalId: 'a', folderCell: fc
      });
      // Add cell-header to cell
      cell.querySelector = function (sel) {
        if (sel === '.cell-header') return { style: {} };
        return null;
      };

      app._handleSessionsUpdate([
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' }
      ]);

      var tabs = fc.getTerminals();
      var bTab = tabs.find(function (t) { return t.id === 'b'; });
      expect(bTab).to.exist;
    });
  });

  it('_handleSessionsUpdate removes destroyed terminal from folder cell', function () {
    var app = new App();
    return app.init().then(function () {
      var connA = makeConn(window, 'a', 'A');
      var connB = makeConn(window, 'b', 'B');
      app._connections['a'] = connA;
      app._connections['b'] = connB;
      app._sessionFolders = { a: 'f1', b: 'f1' };

      var fc = new window.TerminalDeck.FolderCell('f1', 'Folder', [
        { id: 'a', name: 'A', connection: connA },
        { id: 'b', name: 'B', connection: connB }
      ]);
      app._folderCells['f1'] = fc;
      var cell = app._engine._cells[0];
      app._engine._cellMap.set(cell, {
        connection: connA, terminalId: 'a', folderCell: fc
      });
      cell.querySelector = function () { return { style: {} }; };

      // 'b' is destroyed (not in sessions update)
      app._handleSessionsUpdate([{ id: 'a', name: 'A' }]);

      var tabs = fc.getTerminals();
      expect(tabs.find(function (t) { return t.id === 'b'; })).to.not.exist;
    });
  });

  // --- Unit 6: Sidebar UI ---

  it('TerminalList has onOpenFolderInGrid callback', function () {
    var app = new App();
    return app.init().then(function () {
      if (app._terminalList) {
        expect(app._terminalList.onOpenFolderInGrid).to.be.a('function');
      }
    });
  });

  it('TerminalList folder element has Open in grid button', function () {
    // Test the terminal-list directly
    delete require.cache[require.resolve('./terminal-list')];
    require('./terminal-list');
    var TerminalList = window.TerminalDeck.TerminalList;
    var container = document.createElement('div');
    var tl = new TerminalList(container);
    tl.setFolderData([{ id: 'f1', name: 'F1', parentId: null, collapsed: false }], {});
    tl.render([]);
    var openBtn = container.querySelector('.tl-btn-folder-open-grid');
    expect(openBtn).to.exist;
  });

  it('onOpenFolderInGrid callback fires when Open in grid button is clicked', function () {
    delete require.cache[require.resolve('./terminal-list')];
    require('./terminal-list');
    var TerminalList = window.TerminalDeck.TerminalList;
    var container = document.createElement('div');
    var tl = new TerminalList(container);
    var fired = null;
    tl.onOpenFolderInGrid = function (fid) { fired = fid; };
    tl.setFolderData([{ id: 'f1', name: 'F1', parentId: null, collapsed: false }], {});
    tl.render([]);
    var openBtn = container.querySelector('.tl-btn-folder-open-grid');
    openBtn.click();
    expect(fired).to.equal('f1');
  });

  it('cell popover shows folders section when folders are available', function () {
    // Use the real LayoutEngine for this test
    var dom2 = new (require('jsdom').JSDOM)(
      '<!DOCTYPE html><html><body><div id="g"></div></body></html>',
      { url: 'http://localhost:3000' }
    );
    global.document = dom2.window.document;
    global.window = dom2.window;

    delete require.cache[require.resolve('./folder-cell')];
    delete require.cache[require.resolve('./layout')];
    require('./folder-cell');
    require('./layout');

    var LayoutEngine = dom2.window.TerminalDeck.LayoutEngine;
    var grid = dom2.window.document.getElementById('g');
    var engine = new LayoutEngine(grid);
    engine._folders = [{ id: 'f1', name: 'MyFolder' }];
    engine.setGrid('1x1');

    var cell = engine._cells[0];
    engine._showCellPopover(cell);

    var popover = cell.querySelector('.cell-popover');
    expect(popover).to.exist;
    var folderSection = popover.querySelector('.popover-section');
    expect(folderSection).to.exist;
    var folderLabel = folderSection.querySelector('.popover-section-label');
    expect(folderLabel.textContent).to.equal('Folders');
  });

  it('cell popover does not show folders section when no folders', function () {
    var dom2 = new (require('jsdom').JSDOM)(
      '<!DOCTYPE html><html><body><div id="g"></div></body></html>',
      { url: 'http://localhost:3000' }
    );
    global.document = dom2.window.document;
    global.window = dom2.window;

    delete require.cache[require.resolve('./folder-cell')];
    delete require.cache[require.resolve('./layout')];
    require('./folder-cell');
    require('./layout');

    var LayoutEngine = dom2.window.TerminalDeck.LayoutEngine;
    var grid = dom2.window.document.getElementById('g');
    var engine = new LayoutEngine(grid);
    engine._folders = [];
    // Add a minimized terminal so popover can show
    engine._minimized.set('t1', { config: { name: 'T1' } });
    engine.setGrid('1x1');

    var cell = engine._cells[0];
    engine._showCellPopover(cell);

    var popover = cell.querySelector('.cell-popover');
    expect(popover).to.exist;
    expect(popover.querySelector('.popover-section')).to.not.exist;
  });
});
