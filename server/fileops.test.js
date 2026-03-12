const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createFileOps } = require('./fileops');

describe('fileops', () => {
  let tmpDir, ops;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileops-test-'));
    ops = createFileOps(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('_validatePath', () => {
    it('allows a valid path inside root', async () => {
      const result = await ops.createFile('.', 'test.txt');
      expect(result.name).to.equal('test.txt');
    });

    it('rejects path traversal via ..', async () => {
      try {
        await ops.createFile('../outside', 'evil.txt');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('TRAVERSAL');
      }
    });

    it('rejects path outside root via absolute path', async () => {
      try {
        await ops.createFile('/etc', 'passwd');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('TRAVERSAL');
      }
    });
  });

  describe('_validateName', () => {
    it('rejects empty name', async () => {
      try {
        await ops.createFile('.', '');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('INVALID_NAME');
      }
    });

    it('rejects name with slash', async () => {
      try {
        await ops.createFile('.', 'foo/bar');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('INVALID_NAME');
      }
    });

    it('rejects name starting with dot', async () => {
      try {
        await ops.createFile('.', '.hidden');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('INVALID_NAME');
      }
    });

    it('rejects name with null byte', async () => {
      try {
        await ops.createFile('.', 'foo\0bar');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('INVALID_NAME');
      }
    });
  });

  describe('createFile', () => {
    it('creates an empty file and returns entry', async () => {
      const result = await ops.createFile('.', 'test.txt');
      expect(fs.existsSync(path.join(tmpDir, 'test.txt'))).to.be.true;
      expect(result).to.deep.equal({ name: 'test.txt', path: 'test.txt', type: 'file' });
    });

    it('creates file in a subdirectory', async () => {
      fs.mkdirSync(path.join(tmpDir, 'sub'));
      const result = await ops.createFile('sub', 'file.txt');
      expect(result.path).to.equal('sub/file.txt');
    });

    it('rejects duplicate file with EEXIST', async () => {
      await ops.createFile('.', 'dup.txt');
      try {
        await ops.createFile('.', 'dup.txt');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('EEXIST');
      }
    });
  });

  describe('createDirectory', () => {
    it('creates directory and returns entry', async () => {
      const result = await ops.createDirectory('.', 'newdir');
      expect(fs.statSync(path.join(tmpDir, 'newdir')).isDirectory()).to.be.true;
      expect(result).to.include({ name: 'newdir', type: 'dir' });
    });

    it('rejects duplicate directory with EEXIST', async () => {
      await ops.createDirectory('.', 'dupdir');
      try {
        await ops.createDirectory('.', 'dupdir');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('EEXIST');
      }
    });

    it('rejects traversal', async () => {
      try {
        await ops.createDirectory('../outside', 'dir');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('TRAVERSAL');
      }
    });
  });
});
