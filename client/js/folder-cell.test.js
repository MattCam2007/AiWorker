const { expect } = require('chai');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');

describe('FolderCell', function () {
  let dom, window, FolderCell;

  function makeConn(id) {
    return {
      id: id,
      attach: sinon.stub(),
      detach: sinon.stub(),
      refit: sinon.stub(),
      focus: sinon.stub()
    };
  }

  beforeEach(function () {
    dom = new JSDOM(
      '<!DOCTYPE html><html><body></body></html>',
      { url: 'http://localhost:3000' }
    );
    window = dom.window;
    global.window = window;
    global.document = window.document;

    delete require.cache[require.resolve('./folder-cell')];
    require('./folder-cell');
    FolderCell = window.TerminalDeck.FolderCell;
  });

  afterEach(function () {
    delete global.window;
    delete global.document;
    sinon.restore();
  });

  // --- Data model tests ---

  it('FolderCell exists on window.TerminalDeck namespace', function () {
    expect(FolderCell).to.be.a('function');
  });

  it('constructor sets first terminal as active', function () {
    var connA = makeConn('a');
    var connB = makeConn('b');
    var fc = new FolderCell('f1', 'Folder', [
      { id: 'a', name: 'A', connection: connA },
      { id: 'b', name: 'B', connection: connB }
    ]);
    expect(fc.getActiveTerminalId()).to.equal('a');
  });

  it('getActiveTerminalId returns null for empty entries', function () {
    var fc = new FolderCell('f1', 'Folder', []);
    expect(fc.getActiveTerminalId()).to.be.null;
  });

  it('getActiveConnection returns connection of active terminal', function () {
    var connA = makeConn('a');
    var connB = makeConn('b');
    var fc = new FolderCell('f1', 'Folder', [
      { id: 'a', name: 'A', connection: connA },
      { id: 'b', name: 'B', connection: connB }
    ]);
    expect(fc.getActiveConnection()).to.equal(connA);
  });

  it('getActiveConnection returns null for empty folder', function () {
    var fc = new FolderCell('f1', 'Folder', []);
    expect(fc.getActiveConnection()).to.be.null;
  });

  it('getFolderId and getFolderName return correct values', function () {
    var fc = new FolderCell('folder-42', 'My Folder', []);
    expect(fc.getFolderId()).to.equal('folder-42');
    expect(fc.getFolderName()).to.equal('My Folder');
  });

  it('getTerminals returns a copy of the terminals array', function () {
    var connA = makeConn('a');
    var fc = new FolderCell('f1', 'Folder', [{ id: 'a', name: 'A', connection: connA }]);
    var terminals = fc.getTerminals();
    expect(terminals).to.have.length(1);
    expect(terminals[0].id).to.equal('a');
    // Mutating the copy should not affect the internal state
    terminals.push({ id: 'x', name: 'X', connection: null });
    expect(fc.getTerminals()).to.have.length(1);
  });

  it('setActiveTab updates active terminal and returns prev/next', function () {
    var connA = makeConn('a');
    var connB = makeConn('b');
    var fc = new FolderCell('f1', 'Folder', [
      { id: 'a', name: 'A', connection: connA },
      { id: 'b', name: 'B', connection: connB }
    ]);
    var result = fc.setActiveTab('b');
    expect(result).to.not.be.null;
    expect(result.prev.id).to.equal('a');
    expect(result.prev.conn).to.equal(connA);
    expect(result.next.id).to.equal('b');
    expect(result.next.conn).to.equal(connB);
    expect(fc.getActiveTerminalId()).to.equal('b');
  });

  it('setActiveTab returns null when tab is already active', function () {
    var connA = makeConn('a');
    var fc = new FolderCell('f1', 'Folder', [{ id: 'a', name: 'A', connection: connA }]);
    var result = fc.setActiveTab('a');
    expect(result).to.be.null;
  });

  it('addTerminal appends a new terminal', function () {
    var connA = makeConn('a');
    var fc = new FolderCell('f1', 'Folder', [{ id: 'a', name: 'A', connection: connA }]);
    var connB = makeConn('b');
    fc.addTerminal('b', 'B', connB);
    var terminals = fc.getTerminals();
    expect(terminals).to.have.length(2);
    expect(terminals[1].id).to.equal('b');
  });

  it('addTerminal sets active if folder was empty', function () {
    var fc = new FolderCell('f1', 'Folder', []);
    expect(fc.getActiveTerminalId()).to.be.null;
    fc.addTerminal('a', 'A', makeConn('a'));
    expect(fc.getActiveTerminalId()).to.equal('a');
  });

  it('removeTerminal of inactive terminal does not change active', function () {
    var connA = makeConn('a');
    var connB = makeConn('b');
    var fc = new FolderCell('f1', 'Folder', [
      { id: 'a', name: 'A', connection: connA },
      { id: 'b', name: 'B', connection: connB }
    ]);
    var result = fc.removeTerminal('b');
    expect(result.wasActive).to.be.false;
    expect(result.newActiveId).to.equal('a');
    expect(fc.getActiveTerminalId()).to.equal('a');
    expect(fc.getTerminals()).to.have.length(1);
  });

  it('removeTerminal of active terminal selects next', function () {
    var connA = makeConn('a');
    var connB = makeConn('b');
    var connC = makeConn('c');
    var fc = new FolderCell('f1', 'Folder', [
      { id: 'a', name: 'A', connection: connA },
      { id: 'b', name: 'B', connection: connB },
      { id: 'c', name: 'C', connection: connC }
    ]);
    var result = fc.removeTerminal('a');
    expect(result.wasActive).to.be.true;
    expect(result.newActiveId).to.equal('b');
    expect(fc.getActiveTerminalId()).to.equal('b');
  });

  it('removeTerminal of sole terminal returns newActiveId null', function () {
    var connA = makeConn('a');
    var fc = new FolderCell('f1', 'Folder', [{ id: 'a', name: 'A', connection: connA }]);
    var result = fc.removeTerminal('a');
    expect(result.wasActive).to.be.true;
    expect(result.newActiveId).to.be.null;
    expect(fc.getActiveTerminalId()).to.be.null;
  });

  it('removeTerminal returns wasActive: false for nonexistent id', function () {
    var connA = makeConn('a');
    var fc = new FolderCell('f1', 'Folder', [{ id: 'a', name: 'A', connection: connA }]);
    var result = fc.removeTerminal('nonexistent');
    expect(result.wasActive).to.be.false;
    expect(fc.getTerminals()).to.have.length(1);
  });

  it('updateTerminalName updates the name', function () {
    var connA = makeConn('a');
    var fc = new FolderCell('f1', 'Folder', [{ id: 'a', name: 'Old', connection: connA }]);
    fc.updateTerminalName('a', 'New');
    expect(fc.getTerminals()[0].name).to.equal('New');
  });

  // --- Renderer tests ---

  it('renderHeader creates folder name element', function () {
    var connA = makeConn('a');
    var fc = new FolderCell('f1', 'My Folder', [{ id: 'a', name: 'A', connection: connA }]);
    var headerEl = document.createElement('div');
    fc.renderHeader(headerEl, {});
    var nameEl = headerEl.querySelector('.cell-header-folder-name');
    expect(nameEl).to.exist;
    expect(nameEl.textContent).to.equal('My Folder');
  });

  it('renderHeader creates correct number of tab elements', function () {
    var fc = new FolderCell('f1', 'Folder', [
      { id: 'a', name: 'A', connection: makeConn('a') },
      { id: 'b', name: 'B', connection: makeConn('b') },
      { id: 'c', name: 'C', connection: makeConn('c') }
    ]);
    var headerEl = document.createElement('div');
    fc.renderHeader(headerEl, {});
    var tabs = headerEl.querySelectorAll('.cell-header-tab');
    expect(tabs.length).to.equal(3);
  });

  it('renderHeader marks first tab as active', function () {
    var fc = new FolderCell('f1', 'Folder', [
      { id: 'a', name: 'A', connection: makeConn('a') },
      { id: 'b', name: 'B', connection: makeConn('b') }
    ]);
    var headerEl = document.createElement('div');
    fc.renderHeader(headerEl, {});
    var tabs = headerEl.querySelectorAll('.cell-header-tab');
    expect(tabs[0].classList.contains('cell-header-tab-active')).to.be.true;
    expect(tabs[1].classList.contains('cell-header-tab-active')).to.be.false;
  });

  it('tab click calls onTabClick with correct terminalId', function () {
    var fc = new FolderCell('f1', 'Folder', [
      { id: 'a', name: 'A', connection: makeConn('a') },
      { id: 'b', name: 'B', connection: makeConn('b') }
    ]);
    var headerEl = document.createElement('div');
    var onTabClick = sinon.spy();
    fc.renderHeader(headerEl, { onTabClick: onTabClick });
    var tabs = headerEl.querySelectorAll('.cell-header-tab');
    tabs[1].click();
    expect(onTabClick.calledOnce).to.be.true;
    expect(onTabClick.firstCall.args[0]).to.equal('b');
  });

  it('renderHeader shows standard buttons', function () {
    var fc = new FolderCell('f1', 'Folder', [{ id: 'a', name: 'A', connection: makeConn('a') }]);
    var headerEl = document.createElement('div');
    fc.renderHeader(headerEl, {});
    expect(headerEl.querySelector('.cell-header-more')).to.exist;
    expect(headerEl.querySelector('.cell-header-supersize')).to.exist;
    expect(headerEl.querySelector('.cell-header-minimize')).to.exist;
    expect(headerEl.querySelector('.cell-header-close')).to.exist;
  });

  it('renderHeader shows exit-supersize button when supersized', function () {
    var fc = new FolderCell('f1', 'Folder', [{ id: 'a', name: 'A', connection: makeConn('a') }]);
    var headerEl = document.createElement('div');
    fc.renderHeader(headerEl, { isSupersized: function () { return true; } });
    expect(headerEl.querySelector('.cell-header-exit-supersize')).to.exist;
    expect(headerEl.querySelector('.cell-header-supersize')).to.not.exist;
  });

  it('updateActiveTab changes active class without rebuilding', function () {
    var fc = new FolderCell('f1', 'Folder', [
      { id: 'a', name: 'A', connection: makeConn('a') },
      { id: 'b', name: 'B', connection: makeConn('b') }
    ]);
    var headerEl = document.createElement('div');
    var onTabClick = sinon.spy();
    fc.renderHeader(headerEl, { onTabClick: onTabClick });

    // Switch active to 'b'
    fc.setActiveTab('b');
    fc.updateActiveTab(headerEl);

    var tabs = headerEl.querySelectorAll('.cell-header-tab');
    expect(tabs[0].classList.contains('cell-header-tab-active')).to.be.false;
    expect(tabs[1].classList.contains('cell-header-tab-active')).to.be.true;
  });

  it('re-render replaces content cleanly', function () {
    var fc = new FolderCell('f1', 'Folder', [{ id: 'a', name: 'A', connection: makeConn('a') }]);
    var headerEl = document.createElement('div');
    fc.renderHeader(headerEl, {});
    var firstCount = headerEl.querySelectorAll('.cell-header-tab').length;
    fc.addTerminal('b', 'B', makeConn('b'));
    fc.renderHeader(headerEl, {});
    expect(headerEl.querySelectorAll('.cell-header-tab').length).to.equal(firstCount + 1);
  });

  it('empty folder shows no tabs', function () {
    var fc = new FolderCell('f1', 'Folder', []);
    var headerEl = document.createElement('div');
    fc.renderHeader(headerEl, {});
    expect(headerEl.querySelectorAll('.cell-header-tab').length).to.equal(0);
  });
});
