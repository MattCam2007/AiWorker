const { expect } = require('chai');
const sinon = require('sinon');
const { SessionManager } = require('./sessions');
const { execSync } = require('child_process');

// Helper to check if tmux is available
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

describe('SessionManager', function () {
  if (!tmuxAvailable()) {
    before(function () {
      console.log('    ⚠ tmux not available, skipping session tests');
      this.skip();
    });
    it('requires tmux');
    return;
  }

  this.timeout(15000);

  const testConfig = {
    settings: { shell: '/bin/bash' },
    terminals: [
      { id: 'test1', name: 'Test 1', workingDir: '/tmp', autoStart: true },
      { id: 'test2', name: 'Test 2', workingDir: '/tmp', autoStart: true },
      { id: 'test3', name: 'Test 3', workingDir: '/tmp', autoStart: false }
    ],
    layouts: {}
  };

  beforeEach(function () {
    cleanupTmuxSessions();
  });

  afterEach(function () {
    cleanupTmuxSessions();
  });

  describe('createSession', () => {
    it('creates a tmux session for a terminal config', async () => {
      const mgr = new SessionManager(testConfig);
      await mgr.createSession(testConfig.terminals[0]);
      const sessions = await mgr.listSessions();
      expect(sessions).to.have.length(1);
      expect(sessions[0].id).to.equal('test1');
    });
  });

  describe('startup with autoStart', () => {
    it('creates sessions for all autoStart terminals', async () => {
      const mgr = new SessionManager(testConfig);
      await mgr.startAll();
      const sessions = await mgr.listSessions();
      const ids = sessions.map((s) => s.id);
      expect(ids).to.include('test1');
      expect(ids).to.include('test2');
      expect(ids).to.not.include('test3');
    });
  });

  describe('existing session reuse', () => {
    it('reuses existing tmux sessions instead of creating duplicates', async () => {
      // Create a session manually
      execSync('tmux new-session -d -s terminaldeck-test1 /bin/bash');

      const mgr = new SessionManager(testConfig);
      await mgr.createSession(testConfig.terminals[0]);

      // Should still only have one tmux session with that name
      const output = execSync(
        'tmux list-sessions -F "#{session_name}" 2>/dev/null',
        { encoding: 'utf-8' }
      );
      const matches = output
        .trim()
        .split('\n')
        .filter((s) => s === 'terminaldeck-test1');
      expect(matches).to.have.length(1);
    });
  });

  describe('attachSession', () => {
    it('returns a pty instance attached to the tmux session', async () => {
      const mgr = new SessionManager(testConfig);
      await mgr.createSession(testConfig.terminals[0]);
      const pty = mgr.attachSession('test1');
      expect(pty).to.have.property('write');
      expect(pty).to.have.property('onData');
      pty.kill();
    });
  });

  describe('destroySession', () => {
    it('kills the tmux session and removes it from tracking', async () => {
      const mgr = new SessionManager(testConfig);
      await mgr.createSession(testConfig.terminals[0]);
      await mgr.destroySession('test1');
      const sessions = await mgr.listSessions();
      expect(sessions).to.have.length(0);
    });
  });

  describe('listSessions', () => {
    it('returns all active sessions with status info', async () => {
      const mgr = new SessionManager(testConfig);
      await mgr.startAll();
      const sessions = await mgr.listSessions();
      expect(sessions).to.be.an('array');
      expect(sessions).to.have.length(2);
      for (const s of sessions) {
        expect(s).to.have.property('id');
        expect(s).to.have.property('name');
        expect(s).to.have.property('active');
      }
    });
  });

  describe('ephemeral sessions', () => {
    it('creates an ephemeral session with auto-generated ID', async () => {
      const mgr = new SessionManager(testConfig);
      const session = await mgr.createEphemeral('Temp Shell');
      expect(session.id).to.match(/^ephemeral-/);
      expect(session.name).to.equal('Temp Shell');
      const sessions = await mgr.listSessions();
      expect(sessions.some((s) => s.id === session.id)).to.be.true;
    });

    it('can destroy an ephemeral session', async () => {
      const mgr = new SessionManager(testConfig);
      const session = await mgr.createEphemeral('Temp Shell');
      await mgr.destroySession(session.id);
      const sessions = await mgr.listSessions();
      expect(sessions.some((s) => s.id === session.id)).to.be.false;
    });
  });

  describe('config reload', () => {
    it('creates new sessions and removes old ones on config change', async () => {
      const mgr = new SessionManager(testConfig);
      await mgr.startAll();

      const newConfig = {
        settings: { shell: '/bin/bash' },
        terminals: [
          { id: 'test1', name: 'Test 1', workingDir: '/tmp', autoStart: true },
          { id: 'test4', name: 'New Terminal', workingDir: '/tmp', autoStart: true }
        ],
        layouts: {}
      };
      await mgr.handleConfigReload(newConfig);
      const sessions = await mgr.listSessions();
      const ids = sessions.map((s) => s.id);
      expect(ids).to.include('test1');
      expect(ids).to.include('test4');
      expect(ids).to.not.include('test2');
    });
  });
});
