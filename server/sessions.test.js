const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const { SessionManager, DEFAULT_INSTANCE } = require('./sessions');
const { execSync } = require('child_process');

const TEST_INSTANCES_PATH = '/tmp/terminaldeck-test-instances.json';

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
    tmuxSocket: 'terminaldeck-test',
    sessionPrefix: 'terminaldeck-test-',
    instancesPath: TEST_INSTANCES_PATH
  };

  beforeEach(function () {
    cleanupTmuxSessions();
    try { fs.unlinkSync(TEST_INSTANCES_PATH); } catch {}
  });

  afterEach(function () {
    cleanupTmuxSessions();
    try { fs.unlinkSync(TEST_INSTANCES_PATH); } catch {}
  });

  describe('createTerminal', () => {
    it('creates a tmux session and returns id and name', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal(DEFAULT_INSTANCE, 'Test Shell');
      expect(result.id).to.be.a('string');
      expect(result.name).to.equal('Test Shell');
      const sessions = await mgr.listSessions(DEFAULT_INSTANCE);
      expect(sessions).to.have.length(1);
      expect(sessions[0].name).to.equal('Test Shell');
    });

    it('creates a tmux session with a custom command', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal(DEFAULT_INSTANCE, 'Custom', '/bin/sh');
      expect(result.id).to.be.a('string');
      expect(result.name).to.equal('Custom');
    });

    it('uses default shell when no command provided', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal(DEFAULT_INSTANCE, 'Default Shell');
      expect(result.id).to.be.a('string');
    });

    it('sessions from different instances are isolated', async () => {
      const mgr = new SessionManager(testConfig);
      await mgr.createTerminal('instance-A', 'Shell A');
      await mgr.createTerminal('instance-B', 'Shell B');
      const sessionsA = await mgr.listSessions('instance-A');
      const sessionsB = await mgr.listSessions('instance-B');
      expect(sessionsA).to.have.length(1);
      expect(sessionsA[0].name).to.equal('Shell A');
      expect(sessionsB).to.have.length(1);
      expect(sessionsB[0].name).to.equal('Shell B');
    });
  });

  describe('discoverSessions', () => {
    it('discovers existing terminaldeck tmux sessions and assigns to default instance', async () => {
      const id = 'discover-test-1';
      execSync(`tmux -L terminaldeck-test new-session -d -s terminaldeck-test-${id} /bin/bash`);

      const mgr = new SessionManager(testConfig);
      await mgr.discoverSessions();

      const sessions = await mgr.listSessions(DEFAULT_INSTANCE);
      expect(sessions.some((s) => s.id === id)).to.be.true;
    });

    it('ignores non-terminaldeck tmux sessions', async () => {
      execSync('tmux new-session -d -s other-session /bin/bash');

      const mgr = new SessionManager(testConfig);
      await mgr.discoverSessions();

      const sessions = await mgr.listSessions(DEFAULT_INSTANCE);
      expect(sessions.some((s) => s.id === 'other-session')).to.be.false;

      try { execSync('tmux kill-session -t other-session'); } catch {}
    });

    it('does not duplicate already-tracked sessions', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal(DEFAULT_INSTANCE, 'Existing');
      await mgr.discoverSessions();

      const sessions = await mgr.listSessions(DEFAULT_INSTANCE);
      const matching = sessions.filter((s) => s.id === result.id);
      expect(matching).to.have.length(1);
    });

    it('restores instance mapping from instances.json on discoverSessions', async () => {
      const mgr1 = new SessionManager(testConfig);
      const result = await mgr1.createTerminal('my-instance', 'Persisted');

      // New manager instance reads from instances.json
      const mgr2 = new SessionManager(testConfig);
      await mgr2.discoverSessions();

      const sessions = await mgr2.listSessions('my-instance');
      expect(sessions.some((s) => s.id === result.id)).to.be.true;
      // Should NOT appear in default instance
      const defaultSessions = await mgr2.listSessions(DEFAULT_INSTANCE);
      expect(defaultSessions.some((s) => s.id === result.id)).to.be.false;
    });
  });

  describe('attachSession', () => {
    it('returns a pty instance attached to the tmux session', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal(DEFAULT_INSTANCE, 'Test');
      const pty = await mgr.attachSession(result.id);
      expect(pty).to.have.property('write');
      expect(pty).to.have.property('onData');
      pty.kill();
    });

    it('throws for non-existent terminal', async () => {
      const mgr = new SessionManager(testConfig);
      try {
        await mgr.attachSession('nonexistent');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('No tmux session found');
      }
    });
  });

  describe('destroySession', () => {
    it('kills the tmux session and removes it from tracking', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal(DEFAULT_INSTANCE, 'Test');
      await mgr.destroySession(DEFAULT_INSTANCE, result.id);
      const sessions = await mgr.listSessions(DEFAULT_INSTANCE);
      expect(sessions).to.have.length(0);
    });
  });

  describe('listSessions', () => {
    it('returns all tracked sessions with status info', async () => {
      const mgr = new SessionManager(testConfig);
      await mgr.createTerminal(DEFAULT_INSTANCE, 'Shell 1');
      await mgr.createTerminal(DEFAULT_INSTANCE, 'Shell 2');
      const sessions = await mgr.listSessions(DEFAULT_INSTANCE);
      expect(sessions).to.be.an('array');
      expect(sessions).to.have.length(2);
      for (const s of sessions) {
        expect(s).to.have.property('id');
        expect(s).to.have.property('name');
        expect(s).to.have.property('active');
      }
    });

    it('returns headerBg and headerColor fields', async () => {
      const mgr = new SessionManager(testConfig);
      await mgr.createTerminal(DEFAULT_INSTANCE, 'Shell 1');
      const sessions = await mgr.listSessions(DEFAULT_INSTANCE);
      expect(sessions[0]).to.have.property('headerBg', null);
      expect(sessions[0]).to.have.property('headerColor', null);
    });

    it('returns updated headerBg and headerColor after updateSession', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal(DEFAULT_INSTANCE, 'Shell 1');
      mgr.updateSession(result.id, { headerBg: '#ff0000', headerColor: '#ffffff' });
      const sessions = await mgr.listSessions(DEFAULT_INSTANCE);
      expect(sessions[0].headerBg).to.equal('#ff0000');
      expect(sessions[0].headerColor).to.equal('#ffffff');
    });
  });

  describe('updateSession', () => {
    it('updates session name', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal(DEFAULT_INSTANCE, 'Original');
      const ok = mgr.updateSession(result.id, { name: 'Renamed' });
      expect(ok).to.be.true;
      const sessions = await mgr.listSessions(DEFAULT_INSTANCE);
      expect(sessions[0].name).to.equal('Renamed');
    });

    it('updates headerBg and headerColor', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal(DEFAULT_INSTANCE, 'Test');
      mgr.updateSession(result.id, { headerBg: '#1a1a2e', headerColor: '#e94560' });
      const sessions = await mgr.listSessions(DEFAULT_INSTANCE);
      expect(sessions[0].headerBg).to.equal('#1a1a2e');
      expect(sessions[0].headerColor).to.equal('#e94560');
    });

    it('returns false for non-existent session', () => {
      const mgr = new SessionManager(testConfig);
      const ok = mgr.updateSession('nonexistent', { name: 'Foo' });
      expect(ok).to.be.false;
    });

    it('only updates provided fields', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal(DEFAULT_INSTANCE, 'Original');
      mgr.updateSession(result.id, { headerBg: '#123456' });
      const sessions = await mgr.listSessions(DEFAULT_INSTANCE);
      expect(sessions[0].name).to.equal('Original');
      expect(sessions[0].headerBg).to.equal('#123456');
      expect(sessions[0].headerColor).to.be.null;
    });
  });
});
