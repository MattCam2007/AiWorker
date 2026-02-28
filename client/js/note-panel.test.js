const { expect } = require('chai');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');

describe('NotePanel', function () {
  let dom, window, NotePanel;

  beforeEach(function () {
    dom = new JSDOM(
      '<!DOCTYPE html><html><body><div id="mount"></div></body></html>',
      { url: 'http://localhost:3000' }
    );
    window = dom.window;

    global.window = window;
    global.document = window.document;
    global.ResizeObserver = undefined;
    global.requestAnimationFrame = function (cb) { cb(); };
    global.Event = window.Event;

    // Mock fetch
    global.fetch = sinon.stub();

    // Mock marked
    global.marked = {
      parse: function (text) { return '<p>' + text + '</p>'; }
    };

    // Load NotePanel
    delete require.cache[require.resolve('./note-panel')];
    require('./note-panel');

    NotePanel = window.TerminalDeck.NotePanel;
  });

  afterEach(function () {
    delete global.window;
    delete global.document;
    delete global.ResizeObserver;
    delete global.requestAnimationFrame;
    delete global.Event;
    delete global.fetch;
    delete global.marked;
    sinon.restore();
  });

  it('NotePanel exists on window.TerminalDeck namespace', function () {
    expect(NotePanel).to.be.a('function');
  });

  it('constructor stores config', function () {
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    expect(panel.id).to.equal('todo');
    expect(panel.config.name).to.equal('Todo');
    expect(panel.type).to.equal('note');
  });

  it('mount() creates DOM structure with textarea', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '# Hello' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);

    expect(mount.querySelector('.note-panel-wrapper')).to.exist;
    expect(mount.querySelector('.np-textarea')).to.exist;
    expect(mount.querySelector('.np-toolbar')).to.exist;
    expect(mount.querySelector('.np-preview')).to.exist;
  });

  it('mount() calls fetch for note content', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '# Hello' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);

    expect(global.fetch.calledOnce).to.be.true;
    expect(global.fetch.firstCall.args[0]).to.equal('/api/notes/todo');
  });

  it('save() calls PUT with current content', function (done) {
    global.fetch.onFirstCall().resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '' }); }
    });
    global.fetch.onSecondCall().resolves({
      ok: true,
      json: function () { return Promise.resolve({ success: true, saved: '2026-01-01' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);

    // Set content directly on the textarea
    panel._textarea.value = '# Updated';
    panel.save().then(function () {
      var call = global.fetch.secondCall;
      expect(call.args[0]).to.equal('/api/notes/todo');
      expect(call.args[1].method).to.equal('PUT');
      var body = JSON.parse(call.args[1].body);
      expect(body.content).to.equal('# Updated');
      done();
    }).catch(done);
  });

  it('isDirty() returns false initially', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);

    expect(panel.isDirty()).to.be.false;
  });

  it('isDirty() returns true after content change', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);

    panel._dirty = true;
    expect(panel.isDirty()).to.be.true;
  });

  it('unmount() cleans up DOM', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);

    expect(mount.querySelector('.note-panel-wrapper')).to.exist;

    panel.unmount();

    expect(mount.querySelector('.note-panel-wrapper')).to.be.null;
    expect(panel._textarea).to.be.null;
  });

  it('resize() does not throw', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);

    expect(function () { panel.resize(); }).to.not.throw();
  });

  it('getContent() returns current textarea value', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);

    panel._textarea.value = '# Test content';
    expect(panel.getContent()).to.equal('# Test content');
  });

  it('isActive() returns true when mounted', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });

    expect(panel.isActive()).to.be.false;

    panel.mount(mount);
    expect(panel.isActive()).to.be.true;

    panel.unmount();
    expect(panel.isActive()).to.be.false;
  });

  it('detach() unmounts and cleans up', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);
    panel.detach();

    expect(panel._textarea).to.be.null;
    expect(panel._element).to.be.null;
  });

  it('refit() does not throw', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);

    expect(function () { panel.refit(); }).to.not.throw();
  });

  it('_setMode() switches between edit and preview', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '# Hi' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);

    // Default is edit
    expect(panel._mode).to.equal('edit');
    expect(panel._textarea.classList.contains('np-hidden')).to.be.false;

    panel._setMode('preview');
    expect(panel._mode).to.equal('preview');
    expect(panel._textarea.classList.contains('np-hidden')).to.be.true;
    expect(panel._previewEl.classList.contains('np-hidden')).to.be.false;

    panel._setMode('edit');
    expect(panel._mode).to.equal('edit');
    expect(panel._textarea.classList.contains('np-hidden')).to.be.false;
    expect(panel._previewEl.classList.contains('np-hidden')).to.be.true;
  });

  it('_renderPreview() uses marked.parse', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '# Hello' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);

    panel._textarea.value = '| a | b |\n|---|---|\n| 1 | 2 |';
    panel._renderPreview();

    expect(panel._previewEl.innerHTML).to.not.be.empty;
  });
});
