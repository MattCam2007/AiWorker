const { expect } = require('chai');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');

describe('FileTree context menu', function () {
  let dom, window, document, FileTree, container;

  beforeEach(function () {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://localhost:3000',
      runScripts: 'dangerously'
    });
    window = dom.window;
    document = window.document;
    global.window = window;
    global.document = document;

    // Stub fetch on the jsdom window
    window.fetch = sinon.stub().resolves({
      json: () => Promise.resolve([
        { name: 'file.txt', path: 'file.txt', type: 'file' },
        { name: 'subdir', path: 'subdir', type: 'dir' }
      ])
    });
    global.fetch = window.fetch;

    // Load FileTree into this window context
    const code = require('fs').readFileSync(require('path').join(__dirname, 'filetree.js'), 'utf8');
    const scriptEl = document.createElement('script');
    scriptEl.textContent = code;
    document.head.appendChild(scriptEl);
    FileTree = window.TerminalDeck.FileTree;

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(function () {
    sinon.restore();
    delete global.window;
    delete global.document;
    delete global.fetch;
  });

  it('shows context menu on right-click of a file item', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      var fileItem = container.querySelector('.ft-file');
      expect(fileItem).to.exist;

      var event = new window.MouseEvent('contextmenu', {
        clientX: 100, clientY: 100, bubbles: true, cancelable: true
      });
      fileItem.dispatchEvent(event);

      var menu = document.body.querySelector('.ep-context-menu');
      expect(menu).to.exist;
      done();
    });
  });

  it('file context menu contains Rename, Delete, Cut, Copy', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      var fileItem = container.querySelector('.ft-file');
      var event = new window.MouseEvent('contextmenu', {
        clientX: 100, clientY: 100, bubbles: true, cancelable: true
      });
      fileItem.dispatchEvent(event);

      var menu = document.body.querySelector('.ep-context-menu');
      var labels = Array.from(menu.querySelectorAll('.ep-ctx-item-label')).map(function (el) { return el.textContent; });
      expect(labels).to.include('Rename');
      expect(labels).to.include('Delete');
      expect(labels).to.include('Cut');
      expect(labels).to.include('Copy');
      done();
    });
  });

  it('dir context menu contains New File, New Folder, Rename, Delete, Cut, Copy', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      var dirItem = container.querySelector('.ft-dir');
      var event = new window.MouseEvent('contextmenu', {
        clientX: 100, clientY: 100, bubbles: true, cancelable: true
      });
      dirItem.dispatchEvent(event);

      var menu = document.body.querySelector('.ep-context-menu');
      var labels = Array.from(menu.querySelectorAll('.ep-ctx-item-label')).map(function (el) { return el.textContent; });
      expect(labels).to.include('New File');
      expect(labels).to.include('New Folder');
      expect(labels).to.include('Rename');
      expect(labels).to.include('Delete');
      done();
    });
  });

  it('dir context menu shows Paste only when clipboard is set', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      var dirItem = container.querySelector('.ft-dir');

      // Without clipboard
      var event = new window.MouseEvent('contextmenu', { clientX: 100, clientY: 100, bubbles: true, cancelable: true });
      dirItem.dispatchEvent(event);
      var menu = document.body.querySelector('.ep-context-menu');
      var labels = Array.from(menu.querySelectorAll('.ep-ctx-item-label')).map(function (el) { return el.textContent; });
      expect(labels).to.not.include('Paste');
      ft._dismissContextMenu();

      // With clipboard set
      ft._clipboard = { path: 'file.txt', type: 'file', op: 'copy' };
      var event2 = new window.MouseEvent('contextmenu', { clientX: 100, clientY: 100, bubbles: true, cancelable: true });
      dirItem.dispatchEvent(event2);
      var menu2 = document.body.querySelector('.ep-context-menu');
      var labels2 = Array.from(menu2.querySelectorAll('.ep-ctx-item-label')).map(function (el) { return el.textContent; });
      expect(labels2).to.include('Paste');
      done();
    });
  });

  it('dismisses context menu on Escape', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      var fileItem = container.querySelector('.ft-file');
      var event = new window.MouseEvent('contextmenu', { clientX: 100, clientY: 100, bubbles: true, cancelable: true });
      fileItem.dispatchEvent(event);
      expect(document.body.querySelector('.ep-context-menu')).to.exist;

      var esc = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(esc);
      expect(document.body.querySelector('.ep-context-menu')).to.not.exist;
      done();
    });
  });

  it('only one context menu at a time', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      var fileItem = container.querySelector('.ft-file');
      var e1 = new window.MouseEvent('contextmenu', { clientX: 100, clientY: 100, bubbles: true, cancelable: true });
      fileItem.dispatchEvent(e1);
      var e2 = new window.MouseEvent('contextmenu', { clientX: 200, clientY: 200, bubbles: true, cancelable: true });
      fileItem.dispatchEvent(e2);
      var menus = document.body.querySelectorAll('.ep-context-menu');
      expect(menus).to.have.lengthOf(1);
      done();
    });
  });
});

