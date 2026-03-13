const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const { execSync } = require('child_process');
const { TerminalWSServer } = require('./websocket');
const { SessionManager, DEFAULT_INSTANCE } = require('./sessions');

const TEST_INSTANCES_PATH = '/tmp/terminaldeck-ws-test-instances.json';

function cleanupTmuxSessions() {
  try {
    const output = execSync('tmux -L terminaldeck-test list-sessions -F "#{session_name}" 2>/dev/null', {
      encoding: 'utf-8'
    });
    output
      .trim()
      .split('\n')
      .filter((s) => s.startsWith('terminaldeck-test-'))
      .forEach((s) => {
        try {
          execSync(`tmux -L terminaldeck-test kill-session -t "${s}" 2>/dev/null`);
        } catch {}
      });
  } catch {}
}

describe('TerminalWSServer', function () {
  this.timeout(15000);

  let httpServer;
  let wsServer;
  let sessionMgr;
  let port;

  const testConfig = {
    settings: { shell: '/bin/bash' },
    tmuxSocket: 'terminaldeck-test',
    sessionPrefix: 'terminaldeck-test-',
    instancesPath: TEST_INSTANCES_PATH
  };

  beforeEach(async () => {
    cleanupTmuxSessions();
    try { fs.unlinkSync(TEST_INSTANCES_PATH); } catch {}
    sessionMgr = new SessionManager(testConfig);

    httpServer = http.createServer();
    wsServer = new TerminalWSServer(httpServer, sessionMgr);

    await new Promise((resolve) => {
      httpServer.listen(0, () => {
        port = httpServer.address().port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    wsServer.closeAll();
    await new Promise((resolve) => {
      httpServer.close(resolve);
    });
    cleanupTmuxSessions();
    try { fs.unlinkSync(TEST_INSTANCES_PATH); } catch {};
  });

  function connectTerminalWS(terminalId) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal/${terminalId}`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  function connectControlWS() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  function waitForMessage(ws, predicate, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeoutMs);
      ws.on('message', function handler(data) {
        const msg = JSON.parse(data.toString());
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        }
      });
    });
  }

  describe('control channel', () => {
    it('establishes a control WebSocket connection', async () => {
      const ws = await connectControlWS();
      expect(ws.readyState).to.equal(WebSocket.OPEN);
      ws.close();
    });

    it('creates a terminal via create_terminal message', async () => {
      const ws = await connectControlWS();
      const sessionsPromise = waitForMessage(ws, (m) => m.type === 'sessions');

      ws.send(JSON.stringify({ type: 'create_terminal', name: 'Test Shell' }));

      const msg = await sessionsPromise;
      expect(msg.sessions).to.have.length(1);
      expect(msg.sessions[0].name).to.equal('Test Shell');

      ws.close();
    });

    it('destroys a terminal via destroy_terminal message', async () => {
      const ws = await connectControlWS();

      // Create first
      const createPromise = waitForMessage(ws, (m) => m.type === 'sessions');
      ws.send(JSON.stringify({ type: 'create_terminal', name: 'Temp' }));
      const createMsg = await createPromise;
      const id = createMsg.sessions[0].id;

      // Destroy
      const destroyPromise = waitForMessage(ws, (m) => m.type === 'sessions');
      ws.send(JSON.stringify({ type: 'destroy_terminal', id }));
      const destroyMsg = await destroyPromise;
      expect(destroyMsg.sessions).to.have.length(0);

      ws.close();
    });

    it('updates a terminal via update_terminal message', async () => {
      const ws = await connectControlWS();

      // Create first
      const createPromise = waitForMessage(ws, (m) => m.type === 'sessions');
      ws.send(JSON.stringify({ type: 'create_terminal', name: 'Original' }));
      const createMsg = await createPromise;
      const id = createMsg.sessions[0].id;

      // Update
      const updatePromise = waitForMessage(ws, (m) => m.type === 'sessions');
      ws.send(JSON.stringify({
        type: 'update_terminal',
        id,
        name: 'Renamed',
        headerBg: '#ff0000',
        headerColor: '#ffffff'
      }));
      const updateMsg = await updatePromise;
      expect(updateMsg.sessions[0].name).to.equal('Renamed');
      expect(updateMsg.sessions[0].headerBg).to.equal('#ff0000');
      expect(updateMsg.sessions[0].headerColor).to.equal('#ffffff');

      ws.close();
    });

    it('destroy_terminal allows destroying any terminal', async () => {
      const ws = await connectControlWS();

      // Create a terminal
      const createPromise = waitForMessage(ws, (m) => m.type === 'sessions');
      ws.send(JSON.stringify({ type: 'create_terminal', name: 'Any' }));
      const createMsg = await createPromise;
      const id = createMsg.sessions[0].id;

      // Destroy without needing ephemeral- prefix
      const destroyPromise = waitForMessage(ws, (m) => m.type === 'sessions');
      ws.send(JSON.stringify({ type: 'destroy_terminal', id }));
      const destroyMsg = await destroyPromise;
      expect(destroyMsg.sessions.some((s) => s.id === id)).to.be.false;

      ws.close();
    });
  });

  describe('terminal connection', () => {
    it('establishes a terminal WebSocket and receives output', async () => {
      // Create a terminal first
      const result = await sessionMgr.createTerminal(DEFAULT_INSTANCE, 'Test');
      const ws = await connectTerminalWS(result.id);
      const msg = await waitForMessage(ws, (m) => m.type === 'output');
      expect(msg.type).to.equal('output');
      expect(msg.data).to.be.a('string');
      ws.close();
    });

    it('rejects connection for non-existent terminal', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal/nonexistent`);
      ws.on('close', (code) => {
        expect(code).to.be.oneOf([1008, 1011, 4004]);
        done();
      });
      ws.on('error', () => {}); // Suppress error event
    });
  });

  describe('input', () => {
    it('sends input to the terminal via WebSocket', async () => {
      const result = await sessionMgr.createTerminal(DEFAULT_INSTANCE, 'Test');
      const ws = await connectTerminalWS(result.id);
      await waitForMessage(ws, (m) => m.type === 'output');

      ws.send(JSON.stringify({ type: 'input', data: 'echo TESTINPUT123\n' }));

      const msg = await waitForMessage(ws, (m) =>
        m.type === 'output' && m.data.includes('TESTINPUT123')
      );
      expect(msg.data).to.include('TESTINPUT123');
      ws.close();
    });
  });

  describe('resize', () => {
    it('handles resize messages with valid dimensions', async () => {
      const result = await sessionMgr.createTerminal(DEFAULT_INSTANCE, 'Test');
      const ws = await connectTerminalWS(result.id);
      await waitForMessage(ws, (m) => m.type === 'output');

      ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));

      await new Promise((r) => setTimeout(r, 200));
      ws.close();
    });

    it('ignores resize messages with invalid dimensions', async () => {
      const result = await sessionMgr.createTerminal(DEFAULT_INSTANCE, 'Test');
      const ws = await connectTerminalWS(result.id);
      await waitForMessage(ws, (m) => m.type === 'output');

      ws.send(JSON.stringify({ type: 'resize', cols: -1, rows: 40 }));
      ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 0 }));
      ws.send(JSON.stringify({ type: 'resize', cols: 501, rows: 40 }));
      ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 201 }));
      ws.send(JSON.stringify({ type: 'resize', cols: 'bad', rows: 40 }));

      await new Promise((r) => setTimeout(r, 200));
      ws.close();
    });
  });

  describe('multi-client', () => {
    it('multiple clients share the same pty and receive the same output', async () => {
      const result = await sessionMgr.createTerminal(DEFAULT_INSTANCE, 'Test');
      const ws1 = await connectTerminalWS(result.id);
      const ws2 = await connectTerminalWS(result.id);

      await waitForMessage(ws1, (m) => m.type === 'output');
      await waitForMessage(ws2, (m) => m.type === 'output');

      ws1.send(JSON.stringify({ type: 'input', data: 'echo MULTI_TEST\n' }));

      const [msg1, msg2] = await Promise.all([
        waitForMessage(ws1, (m) => m.type === 'output' && m.data.includes('MULTI_TEST')),
        waitForMessage(ws2, (m) => m.type === 'output' && m.data.includes('MULTI_TEST'))
      ]);

      expect(msg1.data).to.include('MULTI_TEST');
      expect(msg2.data).to.include('MULTI_TEST');

      ws1.close();
      ws2.close();
    });
  });

  describe('disconnect cleanup', () => {
    it('cleans up pty attachment on disconnect without killing tmux session', async () => {
      const result = await sessionMgr.createTerminal(DEFAULT_INSTANCE, 'Test');
      const ws = await connectTerminalWS(result.id);
      await waitForMessage(ws, (m) => m.type === 'output');
      ws.close();

      await new Promise((r) => setTimeout(r, 300));

      // tmux session should still exist
      try {
        execSync(`tmux -L terminaldeck-test has-session -t terminaldeck-test-${result.id} 2>/dev/null`);
      } catch {
        throw new Error('tmux session was killed on disconnect');
      }
    });
  });

  describe('control messages', () => {
    it('properly frames JSON messages on terminal WS', async () => {
      const result = await sessionMgr.createTerminal(DEFAULT_INSTANCE, 'Test');
      const ws = await connectTerminalWS(result.id);
      const msg = await waitForMessage(ws, (m) => m.type === 'output');
      expect(msg).to.have.property('type');
      expect(msg).to.have.property('data');
      ws.close();
    });
  });

  describe('Error scenarios', () => {
    it('malformed JSON to control WS does not crash the server', async () => {
      const ws = await connectControlWS();
      ws.send('not-valid-json{{{');
      // Allow time for the message to be processed
      await new Promise((r) => setTimeout(r, 200));
      // Connection should remain open — server silently ignores malformed JSON
      expect(ws.readyState).to.equal(WebSocket.OPEN);
      ws.close();
    });

    it('unknown message type on control WS is silently ignored', async () => {
      const ws = await connectControlWS();
      ws.send(JSON.stringify({ type: 'no_such_message_type', payload: 'ignored' }));
      await new Promise((r) => setTimeout(r, 200));
      expect(ws.readyState).to.equal(WebSocket.OPEN);
      ws.close();
    });

    it('resize message with out-of-range values does not call pty.resize', async () => {
      const result = await sessionMgr.createTerminal(DEFAULT_INSTANCE, 'Test');
      const ws = await connectTerminalWS(result.id);
      await waitForMessage(ws, (m) => m.type === 'output');

      const terminal = wsServer._terminals.get(result.id);
      const resizeSpy = sinon.spy(terminal.pty, 'resize');

      // All of these are out of range per the server validation
      ws.send(JSON.stringify({ type: 'resize', cols: 0, rows: 40 }));
      ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 0 }));
      ws.send(JSON.stringify({ type: 'resize', cols: 501, rows: 40 }));
      ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 201 }));
      ws.send(JSON.stringify({ type: 'resize', cols: -5, rows: 40 }));

      await new Promise((r) => setTimeout(r, 200));
      expect(resizeSpy.callCount).to.equal(0);

      resizeSpy.restore();
      ws.close();
    });

    it('invalid terminal ID on WS upgrade closes with code 4004', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal/definitely-does-not-exist`);
      ws.on('close', (code) => {
        expect(code).to.equal(4004);
        done();
      });
      ws.on('error', () => {}); // Suppress connection-level errors
    });

    it('server token mismatch on upgrade destroys the socket (HTTP 403)', (done) => {
      const tokenServer = http.createServer();
      const tokenWss = new TerminalWSServer(tokenServer, sessionMgr, { serverToken: 'secret123' });

      tokenServer.listen(0, () => {
        const tokenPort = tokenServer.address().port;
        // Connect without the required token
        const ws = new WebSocket(`ws://127.0.0.1:${tokenPort}/ws/control`);
        let finished = false;
        const finish = (err) => {
          if (finished) return;
          finished = true;
          tokenWss.closeAll();
          tokenServer.close(() => done(err));
        };
        ws.on('error', () => finish());
        ws.on('unexpected-response', (req, res) => {
          expect(res.statusCode).to.equal(403);
          ws.terminate();
          finish();
        });
      });
    });

    it('PTY write when terminal has exited does not crash', async () => {
      const result = await sessionMgr.createTerminal(DEFAULT_INSTANCE, 'Test');
      const ws = await connectTerminalWS(result.id);
      await waitForMessage(ws, (m) => m.type === 'output');

      // Simulate the terminal having exited by setting the flag directly
      const terminal = wsServer._terminals.get(result.id);
      terminal.exited = true;

      // Sending input while exited should be a silent no-op
      ws.send(JSON.stringify({ type: 'input', data: 'should not be written\n' }));

      await new Promise((r) => setTimeout(r, 200));
      // If we reach here without an uncaught exception the test passes
      expect(ws.readyState).to.equal(WebSocket.OPEN);

      terminal.exited = false; // Restore so cleanup doesn't misbehave
      ws.close();
    });
  });
});
