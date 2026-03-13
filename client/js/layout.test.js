const { expect } = require('chai');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');

describe('LayoutEngine', function () {
  let dom, window, LayoutEngine;

  function makeConnection(id, name) {
    return {
      id: id,
      config: { name: name || id },
      attach: sinon.stub(),
      detach: sinon.stub(),
      refit: sinon.stub(),
      focus: sinon.stub(),
      isActive: sinon.stub().returns(true)
    };
  }

  beforeEach(function () {
    dom = new JSDOM(
      '<!DOCTYPE html><html><body>' +
        '<div id="grid-container"></div>' +
        '</body></html>',
      { url: 'http://localhost:3000' }
    );
    window = dom.window;

    global.window = window;
    global.document = window.document;
    global.ResizeObserver = undefined;
    global.requestAnimationFrame = function (cb) {
      cb();
    };

    delete require.cache[require.resolve('./layout')];
    require('./layout');

    LayoutEngine = window.TerminalDeck.LayoutEngine;
  });

  afterEach(function () {
    delete global.window;
    delete global.document;
    delete global.ResizeObserver;
    delete global.requestAnimationFrame;
    sinon.restore();
  });

  it('LayoutEngine exists on window.TerminalDeck namespace', function () {
    expect(window.TerminalDeck.LayoutEngine).to.be.a('function');
  });

  it('GRID_PRESETS has all 8 presets with correct rows/cols values', function () {
    var presets = LayoutEngine.GRID_PRESETS;
    expect(presets).to.have.all.keys('1x1', '2x1', '1x2', '2x2', '2x3', '3x2', '3x1', '1x3');
    expect(presets['1x1']).to.deep.equal({ cols: 1, rows: 1 });
    expect(presets['2x2']).to.deep.equal({ cols: 2, rows: 2 });
    expect(presets['3x2']).to.deep.equal({ cols: 3, rows: 2 });
    expect(presets['2x3']).to.deep.equal({ cols: 2, rows: 3 });
  });

  it('setGrid("1x1") creates 1 cell with correct grid template', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('1x1');
    expect(grid.style.gridTemplateColumns).to.equal('1fr');
    expect(grid.style.gridTemplateRows).to.equal('1fr');
    expect(grid.querySelectorAll('.grid-cell').length).to.equal(1);
  });

  it('setGrid("2x2") creates 4 cells with correct grid template', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('2x2');
    expect(grid.style.gridTemplateColumns).to.equal('1fr 1fr');
    expect(grid.style.gridTemplateRows).to.equal('1fr 1fr');
    expect(grid.querySelectorAll('.grid-cell').length).to.equal(4);
  });

  it('setGrid("3x2") creates 6 cells with correct columns', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('3x2');
    expect(grid.style.gridTemplateColumns).to.equal('1fr 1fr 1fr');
    expect(grid.querySelectorAll('.grid-cell').length).to.equal(6);
  });

  it('all 8 presets generate correct CSS grid templates', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);
    var presets = LayoutEngine.GRID_PRESETS;

    Object.keys(presets).forEach(function (spec) {
      engine.setGrid(spec);
      var p = presets[spec];
      expect(grid.style.gridTemplateColumns).to.equal(Array(p.cols).fill('1fr').join(' '));
      expect(grid.style.gridTemplateRows).to.equal(Array(p.rows).fill('1fr').join(' '));
      expect(grid.querySelectorAll('.grid-cell').length).to.equal(p.cols * p.rows);
    });
  });

  it('new cells have cell-empty class', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('2x2');
    var cells = grid.querySelectorAll('.grid-cell');
    cells.forEach(function (cell) {
      expect(cell.classList.contains('cell-empty')).to.be.true;
    });
  });

  it('assignTerminal() calls connection.attach() on cell terminal mount', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Test');
    engine.assignTerminal(cell, 't1', conn);

    var mount = cell.querySelector('.cell-terminal');
    expect(conn.attach.calledOnce).to.be.true;
    expect(conn.attach.firstCall.args[0]).to.equal(mount);
  });

  it('assignTerminal() shows cell header with terminal name', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'My Terminal');
    engine.assignTerminal(cell, 't1', conn);

    var header = cell.querySelector('.cell-header');
    var nameSpan = header.querySelector('.cell-header-name');
    expect(nameSpan).to.exist;
    expect(nameSpan.textContent).to.equal('My Terminal');
    expect(header.style.display).to.not.equal('none');
  });

  it('_addToMinimized tracks connection in _minimized map', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('1x1');
    var conn = makeConnection('t1', 'Term 1');
    engine._addToMinimized('t1', conn);

    expect(engine._minimized.has('t1')).to.be.true;
    expect(engine._minimized.get('t1')).to.equal(conn);
  });

  it('_removeFromMinimized removes connection from map', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    var conn = makeConnection('t1', 'Term 1');
    engine._addToMinimized('t1', conn);
    expect(engine._minimized.has('t1')).to.be.true;

    engine._removeFromMinimized('t1');
    expect(engine._minimized.has('t1')).to.be.false;
  });

  it('switching to smaller grid moves only excess terminals to minimized', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    var connections = {
      t1: makeConnection('t1', 'T1'),
      t2: makeConnection('t2', 'T2'),
      t3: makeConnection('t3', 'T3'),
      t4: makeConnection('t4', 'T4')
    };

    // Start with 2x2 (4 cells), assign terminals to each cell
    engine.setGrid('2x2');
    var cells = grid.querySelectorAll('.grid-cell');
    engine.assignTerminal(cells[0], 't1', connections.t1);
    engine.assignTerminal(cells[1], 't2', connections.t2);
    engine.assignTerminal(cells[2], 't3', connections.t3);
    engine.assignTerminal(cells[3], 't4', connections.t4);

    // Switch to 1x1 — only terminals that don't fit should be minimized
    engine.setGrid('1x1');

    // t1 stays at (0,0), t2/t3/t4 go to minimized
    expect(engine._minimized.size).to.equal(3);
    var cellInfo = engine._cellMap.get(engine._cells[0]);
    expect(cellInfo.terminalId).to.equal('t1');
  });

  it('growing grid preserves terminals at matching (row,col) positions', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    var connections = {
      t1: makeConnection('t1', 'T1'),
      t2: makeConnection('t2', 'T2'),
      t3: makeConnection('t3', 'T3'),
      t4: makeConnection('t4', 'T4')
    };

    // Start with 2x2, assign terminals to each cell
    engine.setGrid('2x2');
    var cells = grid.querySelectorAll('.grid-cell');
    engine.assignTerminal(cells[0], 't1', connections.t1);
    engine.assignTerminal(cells[1], 't2', connections.t2);
    engine.assignTerminal(cells[2], 't3', connections.t3);
    engine.assignTerminal(cells[3], 't4', connections.t4);

    // Switch to 3x2 — all 4 fit, no terminals should be minimized
    engine.setGrid('3x2');

    expect(engine._minimized.size).to.equal(0);
    expect(engine._cells.length).to.equal(6);

    // t1 stays at (0,0), t2 at (0,1), t3 at (1,0), t4 at (1,1)
    expect(engine._cellMap.get(engine._cells[0]).terminalId).to.equal('t1');
    expect(engine._cellMap.get(engine._cells[1]).terminalId).to.equal('t2');
    expect(engine._cellMap.get(engine._cells[3]).terminalId).to.equal('t3');
    expect(engine._cellMap.get(engine._cells[4]).terminalId).to.equal('t4');

    // New positions (0,2) and (1,2) should be empty
    expect(engine._cellMap.get(engine._cells[2]).connection).to.be.null;
    expect(engine._cellMap.get(engine._cells[5]).connection).to.be.null;
  });

  it('shrinking grid keeps fitting terminals and minimizes the rest', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    var connections = {
      t1: makeConnection('t1', 'T1'),
      t2: makeConnection('t2', 'T2'),
      t3: makeConnection('t3', 'T3'),
      t4: makeConnection('t4', 'T4')
    };

    // Start with 2x2, assign terminals to each cell
    engine.setGrid('2x2');
    var cells = grid.querySelectorAll('.grid-cell');
    engine.assignTerminal(cells[0], 't1', connections.t1);
    engine.assignTerminal(cells[1], 't2', connections.t2);
    engine.assignTerminal(cells[2], 't3', connections.t3);
    engine.assignTerminal(cells[3], 't4', connections.t4);

    // Switch to 2x1 — only row 0 fits
    engine.setGrid('2x1');

    // t1 and t2 stay (row 0), t3 and t4 minimized (row 1)
    expect(engine._cells.length).to.equal(2);
    expect(engine._cellMap.get(engine._cells[0]).terminalId).to.equal('t1');
    expect(engine._cellMap.get(engine._cells[1]).terminalId).to.equal('t2');
    expect(engine._minimized.size).to.equal(2);
  });

  it('empty cell click shows popover with minimized terminals', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('2x1');
    var conn = makeConnection('t1', 'Term 1');
    engine._addToMinimized('t1', conn);

    // Click empty cell without selection
    var cells = grid.querySelectorAll('.grid-cell');
    cells[0].click();

    var popover = cells[0].querySelector('.cell-popover');
    expect(popover).to.exist;
    expect(popover.querySelectorAll('.popover-item').length).to.equal(1);
  });

  it('refitAll() calls refit() on all assigned connections', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    var conn1 = makeConnection('t1', 'T1');
    var conn2 = makeConnection('t2', 'T2');

    engine.setGrid('2x1');
    var cells = grid.querySelectorAll('.grid-cell');
    engine.assignTerminal(cells[0], 't1', conn1);
    engine.assignTerminal(cells[1], 't2', conn2);

    // Reset refit call counts
    conn1.refit.resetHistory();
    conn2.refit.resetHistory();

    engine.refitAll();

    expect(conn1.refit.calledOnce).to.be.true;
    expect(conn2.refit.calledOnce).to.be.true;
  });

  it('mobile detection forces 1x1 grid', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    // Mock matchMedia to return mobile
    window.matchMedia = function () {
      return { matches: true };
    };

    engine.setGrid('2x2');
    var result = engine.checkMobile();

    expect(result).to.be.true;
    expect(grid.querySelectorAll('.grid-cell').length).to.equal(1);
  });

  it('assignTerminal() schedules deferred refit on the connection', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Test');
    engine.assignTerminal(cell, 't1', conn);

    // rAF is stubbed to run immediately, so refit should have been called
    expect(conn.refit.called).to.be.true;
  });

  it('assignTerminal() shows close button in header', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Test');
    engine.assignTerminal(cell, 't1', conn);

    var closeBtn = cell.querySelector('.cell-header-close');
    expect(closeBtn).to.exist;
  });

  it('close button in header calls _onCloseTerminal callback', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    var closeSpy = sinon.spy();
    engine._onCloseTerminal = closeSpy;

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Test');
    engine.assignTerminal(cell, 't1', conn);

    var closeBtn = cell.querySelector('.cell-header-close');
    closeBtn.click();

    expect(closeSpy.calledOnce).to.be.true;
    expect(closeSpy.calledWith('t1')).to.be.true;
  });

  it('assignTerminal() shows edit button in header', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Test');
    engine.assignTerminal(cell, 't1', conn);

    var editBtn = cell.querySelector('.cell-header-edit');
    expect(editBtn).to.exist;
  });

  it('edit button click opens edit popover', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Test');
    engine.assignTerminal(cell, 't1', conn);

    var editBtn = cell.querySelector('.cell-header-edit');
    editBtn.click();

    var popover = cell.querySelector('.cell-edit-popover');
    expect(popover).to.exist;
    expect(popover.querySelector('.edit-name-input')).to.exist;
    expect(popover.querySelector('.edit-save')).to.exist;
    expect(popover.querySelector('.edit-cancel')).to.exist;
  });

  it('edit popover save calls _onUpdateTerminal callback', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    var updateSpy = sinon.spy();
    engine._onUpdateTerminal = updateSpy;

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Test');
    engine.assignTerminal(cell, 't1', conn);

    var editBtn = cell.querySelector('.cell-header-edit');
    editBtn.click();

    var popover = cell.querySelector('.cell-edit-popover');
    var nameInput = popover.querySelector('.edit-name-input');
    nameInput.value = 'Renamed';

    var saveBtn = popover.querySelector('.edit-save');
    saveBtn.click();

    expect(updateSpy.calledOnce).to.be.true;
    expect(updateSpy.firstCall.args[0]).to.equal('t1');
    expect(updateSpy.firstCall.args[1]).to.equal('Renamed');
  });

  it('edit popover cancel reverts header styles and removes popover', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Test');
    engine.assignTerminal(cell, 't1', conn);

    var header = cell.querySelector('.cell-header');
    var origBg = header.style.background;

    var editBtn = cell.querySelector('.cell-header-edit');
    editBtn.click();

    var cancelBtn = cell.querySelector('.edit-cancel');
    cancelBtn.click();

    expect(cell.querySelector('.cell-edit-popover')).to.be.null;
    expect(header.style.background).to.equal(origBg);
  });

  it('updateHeader() updates cell header name and colors', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Original');
    engine.assignTerminal(cell, 't1', conn);

    engine.updateHeader('t1', 'Updated', '#ff0000', '#ffffff');

    var header = cell.querySelector('.cell-header');
    var nameSpan = header.querySelector('.cell-header-name');
    expect(nameSpan.textContent).to.equal('Updated');
    // JSDOM converts hex to rgb, so check the value is set (non-empty)
    expect(header.style.background).to.not.equal('');
    expect(header.style.color).to.not.equal('');
  });

  it('minimizeTerminal() moves terminal from grid to _minimized map', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Test');
    engine.assignTerminal(cell, 't1', conn);

    engine.minimizeTerminal('t1');

    expect(engine._minimized.has('t1')).to.be.true;
    expect(engine._minimized.get('t1')).to.equal(conn);
    expect(conn.detach.called).to.be.true;
  });

  it('assignTerminal() applies headerBg and headerColor from connection config', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Test');
    conn.config.headerBg = '#1a1a2e';
    conn.config.headerColor = '#e94560';
    engine.assignTerminal(cell, 't1', conn);

    var header = cell.querySelector('.cell-header');
    // JSDOM converts hex to rgb, so check the value is set (non-empty)
    expect(header.style.background).to.not.equal('');
    expect(header.style.color).to.not.equal('');
  });

  it('_createColorSwatches() returns container with swatches', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    var selectSpy = sinon.spy();
    var container = engine._createColorSwatches(null, selectSpy);

    expect(container.className).to.equal('edit-swatches');
    // 1 none + 20 colors + 1 native input
    var swatches = container.querySelectorAll('.edit-swatch');
    expect(swatches.length).to.equal(21);
    var nativeInput = container.querySelector('.edit-color-native');
    expect(nativeInput).to.exist;
  });

  // --- Folder Cell integration ---

  function makeFolderCell(window, folderId, folderName, entries) {
    var FolderCell = window.TerminalDeck.FolderCell;
    return new FolderCell(folderId, folderName, entries);
  }

  it('assignFolder attaches active terminal and sets folderCell in cellMap', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    delete require.cache[require.resolve('./folder-cell')];
    require('./folder-cell');

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var connA = makeConnection('a', 'A');
    var connB = makeConnection('b', 'B');
    var fc = makeFolderCell(window, 'f1', 'MyFolder', [
      { id: 'a', name: 'A', connection: connA },
      { id: 'b', name: 'B', connection: connB }
    ]);

    engine.assignFolder(cell, fc);

    var info = engine._cellMap.get(cell);
    expect(info.terminalId).to.equal('a');
    expect(info.connection).to.equal(connA);
    expect(info.folderCell).to.equal(fc);
    expect(connA.attach.calledOnce).to.be.true;
  });

  it('assignFolder removes folder terminals from minimized', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    delete require.cache[require.resolve('./folder-cell')];
    require('./folder-cell');

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var connA = makeConnection('a', 'A');
    var connB = makeConnection('b', 'B');
    engine._addToMinimized('a', connA);
    engine._addToMinimized('b', connB);
    expect(engine._minimized.size).to.equal(2);

    var fc = makeFolderCell(window, 'f1', 'Folder', [
      { id: 'a', name: 'A', connection: connA },
      { id: 'b', name: 'B', connection: connB }
    ]);
    engine.assignFolder(cell, fc);

    expect(engine._minimized.size).to.equal(0);
  });

  it('assignFolder renders header with folder name and tabs', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    delete require.cache[require.resolve('./folder-cell')];
    require('./folder-cell');

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var connA = makeConnection('a', 'A');
    var connB = makeConnection('b', 'B');
    var fc = makeFolderCell(window, 'f1', 'MyFolder', [
      { id: 'a', name: 'A', connection: connA },
      { id: 'b', name: 'B', connection: connB }
    ]);

    engine.assignFolder(cell, fc);

    var header = cell.querySelector('.cell-header');
    expect(header.querySelector('.cell-header-folder-name')).to.exist;
    expect(header.querySelector('.cell-header-folder-name').textContent).to.equal('MyFolder');
    expect(header.querySelectorAll('.cell-header-tab').length).to.equal(2);
  });

  it('_switchFolderTab detaches old and attaches new connection', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    delete require.cache[require.resolve('./folder-cell')];
    require('./folder-cell');

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var connA = makeConnection('a', 'A');
    var connB = makeConnection('b', 'B');
    var fc = makeFolderCell(window, 'f1', 'Folder', [
      { id: 'a', name: 'A', connection: connA },
      { id: 'b', name: 'B', connection: connB }
    ]);
    engine.assignFolder(cell, fc);
    connA.attach.resetHistory();
    connA.detach.resetHistory();

    engine._switchFolderTab(cell, 'b');

    expect(connA.detach.calledOnce).to.be.true;
    expect(connB.attach.calledOnce).to.be.true;

    var info = engine._cellMap.get(cell);
    expect(info.terminalId).to.equal('b');
    expect(info.connection).to.equal(connB);
  });

  it('_switchFolderTab with current active id is a no-op', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    delete require.cache[require.resolve('./folder-cell')];
    require('./folder-cell');

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var connA = makeConnection('a', 'A');
    var fc = makeFolderCell(window, 'f1', 'Folder', [
      { id: 'a', name: 'A', connection: connA }
    ]);
    engine.assignFolder(cell, fc);
    connA.detach.resetHistory();

    engine._switchFolderTab(cell, 'a'); // already active

    expect(connA.detach.called).to.be.false;
  });

  it('_switchFolderTab with invalid cell is a no-op', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    delete require.cache[require.resolve('./folder-cell')];
    require('./folder-cell');

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    // cell has no folderCell — should not throw
    expect(function () {
      engine._switchFolderTab(cell, 'x');
    }).to.not.throw();
  });

  it('minimizeTerminal on active folder tab switches to next', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    delete require.cache[require.resolve('./folder-cell')];
    require('./folder-cell');

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var connA = makeConnection('a', 'A');
    var connB = makeConnection('b', 'B');
    var fc = makeFolderCell(window, 'f1', 'Folder', [
      { id: 'a', name: 'A', connection: connA },
      { id: 'b', name: 'B', connection: connB }
    ]);
    engine.assignFolder(cell, fc);

    engine.minimizeTerminal('a');

    expect(connA.detach.called).to.be.true;
    expect(engine._minimized.has('a')).to.be.true;
    var info = engine._cellMap.get(cell);
    expect(info.terminalId).to.equal('b');
    expect(info.connection).to.equal(connB);
  });

  it('minimizeTerminal on last folder tab clears cell', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    delete require.cache[require.resolve('./folder-cell')];
    require('./folder-cell');

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var connA = makeConnection('a', 'A');
    var fc = makeFolderCell(window, 'f1', 'Folder', [
      { id: 'a', name: 'A', connection: connA }
    ]);
    engine.assignFolder(cell, fc);

    engine.minimizeTerminal('a');

    expect(engine._minimized.has('a')).to.be.true;
    expect(cell.classList.contains('cell-empty')).to.be.true;
    var info = engine._cellMap.get(cell);
    expect(info.terminalId).to.be.null;
  });

  it('_clearCell on folder cell moves all terminals to minimized', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    delete require.cache[require.resolve('./folder-cell')];
    require('./folder-cell');

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var connA = makeConnection('a', 'A');
    var connB = makeConnection('b', 'B');
    var fc = makeFolderCell(window, 'f1', 'Folder', [
      { id: 'a', name: 'A', connection: connA },
      { id: 'b', name: 'B', connection: connB }
    ]);
    engine.assignFolder(cell, fc);

    engine._clearCell(cell);

    expect(engine._minimized.has('a')).to.be.true;
    expect(engine._minimized.has('b')).to.be.true;
    expect(cell.classList.contains('cell-empty')).to.be.true;
    var info = engine._cellMap.get(cell);
    expect(info.folderCell).to.be.null;
  });

  it('grid resize preserves folder cell at stable position', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    delete require.cache[require.resolve('./folder-cell')];
    require('./folder-cell');

    engine.setGrid('2x1');
    var cells = grid.querySelectorAll('.grid-cell');
    var connA = makeConnection('a', 'A');
    var connB = makeConnection('b', 'B');
    var fc = makeFolderCell(window, 'f1', 'Folder', [
      { id: 'a', name: 'A', connection: connA },
      { id: 'b', name: 'B', connection: connB }
    ]);
    engine.assignFolder(cells[0], fc);

    // Grow to 2x2 — cell 0 is preserved
    engine.setGrid('2x2');

    var info = engine._cellMap.get(engine._cells[0]);
    expect(info.folderCell).to.equal(fc);
    expect(info.terminalId).to.equal('a');
  });

  it('refitAll works with folder cell (refits active connection)', function () {
    var grid = document.getElementById('grid-container');
    var engine = new LayoutEngine(grid);

    delete require.cache[require.resolve('./folder-cell')];
    require('./folder-cell');

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var connA = makeConnection('a', 'A');
    var connB = makeConnection('b', 'B');
    var fc = makeFolderCell(window, 'f1', 'Folder', [
      { id: 'a', name: 'A', connection: connA },
      { id: 'b', name: 'B', connection: connB }
    ]);
    engine.assignFolder(cell, fc);
    connA.refit.resetHistory();
    connB.refit.resetHistory();

    engine.refitAll();

    // Only the active (A) should be refit via the cellMap entry
    expect(connA.refit.called).to.be.true;
    expect(connB.refit.called).to.be.false;
  });
});
