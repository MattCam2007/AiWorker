const { createApp } = require('./index');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { expect } = require('chai');

describe('fileops routes', function () {
  this.timeout(15000);

  let app, tmpDir, baseUrl;

  before(async function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileops-routes-test-'));
    app = await createApp({ port: 0, fileOpsRoot: tmpDir, tmuxSocket: 'terminaldeck-test', sessionPrefix: 'terminaldeck-test-' });
    baseUrl = `http://localhost:${app.port}`;
  });

  after(async function () {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function post(urlPath, body) {
    return new Promise(function (resolve, reject) {
      const data = JSON.stringify(body);
      const url = new URL(baseUrl + urlPath);
      const opts = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      };
      const req = http.request(opts, function (res) {
        const chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) });
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  describe('POST /api/fileops/create', function () {
    it('creates a file (201)', async function () {
      const r = await post('/api/fileops/create', { parent: '.', name: 'hello.txt', type: 'file' });
      expect(r.status).to.equal(201);
      expect(r.body.name).to.equal('hello.txt');
      expect(r.body.type).to.equal('file');
    });

    it('returns 409 on duplicate', async function () {
      await post('/api/fileops/create', { parent: '.', name: 'dup.txt', type: 'file' });
      const r = await post('/api/fileops/create', { parent: '.', name: 'dup.txt', type: 'file' });
      expect(r.status).to.equal(409);
    });

    it('returns 400 on invalid name', async function () {
      const r = await post('/api/fileops/create', { parent: '.', name: '.hidden', type: 'file' });
      expect(r.status).to.equal(400);
    });

    it('returns 400 on missing fields', async function () {
      const r = await post('/api/fileops/create', { parent: '.' });
      expect(r.status).to.equal(400);
    });

    it('creates a directory (201)', async function () {
      const r = await post('/api/fileops/create', { parent: '.', name: 'mydir', type: 'dir' });
      expect(r.status).to.equal(201);
      expect(r.body.type).to.equal('dir');
    });
  });

  describe('POST /api/fileops/rename', function () {
    it('renames a file (200)', async function () {
      await post('/api/fileops/create', { parent: '.', name: 'before.txt', type: 'file' });
      const r = await post('/api/fileops/rename', { path: 'before.txt', newName: 'after.txt' });
      expect(r.status).to.equal(200);
      expect(r.body.name).to.equal('after.txt');
    });

    it('returns 404 for nonexistent file', async function () {
      const r = await post('/api/fileops/rename', { path: 'ghost.txt', newName: 'new.txt' });
      expect(r.status).to.equal(404);
    });

    it('returns 400 for missing fields', async function () {
      const r = await post('/api/fileops/rename', { path: 'x.txt' });
      expect(r.status).to.equal(400);
    });
  });

  describe('POST /api/fileops/delete', function () {
    it('deletes a file (200)', async function () {
      await post('/api/fileops/create', { parent: '.', name: 'todelete.txt', type: 'file' });
      const r = await post('/api/fileops/delete', { path: 'todelete.txt' });
      expect(r.status).to.equal(200);
      expect(r.body.success).to.be.true;
    });

    it('returns 404 for nonexistent', async function () {
      const r = await post('/api/fileops/delete', { path: 'nope.txt' });
      expect(r.status).to.equal(404);
    });

    it('returns 403 for traversal', async function () {
      const r = await post('/api/fileops/delete', { path: '../outside' });
      expect(r.status).to.equal(403);
    });
  });

  describe('POST /api/fileops/copy', function () {
    it('copies a file (200)', async function () {
      await post('/api/fileops/create', { parent: '.', name: 'copysrc.txt', type: 'file' });
      await post('/api/fileops/create', { parent: '.', name: 'copydest', type: 'dir' });
      const r = await post('/api/fileops/copy', { src: 'copysrc.txt', destDir: 'copydest' });
      expect(r.status).to.equal(200);
      expect(r.body.name).to.equal('copysrc.txt');
    });

    it('returns 404 for nonexistent src', async function () {
      const r = await post('/api/fileops/copy', { src: 'ghost.txt', destDir: '.' });
      expect(r.status).to.equal(404);
    });
  });

  describe('POST /api/fileops/move', function () {
    it('moves a file (200)', async function () {
      await post('/api/fileops/create', { parent: '.', name: 'movesrc.txt', type: 'file' });
      await post('/api/fileops/create', { parent: '.', name: 'movedest', type: 'dir' });
      const r = await post('/api/fileops/move', { src: 'movesrc.txt', destDir: 'movedest' });
      expect(r.status).to.equal(200);
      expect(r.body.name).to.equal('movesrc.txt');
    });

    it('returns 404 for nonexistent src', async function () {
      const r = await post('/api/fileops/move', { src: 'phantom.txt', destDir: '.' });
      expect(r.status).to.equal(404);
    });
  });
});
