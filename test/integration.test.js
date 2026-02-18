const { expect } = require('chai');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const { execSync } = require('child_process');
const { createApp } = require('../server/index');

function tmuxAvailable() {
  try {
    execSync('which tmux', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

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

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function connectTerminalWS(port, terminalId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal/${terminalId}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function connectControlWS(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
    ws.on('message', function handler(raw) {
      const msg = JSON.parse(raw.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(msg);
      }
    });
  });
}

function collectOutput(ws, durationMs) {
  return new Promise((resolve) => {
    let output = '';
    function handler(raw) {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'output') {
        output += msg.data;
      }
    }
    ws.on('message', handler);
    setTimeout(() => {
      ws.removeListener('message', handler);
      resolve(output);
    }, durationMs);
  });
}

describe('Integration Tests', function () {
  if (!tmuxAvailable()) {
    before(function () {
      console.log('    ⚠ tmux not available, skipping integration tests');
      this.skip();
    });
    it('requires tmux');
    return;
  }

  this.timeout(30000);

  let tmpDir, configPath, app;

  const testConfig = {
    settings: {
      theme: {
        defaultColor: '#33ff33',
        background: '#0a0a0a',
        fontFamily: 'Fira Code, monospace',
        fontSize: 14
      },
      shell: '/bin/bash'
    }
  };

  function writeConfig(cfg) {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  }

  beforeEach(async function () {
    cleanupTmuxSessions();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminaldeck-int-'));
    configPath = path.join(tmpDir, 'terminaldeck.json');
    writeConfig(testConfig);
    app = await createApp({ configPath, port: 0 });
  });

  afterEach(async function () {
    if (app) await app.close();
    cleanupTmuxSessions();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Clean startup', () => {
    it('starts server with no pre-defined terminals', async () => {
      const pageRes = await httpGet(app.port, '/');
      expect(pageRes.status).to.equal(200);
      expect(pageRes.body).to.include('TerminalDeck');

      const configRes = await httpGet(app.port, '/api/config');
      expect(configRes.status).to.equal(200);
      const config = JSON.parse(configRes.body);
      expect(config.settings).to.have.property('theme');

      const sessionsRes = await httpGet(app.port, '/api/sessions');
      expect(sessionsRes.status).to.equal(200);
      const sessions = JSON.parse(sessionsRes.body);
      expect(sessions).to.have.length(0);
    });
  });

  describe('Dynamic terminal lifecycle', () => {
    it('creates a terminal via control WS and connects to it', async () => {
      const controlWs = await connectControlWS(app.port);

      // Create terminal
      const sessionsPromise = waitForMessage(controlWs, 'sessions');
      controlWs.send(JSON.stringify({ type: 'create_terminal', name: 'Shell 1' }));
      const sessionsMsg = await sessionsPromise;
      expect(sessionsMsg.sessions).to.have.length(1);
      const termId = sessionsMsg.sessions[0].id;

      // Connect to terminal and send a command
      const termWs = await connectTerminalWS(app.port, termId);
      const outputPromise = collectOutput(termWs, 2000);
      await new Promise((r) => setTimeout(r, 500));
      termWs.send(JSON.stringify({ type: 'input', data: 'echo hello_dynamic\n' }));

      const output = await outputPromise;
      expect(output).to.include('hello_dynamic');

      termWs.close();
      controlWs.close();
    });

    it('destroys a terminal via control WS', async () => {
      const controlWs = await connectControlWS(app.port);

      // Create
      const createPromise = waitForMessage(controlWs, 'sessions');
      controlWs.send(JSON.stringify({ type: 'create_terminal', name: 'Temp' }));
      const createMsg = await createPromise;
      const termId = createMsg.sessions[0].id;

      // Verify via API
      const apiRes1 = await httpGet(app.port, '/api/sessions');
      expect(JSON.parse(apiRes1.body).some((s) => s.id === termId)).to.be.true;

      // Destroy
      const destroyPromise = waitForMessage(controlWs, 'sessions');
      controlWs.send(JSON.stringify({ type: 'destroy_terminal', id: termId }));
      const destroyMsg = await destroyPromise;
      expect(destroyMsg.sessions.some((s) => s.id === termId)).to.be.false;

      // Verify via API
      const apiRes2 = await httpGet(app.port, '/api/sessions');
      expect(JSON.parse(apiRes2.body).some((s) => s.id === termId)).to.be.false;

      controlWs.close();
    });
  });

  describe('Terminal connectivity', () => {
    it('sends a command and receives output', async () => {
      const result = await app.sessionManager.createTerminal('Shell 1');

      const ws = await connectTerminalWS(app.port, result.id);
      const outputPromise = collectOutput(ws, 2000);
      await new Promise((r) => setTimeout(r, 500));
      ws.send(JSON.stringify({ type: 'input', data: 'echo hello_integration_test\n' }));

      const output = await outputPromise;
      expect(output).to.include('hello_integration_test');

      ws.close();
    });
  });

  describe('Multi-client', () => {
    it('input from client A is visible to client B', async () => {
      const result = await app.sessionManager.createTerminal('Shell 1');

      const wsA = await connectTerminalWS(app.port, result.id);
      const wsB = await connectTerminalWS(app.port, result.id);

      const outputPromise = collectOutput(wsB, 2000);
      await new Promise((r) => setTimeout(r, 500));
      wsA.send(JSON.stringify({ type: 'input', data: 'echo multiclient_test_42\n' }));

      const output = await outputPromise;
      expect(output).to.include('multiclient_test_42');

      wsA.close();
      wsB.close();
    });
  });

  describe('Session persistence', () => {
    it('tmux session survives WebSocket disconnect and reconnect', async () => {
      const result = await app.sessionManager.createTerminal('Shell 1');

      const ws1 = await connectTerminalWS(app.port, result.id);
      await new Promise((r) => setTimeout(r, 500));

      ws1.send(JSON.stringify({ type: 'input', data: 'export PERSIST_VAR=alive_12345\n' }));
      await new Promise((r) => setTimeout(r, 500));
      ws1.close();

      await new Promise((r) => setTimeout(r, 500));

      const ws2 = await connectTerminalWS(app.port, result.id);
      const outputPromise = collectOutput(ws2, 2000);
      await new Promise((r) => setTimeout(r, 500));
      ws2.send(JSON.stringify({ type: 'input', data: 'echo $PERSIST_VAR\n' }));

      const output = await outputPromise;
      expect(output).to.include('alive_12345');

      ws2.close();
    });
  });

  describe('Session discovery', () => {
    it('discovers pre-existing tmux sessions on startup', async () => {
      // Create a tmux session manually before starting a new app instance
      execSync('tmux new-session -d -s terminaldeck-discovered /bin/bash');

      // Close and restart app
      await app.close();
      app = await createApp({ configPath, port: 0 });

      const sessionsRes = await httpGet(app.port, '/api/sessions');
      const sessions = JSON.parse(sessionsRes.body);
      expect(sessions.some((s) => s.id === 'discovered')).to.be.true;
    });
  });

  describe('Config validation', () => {
    it('invalid JSON does not crash the server; last valid config is retained', async () => {
      fs.writeFileSync(configPath, '{invalid json!!!');

      await new Promise((r) => setTimeout(r, 1500));

      const res = await httpGet(app.port, '/api/config');
      expect(res.status).to.equal(200);
      const config = JSON.parse(res.body);
      expect(config.settings).to.have.property('theme');
    });
  });

  describe('Hot reload — settings only', () => {
    it('theme change is broadcast via control WS', async () => {
      const controlWs = await connectControlWS(app.port);

      const reloadPromise = waitForMessage(controlWs, 'config_reload', 10000);

      const newConfig = {
        settings: {
          ...testConfig.settings,
          theme: { ...testConfig.settings.theme, defaultColor: '#ff0000' }
        }
      };
      writeConfig(newConfig);

      const reloadMsg = await reloadPromise;
      expect(reloadMsg.config.settings.theme.defaultColor).to.equal('#ff0000');

      controlWs.close();
    });
  });
});
