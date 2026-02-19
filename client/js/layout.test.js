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
      isActive: sinon.stub().returns(true),
      getLastOutput: sinon.stub().returns('')
    };
  }

  beforeEach(function () {
    dom = new JSDOM(
      '<!DOCTYPE html><html><body>' +
        '<div id="grid-container"></div>' +
        '<div id="minimized-strip"></div>' +
        '<div id="fullscreen-overlay" class="hidden">' +
        '<button class="fullscreen-close"></button>' +
        '<div class="fullscreen-terminal"></div>' +
        '</div>' +
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
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('1x1');
    expect(grid.style.gridTemplateColumns).to.equal('repeat(1, 1fr)');
    expect(grid.style.gridTemplateRows).to.equal('repeat(1, 1fr)');
    expect(grid.querySelectorAll('.grid-cell').length).to.equal(1);
  });

  it('setGrid("2x2") creates 4 cells with correct grid template', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('2x2');
    expect(grid.style.gridTemplateColumns).to.equal('repeat(2, 1fr)');
    expect(grid.style.gridTemplateRows).to.equal('repeat(2, 1fr)');
    expect(grid.querySelectorAll('.grid-cell').length).to.equal(4);
  });

  it('setGrid("3x2") creates 6 cells with correct columns', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('3x2');
    expect(grid.style.gridTemplateColumns).to.equal('repeat(3, 1fr)');
    expect(grid.querySelectorAll('.grid-cell').length).to.equal(6);
  });

  it('all 8 presets generate correct CSS grid templates', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);
    var presets = LayoutEngine.GRID_PRESETS;

    Object.keys(presets).forEach(function (spec) {
      engine.setGrid(spec);
      var p = presets[spec];
      expect(grid.style.gridTemplateColumns).to.equal('repeat(' + p.cols + ', 1fr)');
      expect(grid.style.gridTemplateRows).to.equal('repeat(' + p.rows + ', 1fr)');
      expect(grid.querySelectorAll('.grid-cell').length).to.equal(p.cols * p.rows);
    });
  });

  it('new cells have cell-empty class', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('2x2');
    var cells = grid.querySelectorAll('.grid-cell');
    cells.forEach(function (cell) {
      expect(cell.classList.contains('cell-empty')).to.be.true;
    });
  });

  it('applyLayout() assigns terminals to cells from layout config', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    var connections = {
      t1: makeConnection('t1', 'Terminal 1'),
      t2: makeConnection('t2', 'Terminal 2')
    };

    var layout = {
      grid: '2x1',
      cells: [['t1', 't2']]
    };

    engine.applyLayout(layout, connections);

    expect(connections.t1.attach.calledOnce).to.be.true;
    expect(connections.t2.attach.calledOnce).to.be.true;
  });

  it('applyLayout() puts unassigned terminals in minimized strip', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    var connections = {
      t1: makeConnection('t1', 'Terminal 1'),
      t2: makeConnection('t2', 'Terminal 2'),
      t3: makeConnection('t3', 'Terminal 3')
    };

    var layout = {
      grid: '1x1',
      cells: [['t1']]
    };

    engine.applyLayout(layout, connections);

    // t2 and t3 should be in strip
    expect(strip.querySelectorAll('.strip-item').length).to.equal(2);
    var stripNames = Array.from(strip.querySelectorAll('.strip-name')).map(function (el) {
      return el.textContent;
    });
    expect(stripNames).to.include('Terminal 2');
    expect(stripNames).to.include('Terminal 3');
  });

  it('assignTerminal() calls connection.attach() on cell terminal mount', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

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
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

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

  it('strip item click sets _swapSource', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('1x1');
    var conn = makeConnection('t1', 'Term 1');
    engine._addToStrip('t1', conn);

    var item = strip.querySelector('.strip-item');
    item.click();

    expect(engine._swapSource).to.not.be.null;
    expect(engine._swapSource.terminalId).to.equal('t1');
  });

  it('clicking already-selected strip item deselects it', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('1x1');
    var conn = makeConnection('t1', 'Term 1');
    engine._addToStrip('t1', conn);

    var item = strip.querySelector('.strip-item');
    item.click(); // select
    expect(engine._swapSource).to.not.be.null;

    item.click(); // deselect
    expect(engine._swapSource).to.be.null;
  });

  it('cell click with _swapSource triggers swap', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var oldConn = makeConnection('old', 'Old Terminal');
    engine.assignTerminal(cell, 'old', oldConn);

    var newConn = makeConnection('new', 'New Terminal');
    engine._addToStrip('new', newConn);

    // Select from strip
    var stripItem = strip.querySelector('.strip-item');
    stripItem.click();

    // Click cell header to trigger swap
    var header = cell.querySelector('.cell-header');
    header.click();

    // Old should have been detached and moved to strip
    expect(oldConn.detach.called).to.be.true;
    // New should be attached
    expect(newConn.attach.calledOnce).to.be.true;
    // Swap source cleared
    expect(engine._swapSource).to.be.null;
  });

  it('swap calls refit() on affected connections', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');

    var newConn = makeConnection('new', 'New');
    engine._addToStrip('new', newConn);

    strip.querySelector('.strip-item').click();
    cell.querySelector('.cell-header').click();

    expect(newConn.refit.called).to.be.true;
  });

  it('switching to smaller grid moves only excess terminals to strip', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    var connections = {
      t1: makeConnection('t1', 'T1'),
      t2: makeConnection('t2', 'T2'),
      t3: makeConnection('t3', 'T3'),
      t4: makeConnection('t4', 'T4')
    };

    // Start with 2x2 (4 cells)
    engine.applyLayout({ grid: '2x2', cells: [['t1', 't2'], ['t3', 't4']] }, connections);

    // Switch to 1x1 — only terminals that don't fit should move to strip
    engine.setGrid('1x1');

    // t1 stays at (0,0), t2/t3/t4 go to strip
    expect(strip.querySelectorAll('.strip-item').length).to.equal(3);
    var cellInfo = engine._cellMap.get(engine._cells[0]);
    expect(cellInfo.terminalId).to.equal('t1');
  });

  it('growing grid preserves terminals at matching (row,col) positions', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    var connections = {
      t1: makeConnection('t1', 'T1'),
      t2: makeConnection('t2', 'T2'),
      t3: makeConnection('t3', 'T3'),
      t4: makeConnection('t4', 'T4')
    };

    // Start with 2x2
    engine.applyLayout({ grid: '2x2', cells: [['t1', 't2'], ['t3', 't4']] }, connections);

    // Switch to 3x2 — all 4 fit, no terminals should be minimized
    engine.setGrid('3x2');

    expect(strip.querySelectorAll('.strip-item').length).to.equal(0);
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
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    var connections = {
      t1: makeConnection('t1', 'T1'),
      t2: makeConnection('t2', 'T2'),
      t3: makeConnection('t3', 'T3'),
      t4: makeConnection('t4', 'T4')
    };

    // Start with 2x2
    engine.applyLayout({ grid: '2x2', cells: [['t1', 't2'], ['t3', 't4']] }, connections);

    // Switch to 2x1 — only row 0 fits
    engine.setGrid('2x1');

    // t1 and t2 stay (row 0), t3 and t4 minimized (row 1)
    expect(engine._cells.length).to.equal(2);
    expect(engine._cellMap.get(engine._cells[0]).terminalId).to.equal('t1');
    expect(engine._cellMap.get(engine._cells[1]).terminalId).to.equal('t2');
    expect(strip.querySelectorAll('.strip-item').length).to.equal(2);
  });

  it('empty cell click with selection places the terminal', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Term 1');
    engine._addToStrip('t1', conn);

    // Select from strip
    strip.querySelector('.strip-item').click();

    // Click empty cell
    cell.click();

    // Should have placed terminal
    expect(conn.attach.calledOnce).to.be.true;
    expect(engine._swapSource).to.be.null;
  });

  it('empty cell click without selection shows popover', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('2x1');
    var conn = makeConnection('t1', 'Term 1');
    engine._addToStrip('t1', conn);

    // Click empty cell without selection
    var cells = grid.querySelectorAll('.grid-cell');
    cells[0].click();

    var popover = cells[0].querySelector('.cell-popover');
    expect(popover).to.exist;
    expect(popover.querySelectorAll('.popover-item').length).to.equal(1);
  });

  it('enterFullscreen() shows overlay and attaches terminal', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Term 1');
    engine.assignTerminal(cell, 't1', conn);

    engine.enterFullscreen('t1', conn);

    var overlay = document.getElementById('fullscreen-overlay');
    expect(overlay.classList.contains('hidden')).to.be.false;
    // attach called: once for assign, once for fullscreen
    expect(conn.attach.callCount).to.equal(2);
    expect(conn.detach.calledOnce).to.be.true;
  });

  it('exitFullscreen() hides overlay and re-attaches to original cell', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Term 1');
    engine.assignTerminal(cell, 't1', conn);

    engine.enterFullscreen('t1', conn);
    engine.exitFullscreen();

    var overlay = document.getElementById('fullscreen-overlay');
    expect(overlay.classList.contains('hidden')).to.be.true;
    // attach: assign(1) + fullscreen(2) + re-attach(3)
    expect(conn.attach.callCount).to.equal(3);
  });

  it('Escape key calls exitFullscreen()', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Term 1');
    engine.assignTerminal(cell, 't1', conn);

    engine.enterFullscreen('t1', conn);

    // Simulate Escape key
    var event = new window.KeyboardEvent('keydown', { key: 'Escape' });
    document.dispatchEvent(event);

    var overlay = document.getElementById('fullscreen-overlay');
    expect(overlay.classList.contains('hidden')).to.be.true;
  });

  it('refitAll() calls refit() on all assigned connections', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    var connections = {
      t1: makeConnection('t1', 'T1'),
      t2: makeConnection('t2', 'T2')
    };

    engine.applyLayout({ grid: '2x1', cells: [['t1', 't2']] }, connections);

    // Reset refit call counts
    connections.t1.refit.resetHistory();
    connections.t2.refit.resetHistory();

    engine.refitAll();

    expect(connections.t1.refit.calledOnce).to.be.true;
    expect(connections.t2.refit.calledOnce).to.be.true;
  });

  it('mobile detection forces 1x1 grid', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

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
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Test');
    engine.assignTerminal(cell, 't1', conn);

    // rAF is stubbed to run immediately, so refit should have been called
    expect(conn.refit.called).to.be.true;
  });

  it('assignTerminal() shows close button in header', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Test');
    engine.assignTerminal(cell, 't1', conn);

    var closeBtn = cell.querySelector('.cell-header-close');
    expect(closeBtn).to.exist;
  });

  it('close button in header calls _onCloseTerminal callback', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

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

  it('strip item has close button', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('1x1');
    var conn = makeConnection('t1', 'Term 1');
    engine._addToStrip('t1', conn);

    var closeBtn = strip.querySelector('.strip-close');
    expect(closeBtn).to.exist;
  });

  it('strip close button calls _onCloseTerminal callback', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    var closeSpy = sinon.spy();
    engine._onCloseTerminal = closeSpy;

    engine.setGrid('1x1');
    var conn = makeConnection('t1', 'Term 1');
    engine._addToStrip('t1', conn);

    var closeBtn = strip.querySelector('.strip-close');
    closeBtn.click();

    expect(closeSpy.calledOnce).to.be.true;
    expect(closeSpy.calledWith('t1')).to.be.true;
  });

  it('strip close button stopPropagation prevents swap', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    var closeSpy = sinon.spy();
    engine._onCloseTerminal = closeSpy;

    engine.setGrid('1x1');
    var conn = makeConnection('t1', 'Term 1');
    engine._addToStrip('t1', conn);

    var closeBtn = strip.querySelector('.strip-close');
    closeBtn.click();

    // _swapSource should NOT be set because stopPropagation prevented
    // the strip item click handler from firing
    expect(engine._swapSource).to.be.null;
    expect(closeSpy.calledOnce).to.be.true;
  });

  it('assignTerminal() shows edit button in header', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('1x1');
    var cell = grid.querySelector('.grid-cell');
    var conn = makeConnection('t1', 'Test');
    engine.assignTerminal(cell, 't1', conn);

    var editBtn = cell.querySelector('.cell-header-edit');
    expect(editBtn).to.exist;
  });

  it('edit button click opens edit popover', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

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
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

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
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

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
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

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

  it('updateHeader() updates strip item name', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    engine.setGrid('1x1');
    var conn = makeConnection('t1', 'Original');
    engine._addToStrip('t1', conn);

    engine.updateHeader('t1', 'Updated', null, null);

    var stripName = strip.querySelector('.strip-name');
    expect(stripName.textContent).to.equal('Updated');
  });

  it('assignTerminal() applies headerBg and headerColor from connection config', function () {
    var grid = document.getElementById('grid-container');
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

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
    var strip = document.getElementById('minimized-strip');
    var engine = new LayoutEngine(grid, strip);

    var selectSpy = sinon.spy();
    var container = engine._createColorSwatches(null, selectSpy);

    expect(container.className).to.equal('edit-swatches');
    // 1 none + 20 colors + 1 native input
    var swatches = container.querySelectorAll('.edit-swatch');
    expect(swatches.length).to.equal(21);
    var nativeInput = container.querySelector('.edit-color-native');
    expect(nativeInput).to.exist;
  });
});
