const { expect } = require('chai');
const sinon = require('sinon');
const http = require('http');
const WebSocket = require('ws');
const { execSync } = require('child_process');
const { TerminalWSServer } = require('./websocket');
const { SessionManager } = require('./sessions');

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

describe('TerminalWSServer', function () {
  this.timeout(15000);

  let httpServer;
  let wsServer;
  let sessionMgr;
  let port;

  const testConfig = {
    settings: { shell: '/bin/bash' },
    terminals: [
      { id: 'wstest1', name: 'WS Test 1', workingDir: '/tmp', autoStart: true }
    ],
    layouts: {}
  };

  beforeEach(async () => {
    cleanupTmuxSessions();
    sessionMgr = new SessionManager(testConfig);
    await sessionMgr.startAll();

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
  });

  function connectWS(terminalId) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal/${terminalId}`);
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

  describe('connection', () => {
    it('establishes a WebSocket connection and receives terminal output', async () => {
      const ws = await connectWS('wstest1');
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
      const ws = await connectWS('wstest1');
      // Wait for initial output (shell prompt)
      await waitForMessage(ws, (m) => m.type === 'output');

      // Send input
      ws.send(JSON.stringify({ type: 'input', data: 'echo TESTINPUT123\n' }));

      // Should see the input echoed back in output
      const msg = await waitForMessage(ws, (m) =>
        m.type === 'output' && m.data.includes('TESTINPUT123')
      );
      expect(msg.data).to.include('TESTINPUT123');
      ws.close();
    });
  });

  describe('resize', () => {
    it('handles resize messages with valid dimensions', async () => {
      const ws = await connectWS('wstest1');
      await waitForMessage(ws, (m) => m.type === 'output');

      // Should not throw
      ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));

      // Give it a moment to process
      await new Promise((r) => setTimeout(r, 200));
      ws.close();
    });

    it('ignores resize messages with invalid dimensions', async () => {
      const ws = await connectWS('wstest1');
      await waitForMessage(ws, (m) => m.type === 'output');

      // These should all be silently ignored (no crash)
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
      const ws1 = await connectWS('wstest1');
      const ws2 = await connectWS('wstest1');

      // Wait for both to get initial output
      await waitForMessage(ws1, (m) => m.type === 'output');
      await waitForMessage(ws2, (m) => m.type === 'output');

      // Send input from client 1
      ws1.send(JSON.stringify({ type: 'input', data: 'echo MULTI_TEST\n' }));

      // Both should see the output (from the shared pty)
      const [msg1, msg2] = await Promise.all([
        waitForMessage(ws1, (m) => m.type === 'output' && m.data.includes('MULTI_TEST')),
        waitForMessage(ws2, (m) => m.type === 'output' && m.data.includes('MULTI_TEST'))
      ]);

      expect(msg1.data).to.include('MULTI_TEST');
      expect(msg2.data).to.include('MULTI_TEST');

      ws1.close();
      ws2.close();
    });

    it('input from either client goes to the shared pty', async () => {
      const ws1 = await connectWS('wstest1');
      const ws2 = await connectWS('wstest1');

      await waitForMessage(ws1, (m) => m.type === 'output');
      await waitForMessage(ws2, (m) => m.type === 'output');

      // Send input from client 2
      ws2.send(JSON.stringify({ type: 'input', data: 'echo FROM_CLIENT2\n' }));

      // Client 1 should see it too
      const msg = await waitForMessage(ws1, (m) =>
        m.type === 'output' && m.data.includes('FROM_CLIENT2')
      );
      expect(msg.data).to.include('FROM_CLIENT2');

      ws1.close();
      ws2.close();
    });
  });

  describe('disconnect cleanup', () => {
    it('cleans up pty attachment on disconnect without killing tmux session', async () => {
      const ws = await connectWS('wstest1');
      await waitForMessage(ws, (m) => m.type === 'output');
      ws.close();

      // Wait for cleanup
      await new Promise((r) => setTimeout(r, 300));

      // tmux session should still exist
      try {
        execSync('tmux has-session -t terminaldeck-wstest1 2>/dev/null');
      } catch {
        throw new Error('tmux session was killed on disconnect');
      }
    });

    it('keeps pty alive while at least one client is connected', async () => {
      const ws1 = await connectWS('wstest1');
      const ws2 = await connectWS('wstest1');

      await waitForMessage(ws1, (m) => m.type === 'output');
      await waitForMessage(ws2, (m) => m.type === 'output');

      // Disconnect first client
      ws1.close();
      await new Promise((r) => setTimeout(r, 300));

      // Second client should still receive output
      ws2.send(JSON.stringify({ type: 'input', data: 'echo STILL_ALIVE\n' }));
      const msg = await waitForMessage(ws2, (m) =>
        m.type === 'output' && m.data.includes('STILL_ALIVE')
      );
      expect(msg.data).to.include('STILL_ALIVE');

      ws2.close();
    });
  });

  describe('control messages', () => {
    it('properly frames JSON messages', async () => {
      const ws = await connectWS('wstest1');
      const msg = await waitForMessage(ws, (m) => m.type === 'output');
      expect(msg).to.have.property('type');
      expect(msg).to.have.property('data');
      ws.close();
    });
  });

  describe('ephemeral sessions via WebSocket', () => {
    it('creates and destroys ephemeral sessions', async () => {
      const ws = await connectWS('wstest1');
      await waitForMessage(ws, (m) => m.type === 'output');

      // Request ephemeral session creation
      ws.send(JSON.stringify({ type: 'create_ephemeral', name: 'Temp Test' }));

      const sessionsMsg = await waitForMessage(ws, (m) => m.type === 'sessions');
      const ephemeral = sessionsMsg.sessions.find((s) => s.name === 'Temp Test');
      expect(ephemeral).to.exist;
      expect(ephemeral.id).to.match(/^ephemeral-/);

      // Destroy it
      ws.send(JSON.stringify({ type: 'destroy_ephemeral', id: ephemeral.id }));

      const updatedMsg = await waitForMessage(ws, (m) => m.type === 'sessions');
      const found = updatedMsg.sessions.find((s) => s.id === ephemeral.id);
      expect(found).to.not.exist;

      ws.close();
    });

    it('create_ephemeral ignores the command parameter', async () => {
      const ws = await connectWS('wstest1');
      await waitForMessage(ws, (m) => m.type === 'output');

      // Send create_ephemeral with a command parameter - it should be ignored
      ws.send(JSON.stringify({
        type: 'create_ephemeral',
        name: 'NoCmd Test',
        command: '/usr/bin/evil-binary'
      }));

      const sessionsMsg = await waitForMessage(ws, (m) => m.type === 'sessions');
      const ephemeral = sessionsMsg.sessions.find((s) => s.name === 'NoCmd Test');
      expect(ephemeral).to.exist;
      expect(ephemeral.id).to.match(/^ephemeral-/);

      // The session should use the default shell, not the provided command
      // The command stored in the session should be the configured shell, not the evil binary
      expect(ephemeral.command).to.not.equal('/usr/bin/evil-binary');

      // Clean up
      ws.send(JSON.stringify({ type: 'destroy_ephemeral', id: ephemeral.id }));
      await waitForMessage(ws, (m) => m.type === 'sessions');
      ws.close();
    });

    it('destroy_ephemeral rejects non-ephemeral session IDs', async () => {
      const ws = await connectWS('wstest1');
      await waitForMessage(ws, (m) => m.type === 'output');

      // Try to destroy a non-ephemeral session
      ws.send(JSON.stringify({ type: 'destroy_ephemeral', id: 'wstest1' }));

      const errorMsg = await waitForMessage(ws, (m) => m.type === 'error');
      expect(errorMsg.message).to.equal('Can only destroy ephemeral sessions');

      // The session should still exist
      ws.send(JSON.stringify({ type: 'create_ephemeral', name: 'Trigger List' }));
      const sessionsMsg = await waitForMessage(ws, (m) => m.type === 'sessions');
      const wstest1 = sessionsMsg.sessions.find((s) => s.id === 'wstest1');
      expect(wstest1).to.exist;

      ws.close();
    });

    it('destroy_ephemeral rejects missing ID', async () => {
      const ws = await connectWS('wstest1');
      await waitForMessage(ws, (m) => m.type === 'output');

      // Try to destroy without providing an ID
      ws.send(JSON.stringify({ type: 'destroy_ephemeral' }));

      const errorMsg = await waitForMessage(ws, (m) => m.type === 'error');
      expect(errorMsg.message).to.equal('Can only destroy ephemeral sessions');

      ws.close();
    });
  });
});
