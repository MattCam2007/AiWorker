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
  // Clean up on both the default socket and the dedicated terminaldeck socket
  for (const socketFlag of ['', '-L terminaldeck']) {
    try {
      const cmd = `tmux ${socketFlag} list-sessions -F "#{session_name}" 2>/dev/null`.replace(/  +/g, ' ').trim();
      const output = execSync(cmd, { encoding: 'utf-8' });
      output
        .trim()
        .split('\n')
        .filter((s) => s.startsWith('terminaldeck-'))
        .forEach((s) => {
          try {
            execSync(`tmux ${socketFlag} kill-session -t "${s}" 2>/dev/null`.replace(/  +/g, ' ').trim());
          } catch {}
        });
    } catch {}
  }
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
    settings: { shell: '/bin/bash' }
  };

  beforeEach(function () {
    cleanupTmuxSessions();
  });

  afterEach(function () {
    cleanupTmuxSessions();
  });

  describe('createTerminal', () => {
    it('creates a tmux session and returns id and name', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal('Test Shell');
      expect(result.id).to.be.a('string');
      expect(result.name).to.equal('Test Shell');
      const sessions = await mgr.listSessions();
      expect(sessions).to.have.length(1);
      expect(sessions[0].name).to.equal('Test Shell');
    });

    it('creates a tmux session with a custom command', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal('Custom', '/bin/sh');
      expect(result.id).to.be.a('string');
      expect(result.name).to.equal('Custom');
    });

    it('uses default shell when no command provided', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal('Default Shell');
      expect(result.id).to.be.a('string');
    });
  });

  describe('discoverSessions', () => {
    it('discovers existing terminaldeck tmux sessions', async () => {
      // Create a tmux session manually with the terminaldeck- prefix
      const id = 'discover-test-1';
      execSync(`tmux -L terminaldeck new-session -d -s terminaldeck-${id} /bin/bash`);

      const mgr = new SessionManager(testConfig);
      await mgr.discoverSessions();

      const sessions = await mgr.listSessions();
      expect(sessions.some((s) => s.id === id)).to.be.true;
    });

    it('ignores non-terminaldeck tmux sessions', async () => {
      execSync('tmux new-session -d -s other-session /bin/bash');

      const mgr = new SessionManager(testConfig);
      await mgr.discoverSessions();

      const sessions = await mgr.listSessions();
      expect(sessions.some((s) => s.id === 'other-session')).to.be.false;

      // Cleanup non-terminaldeck session
      try { execSync('tmux kill-session -t other-session'); } catch {}
    });

    it('does not duplicate already-tracked sessions', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal('Existing');
      await mgr.discoverSessions();

      const sessions = await mgr.listSessions();
      const matching = sessions.filter((s) => s.id === result.id);
      expect(matching).to.have.length(1);
    });
  });

  describe('attachSession', () => {
    it('returns a pty instance attached to the tmux session', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal('Test');
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
      const result = await mgr.createTerminal('Test');
      await mgr.destroySession(result.id);
      const sessions = await mgr.listSessions();
      expect(sessions).to.have.length(0);
    });
  });

  describe('listSessions', () => {
    it('returns all tracked sessions with status info', async () => {
      const mgr = new SessionManager(testConfig);
      await mgr.createTerminal('Shell 1');
      await mgr.createTerminal('Shell 2');
      const sessions = await mgr.listSessions();
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
      await mgr.createTerminal('Shell 1');
      const sessions = await mgr.listSessions();
      expect(sessions[0]).to.have.property('headerBg', null);
      expect(sessions[0]).to.have.property('headerColor', null);
    });

    it('returns updated headerBg and headerColor after updateSession', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal('Shell 1');
      mgr.updateSession(result.id, { headerBg: '#ff0000', headerColor: '#ffffff' });
      const sessions = await mgr.listSessions();
      expect(sessions[0].headerBg).to.equal('#ff0000');
      expect(sessions[0].headerColor).to.equal('#ffffff');
    });
  });

  describe('updateSession', () => {
    it('updates session name', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal('Original');
      const ok = mgr.updateSession(result.id, { name: 'Renamed' });
      expect(ok).to.be.true;
      const sessions = await mgr.listSessions();
      expect(sessions[0].name).to.equal('Renamed');
    });

    it('updates headerBg and headerColor', async () => {
      const mgr = new SessionManager(testConfig);
      const result = await mgr.createTerminal('Test');
      mgr.updateSession(result.id, { headerBg: '#1a1a2e', headerColor: '#e94560' });
      const sessions = await mgr.listSessions();
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
      const result = await mgr.createTerminal('Original');
      mgr.updateSession(result.id, { headerBg: '#123456' });
      const sessions = await mgr.listSessions();
      expect(sessions[0].name).to.equal('Original');
      expect(sessions[0].headerBg).to.equal('#123456');
      expect(sessions[0].headerColor).to.be.null;
    });
  });
});
