const { expect } = require('chai');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ConfigManager } = require('./config');

/**
 * Safe API tests for /api/shortcuts endpoint.
 *
 * We do NOT use createApp() to avoid tmux session discovery.
 * Instead, we create a minimal HTTP server that mirrors the routing
 * pattern from server/index.js for just the /api/shortcuts endpoint.
 */

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function createTestServer(configManager) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/shortcuts')) {
      const url = new URL(req.url, 'http://localhost');
      const cwd = url.searchParams.get('cwd') || undefined;
      const shortcuts = configManager.getShortcuts(cwd);
      setSecurityHeaders(res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(shortcuts));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  return server;
}

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body })
      );
    }).on('error', reject);
  });
}

describe('GET /api/shortcuts', function () {
  this.timeout(5000);

  let tmpDir;
  let configPath;
  let server;
  let port;

  beforeEach((done) => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminaldeck-shortcut-api-test-'));
    configPath = path.join(tmpDir, 'terminaldeck.json');
    // Default: write a config with shortcuts
    const config = {
      settings: { shell: '/bin/bash' },
      shortcuts: {
        global: [
          { name: 'Git Pull', command: 'git pull', aliases: ['gp', 'pull'], icon: 'git-pull-request' },
          { name: 'Git Push', command: 'git push', aliases: ['gpush', 'push'] }
        ],
        projects: {
          '/workspace/terminaldeck': [
            { name: 'Dev Server', command: 'npm run dev', aliases: ['dev', 'serve'] },
            { name: 'Run Tests', command: 'npm test', aliases: ['test', 't'] }
          ]
        }
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const configManager = new ConfigManager(configPath);
    configManager.load();

    server = createTestServer(configManager);
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterEach((done) => {
    server.close(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      done();
    });
  });

  it('returns merged list of project + global shortcuts when cwd matches', async () => {
    const res = await request(port, '/api/shortcuts?cwd=/workspace/terminaldeck');
    expect(res.status).to.equal(200);
    expect(res.headers['content-type']).to.include('application/json');
    const shortcuts = JSON.parse(res.body);
    expect(shortcuts).to.be.an('array');
    // 2 project + 2 global = 4 total
    expect(shortcuts).to.have.lengthOf(4);
    // Project shortcuts first
    expect(shortcuts[0].name).to.equal('Dev Server');
    expect(shortcuts[1].name).to.equal('Run Tests');
    expect(shortcuts[2].name).to.equal('Git Pull');
    expect(shortcuts[3].name).to.equal('Git Push');
  });

  it('returns only global shortcuts when no cwd param', async () => {
    const res = await request(port, '/api/shortcuts');
    expect(res.status).to.equal(200);
    const shortcuts = JSON.parse(res.body);
    expect(shortcuts).to.have.lengthOf(2);
    expect(shortcuts[0].name).to.equal('Git Pull');
    expect(shortcuts[1].name).to.equal('Git Push');
  });

  it('returns only global shortcuts when cwd does not match any project', async () => {
    const res = await request(port, '/api/shortcuts?cwd=/some/unknown/path');
    expect(res.status).to.equal(200);
    const shortcuts = JSON.parse(res.body);
    expect(shortcuts).to.have.lengthOf(2);
    expect(shortcuts.every((s) => s.source === 'global')).to.be.true;
  });

  it('returns security headers', async () => {
    const res = await request(port, '/api/shortcuts');
    expect(res.headers['x-content-type-options']).to.equal('nosniff');
    expect(res.headers['x-frame-options']).to.equal('DENY');
  });

  it('includes aliases and icon in the response', async () => {
    const res = await request(port, '/api/shortcuts');
    const shortcuts = JSON.parse(res.body);
    const gitPull = shortcuts.find((s) => s.name === 'Git Pull');
    expect(gitPull.aliases).to.deep.equal(['gp', 'pull']);
    expect(gitPull.icon).to.equal('git-pull-request');
  });

  it('includes source field in each shortcut', async () => {
    const res = await request(port, '/api/shortcuts?cwd=/workspace/terminaldeck');
    const shortcuts = JSON.parse(res.body);
    const projectShortcuts = shortcuts.filter((s) => s.source === 'project');
    const globalShortcuts = shortcuts.filter((s) => s.source === 'global');
    expect(projectShortcuts).to.have.lengthOf(2);
    expect(globalShortcuts).to.have.lengthOf(2);
  });
});

describe('GET /api/shortcuts — no shortcuts in config', function () {
  this.timeout(5000);

  let tmpDir;
  let configPath;
  let server;
  let port;

  beforeEach((done) => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminaldeck-shortcut-api-empty-'));
    configPath = path.join(tmpDir, 'terminaldeck.json');
    // Config with no shortcuts section
    fs.writeFileSync(configPath, JSON.stringify({ settings: { shell: '/bin/bash' } }, null, 2));

    const configManager = new ConfigManager(configPath);
    configManager.load();

    server = createTestServer(configManager);
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterEach((done) => {
    server.close(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      done();
    });
  });

  it('returns empty array when no shortcuts config exists', async () => {
    const res = await request(port, '/api/shortcuts');
    expect(res.status).to.equal(200);
    const shortcuts = JSON.parse(res.body);
    expect(shortcuts).to.be.an('array').that.is.empty;
  });

  it('returns empty array with cwd param when no shortcuts config exists', async () => {
    const res = await request(port, '/api/shortcuts?cwd=/workspace/terminaldeck');
    expect(res.status).to.equal(200);
    const shortcuts = JSON.parse(res.body);
    expect(shortcuts).to.be.an('array').that.is.empty;
  });
});
