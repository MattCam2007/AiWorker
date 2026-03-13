const { expect } = require('chai');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');
const { MockWebSocket } = require('./test-helpers');

describe('CommandPalette', function () {
  let dom, window, CommandPalette;

  function setupDOM() {
    dom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body>' +
        '<div id="command-palette" class="command-palette hidden">' +
          '<div class="cp-header">' +
            '<input id="cp-search" class="cp-search-input" type="text" placeholder="Search commands...">' +
            '<button id="cp-close-btn" class="cp-close">&times;</button>' +
          '</div>' +
          '<div id="cp-list" class="cp-list"></div>' +
        '</div>' +
        '<div id="cp-backdrop" class="cp-backdrop hidden"></div>' +
        '<main id="grid-container"></main>' +
      '</body></html>',
      { url: 'http://localhost:3000' }
    );
    window = dom.window;

    global.window = window;
    global.document = window.document;
    global.WebSocket = MockWebSocket;
    global.requestAnimationFrame = function (cb) { cb(); };
    global.fetch = sinon.stub();

    // Prevent auto-init
    window.TerminalDeck = window.TerminalDeck || {};
    window.TerminalDeck._noAutoInit = true;

    // Mock Fuse.js - simple substring matching
    window.Fuse = function (list, options) {
      this._list = list;
      this._options = options;
    };
    window.Fuse.prototype.search = function (query) {
      var q = query.toLowerCase();
      return this._list
        .filter(function (item) {
          var val = typeof item === 'string' ? item : item[this._options.keys[0]];
          return val.toLowerCase().indexOf(q) !== -1;
        }.bind(this))
        .map(function (item, idx) {
          return { item: item, refIndex: idx };
        });
    };

    delete require.cache[require.resolve('./command-palette')];
    require('./command-palette');

    CommandPalette = window.TerminalDeck.CommandPalette;
  }

  beforeEach(function () {
    setupDOM();
  });

  afterEach(function () {
    delete global.window;
    delete global.document;
    delete global.WebSocket;
    delete global.fetch;
    delete global.requestAnimationFrame;
    sinon.restore();
  });

  it('CommandPalette exists on window.TerminalDeck namespace', function () {
    expect(CommandPalette).to.be.a('function');
  });

  it('palette starts closed/hidden', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);
    expect(container.classList.contains('hidden')).to.be.true;
  });

  it('open() makes the palette visible', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);

    // Stub fetch for loadHistory
    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () { return Promise.resolve(['ls', 'cd /tmp']); }
    });

    palette.open();
    expect(container.classList.contains('hidden')).to.be.false;
  });

  it('close() hides the palette', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () { return Promise.resolve([]); }
    });

    palette.open();
    expect(container.classList.contains('hidden')).to.be.false;

    palette.close();
    expect(container.classList.contains('hidden')).to.be.true;
  });

  it('toggle() opens when closed and closes when open', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () { return Promise.resolve([]); }
    });

    // Initially hidden
    expect(container.classList.contains('hidden')).to.be.true;

    palette.toggle();
    expect(container.classList.contains('hidden')).to.be.false;

    palette.toggle();
    expect(container.classList.contains('hidden')).to.be.true;
  });

  it('loadHistory() fetches /api/history and populates the list', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () { return Promise.resolve(['git status', 'npm install', 'ls -la']); }
    });

    return palette.loadHistory().then(function () {
      expect(global.fetch.calledWith('/api/history')).to.be.true;
      var items = document.querySelectorAll('#cp-list .cp-item');
      expect(items.length).to.equal(3);
      expect(items[0].textContent).to.equal('git status');
      expect(items[1].textContent).to.equal('npm install');
      expect(items[2].textContent).to.equal('ls -la');
    });
  });

  it('loadHistory() renders empty list on fetch failure', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);

    global.fetch = sinon.stub().rejects(new Error('network error'));

    return palette.loadHistory().then(function () {
      var items = document.querySelectorAll('#cp-list .cp-item');
      expect(items.length).to.equal(0);
    });
  });

  it('search filters results using fuse.js', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () {
        return Promise.resolve(['git status', 'git commit', 'npm install', 'ls -la']);
      }
    });

    return palette.loadHistory().then(function () {
      palette.search('git');
      var items = document.querySelectorAll('#cp-list .cp-item');
      expect(items.length).to.equal(2);
      expect(items[0].textContent).to.equal('git status');
      expect(items[1].textContent).to.equal('git commit');
    });
  });

  it('search with empty query shows all results', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () {
        return Promise.resolve(['git status', 'npm install', 'ls -la']);
      }
    });

    return palette.loadHistory().then(function () {
      palette.search('git');
      var filtered = document.querySelectorAll('#cp-list .cp-item');
      expect(filtered.length).to.equal(1); // only 'git status'

      palette.search('');
      var all = document.querySelectorAll('#cp-list .cp-item');
      expect(all.length).to.equal(3);
    });
  });

  it('selectItem() calls onSelect callback with the command string', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);
    var selectedCmd = null;

    palette.onSelect = function (cmd) {
      selectedCmd = cmd;
    };

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () {
        return Promise.resolve(['git status', 'npm install']);
      }
    });

    return palette.loadHistory().then(function () {
      palette.selectItem('git status');
      expect(selectedCmd).to.equal('git status');
    });
  });

  it('clicking a list item triggers onSelect', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);
    var selectedCmd = null;

    palette.onSelect = function (cmd) {
      selectedCmd = cmd;
    };

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () {
        return Promise.resolve(['git status', 'npm install']);
      }
    });

    return palette.loadHistory().then(function () {
      var items = document.querySelectorAll('#cp-list .cp-item');
      items[0].click();
      expect(selectedCmd).to.equal('git status');
    });
  });

  it('clicking a list item closes the palette', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);

    palette.onSelect = function () {};

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () {
        return Promise.resolve(['git status']);
      }
    });

    palette.open();
    return palette.loadHistory().then(function () {
      var items = document.querySelectorAll('#cp-list .cp-item');
      items[0].click();
      expect(container.classList.contains('hidden')).to.be.true;
    });
  });

  it('Escape key closes palette', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () { return Promise.resolve([]); }
    });

    palette.open();
    expect(container.classList.contains('hidden')).to.be.false;

    var event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(event);

    expect(container.classList.contains('hidden')).to.be.true;
  });

  it('Ctrl+K toggles palette open/closed', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () { return Promise.resolve([]); }
    });

    // Ctrl+K opens
    var openEvent = new window.KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true
    });
    document.dispatchEvent(openEvent);
    expect(container.classList.contains('hidden')).to.be.false;

    // Ctrl+K closes
    var closeEvent = new window.KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true
    });
    document.dispatchEvent(closeEvent);
    expect(container.classList.contains('hidden')).to.be.true;
  });

  it('Cmd+K (metaKey) toggles palette on Mac', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () { return Promise.resolve([]); }
    });

    var event = new window.KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true
    });
    document.dispatchEvent(event);
    expect(container.classList.contains('hidden')).to.be.false;
  });

  it('close button closes the palette', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () { return Promise.resolve([]); }
    });

    palette.open();
    expect(container.classList.contains('hidden')).to.be.false;

    var closeBtn = document.getElementById('cp-close-btn');
    closeBtn.click();
    expect(container.classList.contains('hidden')).to.be.true;
  });

  it('backdrop click closes the palette', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () { return Promise.resolve([]); }
    });

    palette.open();
    var backdrop = document.getElementById('cp-backdrop');
    expect(backdrop.classList.contains('hidden')).to.be.false;

    backdrop.click();
    expect(container.classList.contains('hidden')).to.be.true;
    expect(backdrop.classList.contains('hidden')).to.be.true;
  });

  it('updateHistory() refreshes the list with new data', function () {
    var container = document.getElementById('command-palette');
    var palette = new CommandPalette(container);

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: function () { return Promise.resolve(['old-cmd']); }
    });

    return palette.loadHistory().then(function () {
      var items = document.querySelectorAll('#cp-list .cp-item');
      expect(items.length).to.equal(1);

      palette.updateHistory(['new-cmd-1', 'new-cmd-2']);
      var updated = document.querySelectorAll('#cp-list .cp-item');
      expect(updated.length).to.equal(2);
      expect(updated[0].textContent).to.equal('new-cmd-1');
    });
  });
});
