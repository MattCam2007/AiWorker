const { expect } = require('chai');
const http = require('http');
const { execSync } = require('child_process');
const { createApp } = require('./index');

function cleanupTmuxSessions() {
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', {
      encoding: 'utf-8'
    });
    output
      .trim()
      .split('\n')
      .filter((s) => s.startsWith('terminaldeck-'))
      .forEach((s) => {
        try {
          execSync(`tmux kill-session -t "${s}" 2>/dev/null`);
        } catch {}
      });
  } catch {}
}

function request(port, path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body })
      );
    }).on('error', reject);
  });
}

describe('HTTP Server', function () {
  this.timeout(15000);

  let app;

  beforeEach(async () => {
    cleanupTmuxSessions();
    app = await createApp({ port: 0 });
  });

  afterEach(async () => {
    await app.close();
    cleanupTmuxSessions();
  });

  describe('static file serving', () => {
    it('serves index.html at /', async () => {
      const res = await request(app.port, '/');
      expect(res.status).to.equal(200);
      expect(res.headers['content-type']).to.include('text/html');
      expect(res.body).to.include('TerminalDeck');
    });

    it('serves CSS files with correct MIME type', async () => {
      const res = await request(app.port, '/css/style.css');
      expect(res.status).to.equal(200);
      expect(res.headers['content-type']).to.include('text/css');
    });

    it('serves JS files with correct MIME type', async () => {
      const res = await request(app.port, '/js/app.js');
      expect(res.status).to.equal(200);
      expect(res.headers['content-type']).to.include('application/javascript');
    });

    it('returns 404 for non-existent files', async () => {
      const res = await request(app.port, '/nonexistent.txt');
      expect(res.status).to.equal(404);
    });
  });

  describe('API endpoints', () => {
    it('GET /api/config returns valid JSON config with settings', async () => {
      const res = await request(app.port, '/api/config');
      expect(res.status).to.equal(200);
      expect(res.headers['content-type']).to.include('application/json');
      const config = JSON.parse(res.body);
      expect(config).to.have.property('settings');
      expect(config.settings).to.have.property('theme');
      expect(config.settings).to.have.property('shell');
    });

    it('GET /api/sessions returns valid JSON session list', async () => {
      const res = await request(app.port, '/api/sessions');
      expect(res.status).to.equal(200);
      expect(res.headers['content-type']).to.include('application/json');
      const sessions = JSON.parse(res.body);
      expect(sessions).to.be.an('array');
    });

    it('GET /api/sessions returns 500 when listSessions fails', async () => {
      const original = app.sessionManager.listSessions;
      app.sessionManager.listSessions = () => Promise.reject(new Error('db down'));
      try {
        const res = await request(app.port, '/api/sessions');
        expect(res.status).to.equal(500);
        expect(res.headers['content-type']).to.include('application/json');
        const body = JSON.parse(res.body);
        expect(body).to.have.property('error', 'Failed to list sessions');
      } finally {
        app.sessionManager.listSessions = original;
      }
    });
  });

  describe('server binding', () => {
    it('starts and listens on the configured port', async () => {
      expect(app.port).to.be.a('number');
      expect(app.port).to.be.greaterThan(0);
      const res = await request(app.port, '/');
      expect(res.status).to.equal(200);
    });
  });

  describe('WebSocket upgrade', () => {
    it('upgrades connections on /ws/control path', (done) => {
      const WebSocket = require('ws');
      const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws/control`);
      ws.on('open', () => {
        ws.close();
        done();
      });
      ws.on('error', done);
    });

    it('upgrades connections on /ws/terminal/ paths for valid sessions', (done) => {
      const WebSocket = require('ws');
      // Create a terminal first, then connect to it
      app.sessionManager.createTerminal('Test').then((result) => {
        const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws/terminal/${result.id}`);
        ws.on('open', () => {
          ws.close();
          done();
        });
        ws.on('error', done);
      });
    });
  });
});
