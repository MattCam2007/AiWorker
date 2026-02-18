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

function connectWS(port, terminalId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal/${terminalId}`);
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
      shell: '/bin/bash',
      defaultLayout: 'dev'
    },
    terminals: [
      { id: 'shell1', name: 'Shell 1', workingDir: '/tmp', autoStart: true },
      { id: 'shell2', name: 'Shell 2', workingDir: '/tmp', autoStart: true }
    ],
    layouts: {
      dev: { grid: '2x1', cells: [['shell1', 'shell2']] },
      focus: { grid: '1x1', cells: [['shell1']] }
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

  describe('Full startup flow', () => {
    it('starts server, loads config, creates tmux sessions, serves page', async () => {
      // HTTP serves the page
      const pageRes = await httpGet(app.port, '/');
      expect(pageRes.status).to.equal(200);
      expect(pageRes.body).to.include('TerminalDeck');

      // Config API returns correct data
      const configRes = await httpGet(app.port, '/api/config');
      expect(configRes.status).to.equal(200);
      const config = JSON.parse(configRes.body);
      expect(config.terminals).to.have.length(2);

      // Sessions API returns autoStart sessions
      const sessionsRes = await httpGet(app.port, '/api/sessions');
      expect(sessionsRes.status).to.equal(200);
      const sessions = JSON.parse(sessionsRes.body);
      expect(sessions).to.have.length(2);
      const ids = sessions.map((s) => s.id);
      expect(ids).to.include('shell1');
      expect(ids).to.include('shell2');
    });
  });

  describe('Terminal connectivity', () => {
    it('sends a command and receives output', async () => {
      const ws = await connectWS(app.port, 'shell1');

      // Collect output while sending a command
      const outputPromise = collectOutput(ws, 2000);

      // Wait briefly then send command
      await new Promise((r) => setTimeout(r, 500));
      ws.send(JSON.stringify({ type: 'input', data: 'echo hello_integration_test\n' }));

      const output = await outputPromise;
      expect(output).to.include('hello_integration_test');

      ws.close();
    });
  });

  describe('Multi-client', () => {
    it('input from client A is visible to client B', async () => {
      const wsA = await connectWS(app.port, 'shell1');
      const wsB = await connectWS(app.port, 'shell1');

      // Client B collects output
      const outputPromise = collectOutput(wsB, 2000);

      // Client A sends input
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
      const ws1 = await connectWS(app.port, 'shell1');
      await new Promise((r) => setTimeout(r, 500));

      // Start a background process
      ws1.send(JSON.stringify({ type: 'input', data: 'export PERSIST_VAR=alive_12345\n' }));
      await new Promise((r) => setTimeout(r, 500));
      ws1.close();

      // Wait for cleanup
      await new Promise((r) => setTimeout(r, 500));

      // Reconnect
      const ws2 = await connectWS(app.port, 'shell1');
      const outputPromise = collectOutput(ws2, 2000);
      await new Promise((r) => setTimeout(r, 500));
      ws2.send(JSON.stringify({ type: 'input', data: 'echo $PERSIST_VAR\n' }));

      const output = await outputPromise;
      expect(output).to.include('alive_12345');

      ws2.close();
    });
  });

  describe('Ephemeral lifecycle', () => {
    it('creates ephemeral terminal, verifies it exists, then destroys it', async () => {
      const ws = await connectWS(app.port, 'shell1');
      await new Promise((r) => setTimeout(r, 500));

      // Set up listener BEFORE sending
      const sessionsPromise = waitForMessage(ws, 'sessions');
      ws.send(JSON.stringify({ type: 'create_ephemeral', name: 'IntTest Temp' }));
      const sessionsMsg = await sessionsPromise;
      const ephSession = sessionsMsg.sessions.find((s) => s.id.startsWith('ephemeral-'));
      expect(ephSession).to.exist;
      expect(ephSession.name).to.equal('IntTest Temp');

      // Verify via API
      const apiRes = await httpGet(app.port, '/api/sessions');
      const apiSessions = JSON.parse(apiRes.body);
      expect(apiSessions.some((s) => s.id === ephSession.id)).to.be.true;

      // Set up listener BEFORE sending destroy
      const destroyPromise = waitForMessage(ws, 'sessions');
      ws.send(JSON.stringify({ type: 'destroy_ephemeral', id: ephSession.id }));
      const destroyMsg = await destroyPromise;
      expect(destroyMsg.sessions.some((s) => s.id === ephSession.id)).to.be.false;

      // Verify via API
      const apiRes2 = await httpGet(app.port, '/api/sessions');
      const apiSessions2 = JSON.parse(apiRes2.body);
      expect(apiSessions2.some((s) => s.id === ephSession.id)).to.be.false;

      ws.close();
    });
  });

  describe('Hot reload - add terminal', () => {
    it('adding a terminal to config creates a new tmux session', async () => {
      const ws = await connectWS(app.port, 'shell1');

      // Listen for config_reload
      const reloadPromise = waitForMessage(ws, 'config_reload', 10000);

      // Write new config with added terminal
      const newConfig = {
        ...testConfig,
        terminals: [
          ...testConfig.terminals,
          { id: 'shell3', name: 'Shell 3', workingDir: '/tmp', autoStart: true }
        ],
        layouts: {
          ...testConfig.layouts,
          triple: { grid: '3x1', cells: [['shell1', 'shell2', 'shell3']] }
        }
      };
      writeConfig(newConfig);

      const reloadMsg = await reloadPromise;
      expect(reloadMsg.config.terminals).to.have.length(3);

      // Verify session was created
      await new Promise((r) => setTimeout(r, 500));
      const sessionsRes = await httpGet(app.port, '/api/sessions');
      const sessions = JSON.parse(sessionsRes.body);
      expect(sessions.some((s) => s.id === 'shell3')).to.be.true;

      ws.close();
    });
  });

  describe('Hot reload - remove terminal', () => {
    it('removing a terminal from config destroys its tmux session', async () => {
      const ws = await connectWS(app.port, 'shell1');

      const reloadPromise = waitForMessage(ws, 'config_reload', 10000);

      const newConfig = {
        ...testConfig,
        terminals: [testConfig.terminals[0]],
        layouts: {
          dev: { grid: '1x1', cells: [['shell1']] },
          focus: { grid: '1x1', cells: [['shell1']] }
        }
      };
      writeConfig(newConfig);

      const reloadMsg = await reloadPromise;
      expect(reloadMsg.config.terminals).to.have.length(1);

      // Verify session was removed
      await new Promise((r) => setTimeout(r, 500));
      const sessionsRes = await httpGet(app.port, '/api/sessions');
      const sessions = JSON.parse(sessionsRes.body);
      expect(sessions.some((s) => s.id === 'shell2')).to.be.false;

      ws.close();
    });
  });

  describe('Config validation', () => {
    it('invalid JSON does not crash the server; last valid config is retained', async () => {
      // Write invalid JSON
      fs.writeFileSync(configPath, '{invalid json!!!');

      // Wait for debounce + processing
      await new Promise((r) => setTimeout(r, 1500));

      // Server should still be running and serving valid config
      const res = await httpGet(app.port, '/api/config');
      expect(res.status).to.equal(200);
      const config = JSON.parse(res.body);
      expect(config.terminals).to.have.length(2);
    });
  });
});
