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

    // Mock fetch
    global.fetch = sinon.stub();

    // Mock EasyMDE — the CDN-loaded editor
    global.EasyMDE = function (opts) {
      this._opts = opts;
      this._value = '';
      this._changeCallbacks = [];
      this.element = opts.element;
      this.codemirror = {
        on: sinon.stub().callsFake(function (event, cb) {
          if (event === 'change') {
            this._changeCallbacks = this._changeCallbacks || [];
            this._changeCallbacks.push(cb);
          }
        }.bind(this)),
        refresh: sinon.stub()
      };
      this._changeCallbacks = this.codemirror._changeCallbacks = [];
    };
    global.EasyMDE.prototype.value = function (val) {
      if (val === undefined) return this._value;
      this._value = val;
    };
    global.EasyMDE.prototype.toTextArea = sinon.stub();
    global.EasyMDE.prototype.cleanup = sinon.stub();

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
    delete global.fetch;
    delete global.EasyMDE;
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
    expect(mount.querySelector('textarea')).to.exist;
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

    // Set content and save
    panel._easyMDE._value = '# Updated';
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

    // Simulate content change
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
    expect(panel._easyMDE).to.be.null;
  });

  it('resize() calls codemirror refresh', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);

    panel.resize();

    expect(panel._easyMDE.codemirror.refresh.called).to.be.true;
  });

  it('getContent() returns current editor value', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);

    panel._easyMDE._value = '# Test content';
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

    expect(panel._easyMDE).to.be.null;
    expect(panel._element).to.be.null;
  });

  it('refit() triggers resize', function () {
    global.fetch.resolves({
      ok: true,
      json: function () { return Promise.resolve({ content: '' }); }
    });

    var mount = document.getElementById('mount');
    var panel = new NotePanel({ id: 'todo', name: 'Todo', file: 'todo.md' });
    panel.mount(mount);

    // Should not throw
    panel.refit();
    expect(panel._easyMDE.codemirror.refresh.called).to.be.true;
  });
});
