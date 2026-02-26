const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

// Test the history parsing logic in isolation (no tmux)
const { parseHistory, getHistoryFilePath } = require('./history');

describe('History Module', function () {

  describe('parseHistory()', function () {
    it('parses a standard bash history file into an array', function () {
      const raw = 'ls\ncd /tmp\npwd\nls\n';
      const result = parseHistory(raw);
      expect(result).to.be.an('array');
      expect(result).to.include('ls');
      expect(result).to.include('cd /tmp');
      expect(result).to.include('pwd');
    });

    it('returns most recent first', function () {
      const raw = 'first\nsecond\nthird\n';
      const result = parseHistory(raw);
      expect(result[0]).to.equal('third');
      expect(result[1]).to.equal('second');
      expect(result[2]).to.equal('first');
    });

    it('deduplicates entries keeping most recent occurrence', function () {
      const raw = 'ls\ncd /tmp\nls\npwd\nls\n';
      const result = parseHistory(raw);
      // 'ls' appears 3 times but should appear only once (at its most recent position)
      const lsOccurrences = result.filter(function (cmd) { return cmd === 'ls'; });
      expect(lsOccurrences).to.have.length(1);
      // 'ls' was last on line 5, so it should be first (most recent)
      expect(result[0]).to.equal('ls');
    });

    it('removes empty lines', function () {
      const raw = 'ls\n\n\ncd /tmp\n\npwd\n';
      const result = parseHistory(raw);
      result.forEach(function (entry) {
        expect(entry.trim()).to.not.equal('');
      });
    });

    it('returns empty array for empty string', function () {
      const result = parseHistory('');
      expect(result).to.be.an('array');
      expect(result).to.have.length(0);
    });

    it('returns empty array for whitespace-only input', function () {
      const result = parseHistory('   \n  \n\n  ');
      expect(result).to.be.an('array');
      expect(result).to.have.length(0);
    });

    it('handles bash timestamp-prefixed history (lines starting with #)', function () {
      // Bash history with HISTTIMEFORMAT can have timestamp lines like:
      // #1234567890
      // ls -la
      const raw = '#1234567890\nls -la\n#1234567891\ncd /home\n';
      const result = parseHistory(raw);
      // Should skip lines starting with #
      result.forEach(function (entry) {
        expect(entry.charAt(0)).to.not.equal('#');
      });
      expect(result).to.include('ls -la');
      expect(result).to.include('cd /home');
    });

    it('trims whitespace from individual entries', function () {
      const raw = '  ls  \n  cd /tmp  \n';
      const result = parseHistory(raw);
      expect(result).to.include('ls');
      expect(result).to.include('cd /tmp');
    });
  });

  describe('getHistoryFilePath()', function () {
    it('returns ~/.bash_history for /bin/bash shell', function () {
      const result = getHistoryFilePath('/bin/bash');
      expect(result).to.equal(path.join(os.homedir(), '.bash_history'));
    });

    it('returns ~/.zsh_history for /bin/zsh shell', function () {
      const result = getHistoryFilePath('/bin/zsh');
      expect(result).to.equal(path.join(os.homedir(), '.zsh_history'));
    });

    it('returns ~/.bash_history as default for unknown shells', function () {
      const result = getHistoryFilePath('/bin/fish');
      expect(result).to.equal(path.join(os.homedir(), '.bash_history'));
    });

    it('returns ~/.bash_history when shell is undefined', function () {
      const result = getHistoryFilePath(undefined);
      expect(result).to.equal(path.join(os.homedir(), '.bash_history'));
    });
  });

  describe('readHistory() - file reading', function () {
    const { readHistory } = require('./history');
    let tmpDir;

    beforeEach(function () {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-history-test-'));
    });

    afterEach(function () {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('reads and parses a history file correctly', function () {
      const histFile = path.join(tmpDir, '.bash_history');
      fs.writeFileSync(histFile, 'ls\ncd /tmp\npwd\nls\n');

      const result = readHistory(histFile);
      expect(result).to.be.an('array');
      expect(result[0]).to.equal('ls');
      expect(result).to.include('cd /tmp');
      expect(result).to.include('pwd');
    });

    it('returns empty array when file does not exist', function () {
      const result = readHistory('/tmp/nonexistent-history-file-xyz');
      expect(result).to.be.an('array');
      expect(result).to.have.length(0);
    });

    it('returns empty array when file is empty', function () {
      const histFile = path.join(tmpDir, '.bash_history');
      fs.writeFileSync(histFile, '');

      const result = readHistory(histFile);
      expect(result).to.be.an('array');
      expect(result).to.have.length(0);
    });

    it('never throws on malformed file content', function () {
      const histFile = path.join(tmpDir, '.bash_history');
      fs.writeFileSync(histFile, Buffer.from([0x00, 0x01, 0xFF, 0xFE]));

      expect(function () {
        readHistory(histFile);
      }).to.not.throw();
    });
  });

  describe('/api/history endpoint', function () {
    const { createHistoryRoute } = require('./history');
    let server, port;

    beforeEach(function (done) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-hist-api-'));
      const histFile = path.join(tmpDir, '.bash_history');
      fs.writeFileSync(histFile, 'git status\nnpm install\ngit status\nls -la\n');

      const handler = createHistoryRoute(histFile);

      server = http.createServer(function (req, res) {
        if (req.url === '/api/history' && req.method === 'GET') {
          handler(req, res);
          return;
        }
        res.writeHead(404);
        res.end('Not Found');
      });

      server.listen(0, function () {
        port = server.address().port;
        done();
      });
    });

    afterEach(function (done) {
      server.close(done);
    });

    function request(urlPath) {
      return new Promise(function (resolve, reject) {
        http.get('http://127.0.0.1:' + port + urlPath, function (res) {
          let body = '';
          res.on('data', function (d) { body += d; });
          res.on('end', function () {
            resolve({ status: res.statusCode, headers: res.headers, body: body });
          });
        }).on('error', reject);
      });
    }

    it('returns 200 with JSON content type', function () {
      return request('/api/history').then(function (res) {
        expect(res.status).to.equal(200);
        expect(res.headers['content-type']).to.include('application/json');
      });
    });

    it('returns parsed, deduplicated history array', function () {
      return request('/api/history').then(function (res) {
        const history = JSON.parse(res.body);
        expect(history).to.be.an('array');
        // 'git status' appears twice but should be deduplicated
        const gitStatusCount = history.filter(function (cmd) { return cmd === 'git status'; });
        expect(gitStatusCount).to.have.length(1);
      });
    });

    it('returns history entries most recent first', function () {
      return request('/api/history').then(function (res) {
        const history = JSON.parse(res.body);
        // File order: git status, npm install, git status, ls -la
        // Most recent (last in file) = ls -la, then git status (deduped to last), then npm install
        expect(history[0]).to.equal('ls -la');
        expect(history[1]).to.equal('git status');
        expect(history[2]).to.equal('npm install');
      });
    });
  });
});
