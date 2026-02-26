const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { NoteManager } = require('./notes');

describe('NoteManager', () => {
  let tmpDir;
  let notesDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminaldeck-notes-test-'));
    notesDir = path.join(tmpDir, 'notes');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeConfig(notes) {
    return {
      settings: { shell: '/bin/bash' },
      notes: notes || []
    };
  }

  function makeConfigManager(notes) {
    const config = makeConfig(notes);
    return {
      getConfig: sinon.stub().returns(config),
      _config: config,
      configPath: path.join(tmpDir, 'terminaldeck.json')
    };
  }

  describe('listNotes', () => {
    it('returns notes from config with exists flag', () => {
      // Create notes dir and one file
      fs.mkdirSync(notesDir, { recursive: true });
      fs.writeFileSync(path.join(notesDir, 'todo.md'), '# Todo');

      const configManager = makeConfigManager([
        { id: 'todo', name: 'Todo List', file: 'todo.md' },
        { id: 'scratch', name: 'Scratchpad', file: 'scratch.md' }
      ]);

      const mgr = new NoteManager(configManager, notesDir);
      const notes = mgr.listNotes();

      expect(notes).to.be.an('array').with.lengthOf(2);
      expect(notes[0]).to.deep.include({ id: 'todo', name: 'Todo List', file: 'todo.md', exists: true });
      expect(notes[1]).to.deep.include({ id: 'scratch', name: 'Scratchpad', file: 'scratch.md', exists: false });
    });

    it('returns empty array when no notes configured', () => {
      const configManager = makeConfigManager([]);
      const mgr = new NoteManager(configManager, notesDir);
      expect(mgr.listNotes()).to.deep.equal([]);
    });

    it('returns empty array when notes section missing', () => {
      const config = { settings: { shell: '/bin/bash' } };
      const configManager = {
        getConfig: sinon.stub().returns(config),
        _config: config,
        configPath: path.join(tmpDir, 'terminaldeck.json')
      };
      const mgr = new NoteManager(configManager, notesDir);
      expect(mgr.listNotes()).to.deep.equal([]);
    });
  });

  describe('getNote', () => {
    it('returns note content when file exists', () => {
      fs.mkdirSync(notesDir, { recursive: true });
      fs.writeFileSync(path.join(notesDir, 'todo.md'), '# My Todo');

      const configManager = makeConfigManager([
        { id: 'todo', name: 'Todo List', file: 'todo.md' }
      ]);
      const mgr = new NoteManager(configManager, notesDir);
      const note = mgr.getNote('todo');

      expect(note).to.deep.include({ id: 'todo', name: 'Todo List', file: 'todo.md', content: '# My Todo' });
    });

    it('returns empty content when file does not exist', () => {
      const configManager = makeConfigManager([
        { id: 'todo', name: 'Todo List', file: 'todo.md' }
      ]);
      const mgr = new NoteManager(configManager, notesDir);
      const note = mgr.getNote('todo');

      expect(note.content).to.equal('');
    });

    it('returns null for unknown note ID', () => {
      const configManager = makeConfigManager([]);
      const mgr = new NoteManager(configManager, notesDir);
      expect(mgr.getNote('nonexistent')).to.be.null;
    });
  });

  describe('saveNote', () => {
    it('writes content to file and returns success', () => {
      const configManager = makeConfigManager([
        { id: 'todo', name: 'Todo List', file: 'todo.md' }
      ]);
      const mgr = new NoteManager(configManager, notesDir);
      const result = mgr.saveNote('todo', '# Updated content');

      expect(result.success).to.be.true;
      expect(result.saved).to.be.a('string');
      expect(fs.readFileSync(path.join(notesDir, 'todo.md'), 'utf-8')).to.equal('# Updated content');
    });

    it('creates directory if it does not exist', () => {
      const configManager = makeConfigManager([
        { id: 'todo', name: 'Todo List', file: 'todo.md' }
      ]);
      const mgr = new NoteManager(configManager, notesDir);

      expect(fs.existsSync(notesDir)).to.be.false;
      mgr.saveNote('todo', 'content');
      expect(fs.existsSync(notesDir)).to.be.true;
    });

    it('creates file if it does not exist', () => {
      const configManager = makeConfigManager([
        { id: 'todo', name: 'Todo List', file: 'todo.md' }
      ]);
      const mgr = new NoteManager(configManager, notesDir);
      mgr.saveNote('todo', 'new note');

      expect(fs.existsSync(path.join(notesDir, 'todo.md'))).to.be.true;
    });

    it('returns null for unknown note ID', () => {
      const configManager = makeConfigManager([]);
      const mgr = new NoteManager(configManager, notesDir);
      expect(mgr.saveNote('nonexistent', 'content')).to.be.null;
    });

    it('prevents path traversal in filename', () => {
      const configManager = makeConfigManager([
        { id: 'evil', name: 'Evil', file: '../../../etc/passwd' }
      ]);
      const mgr = new NoteManager(configManager, notesDir);
      expect(mgr.saveNote('evil', 'hacked')).to.be.null;
    });
  });

  describe('createNote', () => {
    it('creates a new note in config and on disk', () => {
      // Write a base config file for persistence
      const configPath = path.join(tmpDir, 'terminaldeck.json');
      const baseConfig = { settings: { shell: '/bin/bash' }, notes: [] };
      fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2));

      const configManager = makeConfigManager([]);
      configManager.configPath = configPath;

      const mgr = new NoteManager(configManager, notesDir);
      const note = mgr.createNote('My New Note');

      expect(note).to.have.property('id');
      expect(note.name).to.equal('My New Note');
      expect(note.file).to.match(/\.md$/);
      expect(fs.existsSync(path.join(notesDir, note.file))).to.be.true;
    });

    it('generates slug-based ID from name', () => {
      const configPath = path.join(tmpDir, 'terminaldeck.json');
      fs.writeFileSync(configPath, JSON.stringify({ settings: {}, notes: [] }, null, 2));

      const configManager = makeConfigManager([]);
      configManager.configPath = configPath;

      const mgr = new NoteManager(configManager, notesDir);
      const note = mgr.createNote('Meeting Notes');

      expect(note.id).to.equal('meeting-notes');
      expect(note.file).to.equal('meeting-notes.md');
    });

    it('deduplicates IDs with numeric suffix', () => {
      const configPath = path.join(tmpDir, 'terminaldeck.json');
      fs.writeFileSync(configPath, JSON.stringify({
        settings: {}, notes: [{ id: 'todo', name: 'Todo', file: 'todo.md' }]
      }, null, 2));

      const configManager = makeConfigManager([
        { id: 'todo', name: 'Todo', file: 'todo.md' }
      ]);
      configManager.configPath = configPath;

      const mgr = new NoteManager(configManager, notesDir);
      const note = mgr.createNote('Todo');

      expect(note.id).to.equal('todo-2');
    });

    it('updates config file on disk', () => {
      const configPath = path.join(tmpDir, 'terminaldeck.json');
      fs.writeFileSync(configPath, JSON.stringify({ settings: {}, notes: [] }, null, 2));

      const configManager = makeConfigManager([]);
      configManager.configPath = configPath;

      const mgr = new NoteManager(configManager, notesDir);
      mgr.createNote('Test Note');

      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(saved.notes).to.have.lengthOf(1);
      expect(saved.notes[0].name).to.equal('Test Note');
    });
  });

  describe('deleteNote', () => {
    it('removes note from config', () => {
      const configPath = path.join(tmpDir, 'terminaldeck.json');
      fs.writeFileSync(configPath, JSON.stringify({
        settings: {},
        notes: [{ id: 'todo', name: 'Todo', file: 'todo.md' }]
      }, null, 2));

      const configManager = makeConfigManager([
        { id: 'todo', name: 'Todo', file: 'todo.md' }
      ]);
      configManager.configPath = configPath;

      fs.mkdirSync(notesDir, { recursive: true });
      fs.writeFileSync(path.join(notesDir, 'todo.md'), 'content');

      const mgr = new NoteManager(configManager, notesDir);
      const result = mgr.deleteNote('todo', false);

      expect(result.success).to.be.true;
      // File should still exist (deleteFile=false)
      expect(fs.existsSync(path.join(notesDir, 'todo.md'))).to.be.true;

      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(saved.notes).to.have.lengthOf(0);
    });

    it('optionally deletes the file on disk', () => {
      const configPath = path.join(tmpDir, 'terminaldeck.json');
      fs.writeFileSync(configPath, JSON.stringify({
        settings: {},
        notes: [{ id: 'todo', name: 'Todo', file: 'todo.md' }]
      }, null, 2));

      const configManager = makeConfigManager([
        { id: 'todo', name: 'Todo', file: 'todo.md' }
      ]);
      configManager.configPath = configPath;

      fs.mkdirSync(notesDir, { recursive: true });
      fs.writeFileSync(path.join(notesDir, 'todo.md'), 'content');

      const mgr = new NoteManager(configManager, notesDir);
      mgr.deleteNote('todo', true);

      expect(fs.existsSync(path.join(notesDir, 'todo.md'))).to.be.false;
    });

    it('returns null for unknown note ID', () => {
      const configManager = makeConfigManager([]);
      const mgr = new NoteManager(configManager, notesDir);
      expect(mgr.deleteNote('nonexistent')).to.be.null;
    });
  });

  describe('path traversal protection', () => {
    it('rejects files outside notes directory', () => {
      const configManager = makeConfigManager([
        { id: 'evil', name: 'Evil', file: '../../secret.md' }
      ]);
      const mgr = new NoteManager(configManager, notesDir);

      expect(mgr.getNote('evil')).to.be.null;
      expect(mgr.saveNote('evil', 'hacked')).to.be.null;
    });
  });
});
