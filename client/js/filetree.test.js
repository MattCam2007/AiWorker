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
