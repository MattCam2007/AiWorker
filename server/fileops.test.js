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

  describe('rename', () => {
    it('renames a file', async () => {
      fs.writeFileSync(path.join(tmpDir, 'old.txt'), '');
      const result = await ops.rename('old.txt', 'new.txt');
      expect(fs.existsSync(path.join(tmpDir, 'old.txt'))).to.be.false;
      expect(fs.existsSync(path.join(tmpDir, 'new.txt'))).to.be.true;
      expect(result).to.deep.equal({ name: 'new.txt', path: 'new.txt', type: 'file' });
    });

    it('renames a directory', async () => {
      fs.mkdirSync(path.join(tmpDir, 'olddir'));
      const result = await ops.rename('olddir', 'newdir');
      expect(fs.existsSync(path.join(tmpDir, 'olddir'))).to.be.false;
      expect(fs.statSync(path.join(tmpDir, 'newdir')).isDirectory()).to.be.true;
      expect(result).to.deep.equal({ name: 'newdir', path: 'newdir', type: 'dir' });
    });

    it('rejects invalid new name', async () => {
      fs.writeFileSync(path.join(tmpDir, 'file.txt'), '');
      try {
        await ops.rename('file.txt', '.hidden');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('INVALID_NAME');
      }
    });

    it('rejects traversal in target path', async () => {
      try {
        await ops.rename('../outside/file.txt', 'new.txt');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('TRAVERSAL');
      }
    });

    it('rejects ENOENT', async () => {
      try {
        await ops.rename('nonexistent.txt', 'new.txt');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('ENOENT');
      }
    });
  });

  describe('remove', () => {
    it('removes a file', async () => {
      fs.writeFileSync(path.join(tmpDir, 'todelete.txt'), '');
      const result = await ops.remove('todelete.txt');
      expect(fs.existsSync(path.join(tmpDir, 'todelete.txt'))).to.be.false;
      expect(result).to.deep.equal({ success: true });
    });

    it('removes a directory recursively', async () => {
      fs.mkdirSync(path.join(tmpDir, 'todeldir'));
      fs.writeFileSync(path.join(tmpDir, 'todeldir', 'inside.txt'), '');
      await ops.remove('todeldir');
      expect(fs.existsSync(path.join(tmpDir, 'todeldir'))).to.be.false;
    });

    it('rejects traversal', async () => {
      try {
        await ops.remove('../outside');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('TRAVERSAL');
      }
    });

    it('rejects ENOENT', async () => {
      try {
        await ops.remove('nonexistent.txt');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('ENOENT');
      }
    });
  });

  describe('copy', () => {
    it('copies a file to another directory', async () => {
      fs.writeFileSync(path.join(tmpDir, 'src.txt'), 'hello');
      fs.mkdirSync(path.join(tmpDir, 'dest'));
      const result = await ops.copy('src.txt', 'dest');
      expect(fs.existsSync(path.join(tmpDir, 'src.txt'))).to.be.true;
      expect(fs.existsSync(path.join(tmpDir, 'dest', 'src.txt'))).to.be.true;
      expect(result).to.deep.equal({ name: 'src.txt', path: 'dest/src.txt', type: 'file' });
    });

    it('copies a directory recursively', async () => {
      fs.mkdirSync(path.join(tmpDir, 'srcdir'));
      fs.writeFileSync(path.join(tmpDir, 'srcdir', 'file.txt'), 'content');
      fs.mkdirSync(path.join(tmpDir, 'destdir'));
      const result = await ops.copy('srcdir', 'destdir');
      expect(fs.existsSync(path.join(tmpDir, 'destdir', 'srcdir', 'file.txt'))).to.be.true;
      expect(result.type).to.equal('dir');
    });

    it('auto-dedups name on collision', async () => {
      fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'original');
      fs.mkdirSync(path.join(tmpDir, 'destcol'));
      fs.writeFileSync(path.join(tmpDir, 'destcol', 'file.txt'), 'existing');
      const result = await ops.copy('file.txt', 'destcol');
      expect(result.name).to.equal('file (2).txt');
      expect(fs.existsSync(path.join(tmpDir, 'destcol', 'file.txt'))).to.be.true;
      expect(fs.existsSync(path.join(tmpDir, 'destcol', 'file (2).txt'))).to.be.true;
    });

    it('rejects traversal in src', async () => {
      try {
        await ops.copy('../outside/file.txt', '.');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('TRAVERSAL');
      }
    });
  });

  describe('move', () => {
    it('moves a file', async () => {
      fs.writeFileSync(path.join(tmpDir, 'tomove.txt'), 'data');
      fs.mkdirSync(path.join(tmpDir, 'movdest'));
      const result = await ops.move('tomove.txt', 'movdest');
      expect(fs.existsSync(path.join(tmpDir, 'tomove.txt'))).to.be.false;
      expect(fs.existsSync(path.join(tmpDir, 'movdest', 'tomove.txt'))).to.be.true;
      expect(result).to.deep.equal({ name: 'tomove.txt', path: 'movdest/tomove.txt', type: 'file' });
    });

    it('moves a directory', async () => {
      fs.mkdirSync(path.join(tmpDir, 'movdir'));
      fs.writeFileSync(path.join(tmpDir, 'movdir', 'inner.txt'), '');
      fs.mkdirSync(path.join(tmpDir, 'movdirdest'));
      const result = await ops.move('movdir', 'movdirdest');
      expect(fs.existsSync(path.join(tmpDir, 'movdir'))).to.be.false;
      expect(fs.existsSync(path.join(tmpDir, 'movdirdest', 'movdir', 'inner.txt'))).to.be.true;
      expect(result.type).to.equal('dir');
    });

    it('rejects traversal in src', async () => {
      try {
        await ops.move('../outside/file.txt', '.');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('TRAVERSAL');
      }
    });

    it('rejects ENOENT', async () => {
      fs.mkdirSync(path.join(tmpDir, 'movedest2'));
      try {
        await ops.move('nonexistent.txt', 'movedest2');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.code).to.equal('ENOENT');
      }
    });
  });
});