describe('FileTree create/delete', function () {
  let dom, window, document, FileTree, container;

  beforeEach(function () {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://localhost:3000',
      runScripts: 'dangerously'
    });
    window = dom.window;
    document = window.document;
    global.window = window;
    global.document = document;

    // Default fetch stub
    window.fetch = sinon.stub().resolves({
      json: () => Promise.resolve([
        { name: 'file.txt', path: 'file.txt', type: 'file' },
        { name: 'subdir', path: 'subdir', type: 'dir' }
      ])
    });
    global.fetch = window.fetch;

    const code = require('fs').readFileSync(require('path').join(__dirname, 'filetree.js'), 'utf8');
    const scriptEl = document.createElement('script');
    scriptEl.textContent = code;
    document.head.appendChild(scriptEl);
    FileTree = window.TerminalDeck.FileTree;

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(function () {
    sinon.restore();
    delete global.window;
    delete global.document;
    delete global.fetch;
  });

  it('_doCreate shows inline input in parent dir', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      ft._doCreate('.', 'file');
      var input = container.querySelector('.ft-rename-input');
      expect(input).to.exist;
      done();
    });
  });

  it('_doCreate cancels on Escape', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      ft._doCreate('.', 'file');
      var input = container.querySelector('.ft-rename-input');
      expect(input).to.exist;
      var esc = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      input.dispatchEvent(esc);
      expect(container.querySelector('.ft-rename-input')).to.not.exist;
      done();
    });
  });

  it('_doCreate calls create API on Enter', function (done) {
    global.fetch = sinon.stub().callsFake(function (url, opts) {
      if (url === '/api/files?path=.') {
        return Promise.resolve({ json: () => Promise.resolve([
          { name: 'file.txt', path: 'file.txt', type: 'file' }
        ]) });
      }
      if (url === '/api/fileops/create') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ name: 'new.txt', path: 'new.txt', type: 'file' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    window.fetch = global.fetch;
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      ft._doCreate('.', 'file');
      var input = container.querySelector('.ft-rename-input');
      input.value = 'new.txt';
      var enterKey = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      input.dispatchEvent(enterKey);
      setTimeout(function () {
        var calls = global.fetch.args.map(function (a) { return a[0]; });
        expect(calls).to.include('/api/fileops/create');
        done();
      }, 50);
    });
  });

  it('_doDelete calls confirm and delete API', function (done) {
    window.confirm = sinon.stub().returns(true);
    global.fetch = sinon.stub().callsFake(function (url, opts) {
      if (url === '/api/files?path=.') {
        return Promise.resolve({ json: () => Promise.resolve([
          { name: 'file.txt', path: 'file.txt', type: 'file' }
        ]) });
      }
      if (url === '/api/fileops/delete') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    window.fetch = global.fetch;
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      ft._doDelete('file.txt');
      expect(window.confirm.calledOnce).to.be.true;
      setTimeout(function () {
        var calls = global.fetch.args.map(function (a) { return a[0]; });
        expect(calls).to.include('/api/fileops/delete');
        done();
      }, 50);
    });
  });

  it('_doDelete does not call API when confirm returns false', function (done) {
    window.confirm = sinon.stub().returns(false);
    var fetchStub = sinon.stub().resolves({ json: () => Promise.resolve([]) });
    global.fetch = fetchStub;
    window.fetch = fetchStub;
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft._doDelete('file.txt');
    setTimeout(function () {
      var calls = fetchStub.args.map(function (a) { return a[0]; });
      expect(calls).to.not.include('/api/fileops/delete');
      done();
    }, 20);
  });

  it('_refreshDir invalidates cache for dir', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      ft._cache['subdir'] = [{ name: 'old.txt', path: 'subdir/old.txt', type: 'file' }];
      ft._refreshDir('subdir');
      expect(ft._cache['subdir']).to.be.undefined;
      done();
    });
  });
});

