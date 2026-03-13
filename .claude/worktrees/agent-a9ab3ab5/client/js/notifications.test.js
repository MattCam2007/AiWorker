const { expect } = require('chai');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');
const { MockWebSocket } = require('./test-helpers');

describe('Notifications — Frontend', function () {
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
        '<button id="notification-toggle-btn" class="notification-toggle">Bell</button>' +
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
      if (url === '/api/config') {
        return Promise.resolve({ json: () => Promise.resolve(testConfig) });
      }
      if (url === '/api/sessions') {
        return Promise.resolve({ json: () => Promise.resolve(testSessions) });
      }
      return Promise.resolve({ json: () => Promise.resolve({}) });
    });

    global.ResizeObserver = undefined;
    global.requestAnimationFrame = function (cb) { cb(); };

    // Mock AudioContext
    window.AudioContext = function () {
      this.currentTime = 0;
      this.destination = {};
      this.state = 'running';
      this.resume = sinon.stub().resolves();
      this.createOscillator = function () {
        return {
          connect: sinon.stub(),
          frequency: { value: 0 },
          type: 'sine',
          start: sinon.stub(),
          stop: sinon.stub()
        };
      };
      this.createGain = function () {
        return {
          connect: sinon.stub(),
          gain: {
            value: 0,
            setValueAtTime: sinon.stub(),
            exponentialRampToValueAtTime: sinon.stub()
          }
        };
      };
    };

    // Mock Notification API (must be on both window and global for IIFE typeof checks)
    var NotifMock = function (title, opts) {
      NotifMock._lastNotification = { title: title, opts: opts };
    };
    NotifMock.permission = 'granted';
    NotifMock.requestPermission = sinon.stub().resolves('granted');
    NotifMock._lastNotification = null;
    window.Notification = NotifMock;
    global.Notification = NotifMock;

    // Mock document.hidden
    Object.defineProperty(window.document, 'hidden', {
      get: function () { return window._documentHidden || false; },
      configurable: true
    });
    window._documentHidden = false;

    window.matchMedia = function () {
      return { matches: false, addEventListener: function () {} };
    };

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
      this.focus = sinon.stub();
    };

    // Stub LayoutEngine
    window.TerminalDeck.LayoutEngine = function (grid) {
      this._gridContainer = grid;
      this._minimized = new Map();
      this._cells = [];
      this._cellMap = new Map();
      this.setGrid = sinon.stub().callsFake(function (spec) {
        var parts = spec.split('x');
        var total = parseInt(parts[0]) * parseInt(parts[1]);
        this._cells = [];
        this._cellMap = new Map();
        for (var i = 0; i < total; i++) {
          var cell = document.createElement('div');
          cell.className = 'grid-cell';
          this._cells.push(cell);
          this._cellMap.set(cell, { connection: null, terminalId: null });
        }
      });
      this.refitAll = sinon.stub();
      this.assignTerminal = sinon.stub().callsFake(function (cell, id, conn) {
        this._cellMap.set(cell, { connection: conn, terminalId: id });
      });
      this._addToMinimized = sinon.stub();
      this._removeFromMinimized = sinon.stub();
      this._removeFromGrid = sinon.stub();
      this.updateHeader = sinon.stub();
      this.clearSupersize = sinon.stub();
      this.checkMobile = sinon.stub().returns(false);
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
    delete global.Notification;
    sinon.restore();
  });

  describe('Notification.requestPermission on init', () => {
    it('requests notification permission on init', function () {
      var app = new App();
      return app.init().then(function () {
        expect(window.Notification.requestPermission.called).to.be.true;
      });
    });
  });

  describe('task_complete message handling', () => {
    it('task_complete message triggers _handleTaskComplete', function () {
      var app = new App();
      return app.init().then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 10); });
      }).then(function () {
        var spy = sinon.spy(app, '_handleTaskComplete');

        app._controlWs._receive({
          type: 'task_complete',
          terminalId: 't1',
          timestamp: new Date().toISOString()
        });

        expect(spy.calledOnce).to.be.true;
        expect(spy.firstCall.args[0].terminalId).to.equal('t1');
      });
    });

    it('task_complete plays audio when not muted', function () {
      var app = new App();
      return app.init().then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 10); });
      }).then(function () {
        // Simulate user interaction to unlock AudioContext
        document.dispatchEvent(new window.Event('click'));
        expect(app._audioCtx).to.not.be.null;

        // Spy on the _playDing method
        var playSpy = sinon.spy(app, '_playDing');

        app._controlWs._receive({
          type: 'task_complete',
          terminalId: 't1',
          timestamp: new Date().toISOString()
        });

        expect(playSpy.calledOnce).to.be.true;
      });
    });

    it('task_complete does NOT play audio when muted', function () {
      var app = new App();
      return app.init().then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 10); });
      }).then(function () {
        app._notificationsMuted = true;
        var playSpy = sinon.spy(app, '_playDing');

        app._controlWs._receive({
          type: 'task_complete',
          terminalId: 't1',
          timestamp: new Date().toISOString()
        });

        expect(playSpy.called).to.be.false;
      });
    });

    it('task_complete fires browser notification when tab is hidden', function () {
      var app = new App();
      return app.init().then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 10); });
      }).then(function () {
        window._documentHidden = true;

        app._controlWs._receive({
          type: 'task_complete',
          terminalId: 't1',
          timestamp: new Date().toISOString()
        });

        expect(window.Notification._lastNotification).to.not.be.null;
        expect(window.Notification._lastNotification.title).to.include('TerminalDeck');
      });
    });

    it('task_complete does NOT fire browser notification when tab is visible', function () {
      var app = new App();
      return app.init().then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 10); });
      }).then(function () {
        window._documentHidden = false;

        app._controlWs._receive({
          type: 'task_complete',
          terminalId: 't1',
          timestamp: new Date().toISOString()
        });

        expect(window.Notification._lastNotification).to.be.null;
      });
    });

    it('task_complete does NOT fire browser notification when muted', function () {
      var app = new App();
      return app.init().then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 10); });
      }).then(function () {
        window._documentHidden = true;
        app._notificationsMuted = true;

        app._controlWs._receive({
          type: 'task_complete',
          terminalId: 't1',
          timestamp: new Date().toISOString()
        });

        expect(window.Notification._lastNotification).to.be.null;
      });
    });

    it('task_complete applies visual flash to the correct terminal cell', function () {
      var app = new App();
      return app.init().then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 10); });
      }).then(function () {
        app._controlWs._receive({
          type: 'task_complete',
          terminalId: 't1',
          timestamp: new Date().toISOString()
        });

        // Find the cell containing t1
        var flashedCell = null;
        for (var i = 0; i < app._engine._cells.length; i++) {
          var cell = app._engine._cells[i];
          var info = app._engine._cellMap.get(cell);
          if (info && info.terminalId === 't1') {
            flashedCell = cell;
            break;
          }
        }

        expect(flashedCell).to.not.be.null;
        expect(flashedCell.classList.contains('cell-task-complete')).to.be.true;
      });
    });
  });

  describe('mute toggle', () => {
    it('_notificationsMuted starts as false', function () {
      var app = new App();
      return app.init().then(function () {
        expect(app._notificationsMuted).to.be.false;
      });
    });

    it('_toggleNotificationMute toggles the muted state', function () {
      var app = new App();
      return app.init().then(function () {
        expect(app._notificationsMuted).to.be.false;
        app._toggleNotificationMute();
        expect(app._notificationsMuted).to.be.true;
        app._toggleNotificationMute();
        expect(app._notificationsMuted).to.be.false;
      });
    });
  });
});
