const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { FileManager } = require('./files');

describe('FileManager', () => {
  let tmpDir;
  let workspaceDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminaldeck-files-test-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeConfigManager(openFiles) {
    const config = { settings: { shell: '/bin/bash' }, openFiles: openFiles || [] };
    return {
      getConfig: sinon.stub().returns(config),
      _config: config,
      configPath: path.join(tmpDir, 'terminaldeck.json')
    };
  }

  describe('listFiles', () => {
    it('returns tracked files with exists flag', () => {
      const filePath = path.join(workspaceDir, 'readme.md');
      fs.writeFileSync(filePath, '# Hello');

      const mgr = new FileManager(makeConfigManager([
        { id: 'readme', name: 'readme.md', file: filePath },
        { id: 'missing', name: 'gone.md', file: '/workspace/gone.md' }
      ]));
      const files = mgr.listFiles();

      expect(files).to.have.lengthOf(2);
      expect(files[0]).to.deep.include({ id: 'readme', exists: true });
      expect(files[1]).to.deep.include({ id: 'missing', exists: false });
    });

    it('returns empty array when nothing tracked', () => {
      const mgr = new FileManager(makeConfigManager([]));
      expect(mgr.listFiles()).to.deep.equal([]);
    });
  });

  describe('getFile', () => {
    it('returns file content when file exists', () => {
      const filePath = path.join(workspaceDir, 'test.js');
      fs.writeFileSync(filePath, 'console.log("hi")');

      const mgr = new FileManager(makeConfigManager([
        { id: 'test', name: 'test.js', file: filePath }
      ]));
      mgr._isPathSafe = () => true;
      const file = mgr.getFile('test');

      expect(file).to.deep.include({ id: 'test', content: 'console.log("hi")' });
    });

    it('returns null for unknown id', () => {
      const mgr = new FileManager(makeConfigManager([]));
      expect(mgr.getFile('nope')).to.be.null;
    });
  });

  describe('saveFile', () => {
    it('writes content to disk and returns success', () => {
      const filePath = path.join(workspaceDir, 'save-test.txt');
      fs.writeFileSync(filePath, 'old');

      const mgr = new FileManager(makeConfigManager([
        { id: 'save', name: 'save-test.txt', file: filePath }
      ]));
      mgr._isPathSafe = () => true;
      const result = mgr.saveFile('save', 'new content');

      expect(result.success).to.be.true;
      expect(fs.readFileSync(filePath, 'utf-8')).to.equal('new content');
    });

    it('returns null for unknown id', () => {
      const mgr = new FileManager(makeConfigManager([]));
      expect(mgr.saveFile('nope', 'content')).to.be.null;
    });
  });

  describe('openFile', () => {
    it('registers a new file and returns entry', () => {
      const configPath = path.join(tmpDir, 'terminaldeck.json');
      fs.writeFileSync(configPath, JSON.stringify({ settings: {}, openFiles: [] }));

      const cm = makeConfigManager([]);
      cm.configPath = configPath;

      const filePath = path.join(workspaceDir, 'app.js');
      fs.writeFileSync(filePath, '');

      // openFile expects a workspace-relative path
      const mgr = new FileManager(cm);
      // Stub _isPathSafe to allow our tmp path
      mgr._isPathSafe = () => true;
      const entry = mgr.openFile('app.js');

      expect(entry).to.have.property('id', 'app');
      expect(entry.name).to.equal('app.js');
    });

    it('returns existing entry if file already tracked', () => {
      const existing = { id: 'app', name: 'app.js', file: '/workspace/app.js' };
      const mgr = new FileManager(makeConfigManager([existing]));
      mgr._isPathSafe = () => true;

      const result = mgr.openFile('app.js');
      expect(result).to.deep.equal(existing);
    });

    it('deduplicates ids with numeric suffix', () => {
      const configPath = path.join(tmpDir, 'terminaldeck.json');
      fs.writeFileSync(configPath, JSON.stringify({
        settings: {}, openFiles: [{ id: 'app', name: 'app.js', file: '/workspace/src/app.js' }]
      }));

      const cm = makeConfigManager([{ id: 'app', name: 'app.js', file: '/workspace/src/app.js' }]);
      cm.configPath = configPath;

      const mgr = new FileManager(cm);
      mgr._isPathSafe = () => true;
      const entry = mgr.openFile('lib/app.js');

      expect(entry.id).to.equal('app-2');
    });
  });

  describe('closeFile', () => {
    it('removes entry from config without deleting the file', () => {
      const configPath = path.join(tmpDir, 'terminaldeck.json');
      const filePath = path.join(workspaceDir, 'keep.txt');
      fs.writeFileSync(filePath, 'important');
      fs.writeFileSync(configPath, JSON.stringify({
        settings: {}, openFiles: [{ id: 'keep', name: 'keep.txt', file: filePath }]
      }));

      const cm = makeConfigManager([{ id: 'keep', name: 'keep.txt', file: filePath }]);
      cm.configPath = configPath;

      const mgr = new FileManager(cm);
      const result = mgr.closeFile('keep');

      expect(result.success).to.be.true;
      // File must still exist on disk
      expect(fs.existsSync(filePath)).to.be.true;
    });

    it('returns null for unknown id', () => {
      const mgr = new FileManager(makeConfigManager([]));
      expect(mgr.closeFile('nope')).to.be.null;
    });
  });
});