describe('FileTree clipboard', function () {
  let dom, window, document, FileTree, container;

  beforeEach(function () {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://localhost:3000',
      runScripts: 'dangerously'
    });
    window = dom.window;
    document = window.document;
    global.window = window;
    global.document = document;

    window.fetch = sinon.stub().resolves({
      json: () => Promise.resolve([
        { name: 'file.txt', path: 'file.txt', type: 'file' },
        { name: 'subdir', path: 'subdir', type: 'dir' }
      ])
    });
    global.fetch = window.fetch;

    const code = require('fs').readFileSync(require('path').join(__dirname, 'filetree.js'), 'utf8');
    const scriptEl = document.createElement('script');
    scriptEl.textContent = code;
    document.head.appendChild(scriptEl);
    FileTree = window.TerminalDeck.FileTree;

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(function () {
    sinon.restore();
    delete global.window;
    delete global.document;
    delete global.fetch;
  });

  it('_doCut sets clipboard op=cut and adds ft-cut class', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      ft._doCut('file.txt', 'file');
      expect(ft._clipboard).to.deep.equal({ path: 'file.txt', type: 'file', op: 'cut' });
      var item = container.querySelector('[data-path="file.txt"]');
      expect(item.classList.contains('ft-cut')).to.be.true;
      done();
    });
  });

  it('_doCopy sets clipboard op=copy without ft-cut class', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      ft._doCopy('file.txt', 'file');
      expect(ft._clipboard).to.deep.equal({ path: 'file.txt', type: 'file', op: 'copy' });
      var item = container.querySelector('[data-path="file.txt"]');
      expect(item.classList.contains('ft-cut')).to.be.false;
      done();
    });
  });

  it('_doCut removes ft-cut from previously cut item', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      ft._doCut('file.txt', 'file');
      var item = container.querySelector('[data-path="file.txt"]');
      expect(item.classList.contains('ft-cut')).to.be.true;

      // Now cut the dir
      ft._doCut('subdir', 'dir');
      expect(item.classList.contains('ft-cut')).to.be.false;
      expect(ft._clipboard.path).to.equal('subdir');
      done();
    });
  });

  it('_doPaste calls move API on cut', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      ft._clipboard = { path: 'file.txt', type: 'file', op: 'cut' };

      window.fetch = sinon.stub().callsFake(function (url) {
        if (url === '/api/fileops/move') {
          return Promise.resolve({ json: () => Promise.resolve({ name: 'file.txt', path: 'subdir/file.txt', type: 'file' }) });
        }
        return Promise.resolve({ json: () => Promise.resolve([]) });
      });
      global.fetch = window.fetch;

      ft._doPaste('subdir');
      setTimeout(function () {
        var calls = window.fetch.args.map(function (a) { return a[0]; });
        expect(calls).to.include('/api/fileops/move');
        done();
      }, 50);
    });
  });

  it('_doPaste calls copy API on copy', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      ft._clipboard = { path: 'file.txt', type: 'file', op: 'copy' };

      window.fetch = sinon.stub().callsFake(function (url) {
        if (url === '/api/fileops/copy') {
          return Promise.resolve({ json: () => Promise.resolve({ name: 'file.txt', path: 'subdir/file.txt', type: 'file' }) });
        }
        return Promise.resolve({ json: () => Promise.resolve([]) });
      });
      global.fetch = window.fetch;

      ft._doPaste('subdir');
      setTimeout(function () {
        var calls = window.fetch.args.map(function (a) { return a[0]; });
        expect(calls).to.include('/api/fileops/copy');
        done();
      }, 50);
    });
  });

  it('_doPaste clears clipboard after successful paste', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      ft._clipboard = { path: 'file.txt', type: 'file', op: 'copy' };

      window.fetch = sinon.stub().callsFake(function (url) {
        if (url === '/api/fileops/copy') {
          return Promise.resolve({ json: () => Promise.resolve({ name: 'file.txt', path: 'subdir/file.txt', type: 'file' }) });
        }
        return Promise.resolve({ json: () => Promise.resolve([]) });
      });
      global.fetch = window.fetch;

      ft._doPaste('subdir');
      setTimeout(function () {
        expect(ft._clipboard).to.be.null;
        done();
      }, 50);
    });
  });

  it('_doPaste is a no-op when clipboard is null', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      var fetchStub = sinon.stub().resolves({ json: () => Promise.resolve({}) });
      window.fetch = fetchStub;
      global.fetch = fetchStub;
      ft._clipboard = null;
      ft._doPaste('subdir');
      setTimeout(function () {
        var calls = fetchStub.args.map(function (a) { return a[0]; });
        expect(calls).to.not.include('/api/fileops/move');
        expect(calls).to.not.include('/api/fileops/copy');
        done();
      }, 20);
    });
  });
});

describe('FileTree inline rename', function () {
  let dom, window, document, FileTree, container;

  beforeEach(function () {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://localhost:3000',
      runScripts: 'dangerously'
    });
    window = dom.window;
    document = window.document;
    global.window = window;
    global.document = document;

    window.fetch = sinon.stub().resolves({
      json: () => Promise.resolve([
        { name: 'file.txt', path: 'file.txt', type: 'file' },
        { name: 'subdir', path: 'subdir', type: 'dir' }
      ])
    });
    global.fetch = window.fetch;

    const code = require('fs').readFileSync(require('path').join(__dirname, 'filetree.js'), 'utf8');
    const scriptEl = document.createElement('script');
    scriptEl.textContent = code;
    document.head.appendChild(scriptEl);
    FileTree = window.TerminalDeck.FileTree;

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(function () {
    sinon.restore();
    delete global.window;
    delete global.document;
    delete global.fetch;
  });

  it('replaces label with input on _startRename', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      var fileItem = container.querySelector('.ft-file');
      ft._startRename('file.txt', 'file');
      var input = fileItem.querySelector('.ft-rename-input');
      expect(input).to.exist;
      expect(input.value).to.equal('file.txt');
      done();
    });
  });

  it('cancels on Escape and restores label', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      ft._startRename('file.txt', 'file');
      var fileItem = container.querySelector('.ft-file');
      var input = fileItem.querySelector('.ft-rename-input');
      var esc = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      input.dispatchEvent(esc);
      expect(fileItem.querySelector('.ft-label')).to.exist;
      expect(fileItem.querySelector('.ft-rename-input')).to.not.exist;
      done();
    });
  });

  it('cancels on empty input (no API call)', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      var renameFetch = sinon.stub().resolves({ json: () => Promise.resolve({}) });
      global.fetch = renameFetch;
      window.fetch = renameFetch;
      ft._startRename('file.txt', 'file');
      var fileItem = container.querySelector('.ft-file');
      var input = fileItem.querySelector('.ft-rename-input');
      input.value = '  ';
      var enter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      input.dispatchEvent(enter);
      expect(fileItem.querySelector('.ft-rename-input')).to.not.exist;
      expect(renameFetch.args.some(function (a) { return a[0] === '/api/fileops/rename'; })).to.be.false;
      done();
    });
  });

  it('calls rename API on Enter with new name', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      var renameFetch = sinon.stub().callsFake(function (url) {
        if (url === '/api/fileops/rename') {
          return Promise.resolve({ json: () => Promise.resolve({ name: 'newname.txt', path: 'newname.txt', type: 'file' }) });
        }
        return Promise.resolve({ json: () => Promise.resolve([]) });
      });
      global.fetch = renameFetch;
      window.fetch = renameFetch;
      ft._startRename('file.txt', 'file');
      var fileItem = container.querySelector('.ft-file');
      var input = fileItem.querySelector('.ft-rename-input');
      input.value = 'newname.txt';
      var enter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      input.dispatchEvent(enter);
      setTimeout(function () {
        var calls = renameFetch.args.map(function (a) { return a[0]; });
        expect(calls).to.include('/api/fileops/rename');
        done();
      }, 50);
    });
  });

  it('commits on blur', function (done) {
    var ft = new FileTree(container, { onFileClick: function () {} });
    ft.init().then(function () {
      var renameFetch = sinon.stub().callsFake(function (url) {
        if (url === '/api/fileops/rename') {
          return Promise.resolve({ json: () => Promise.resolve({ name: 'blurred.txt', path: 'blurred.txt', type: 'file' }) });
        }
        return Promise.resolve({ json: () => Promise.resolve([]) });
      });
      global.fetch = renameFetch;
      window.fetch = renameFetch;
      ft._startRename('file.txt', 'file');
      var fileItem = container.querySelector('.ft-file');
      var input = fileItem.querySelector('.ft-rename-input');
      input.value = 'blurred.txt';
      var blurEvent = new window.FocusEvent('blur', { bubbles: true });
      input.dispatchEvent(blurEvent);
      setTimeout(function () {
        var calls = renameFetch.args.map(function (a) { return a[0]; });
        expect(calls).to.include('/api/fileops/rename');
        done();
      }, 50);
    });
  });
});
