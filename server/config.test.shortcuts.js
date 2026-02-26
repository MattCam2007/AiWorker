const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ConfigManager } = require('./config');

describe('ConfigManager — shortcuts', () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminaldeck-shortcut-test-'));
    configPath = path.join(tmpDir, 'terminaldeck.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(cfg) {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  }

  describe('parsing', () => {
    it('parses shortcuts section from config JSON', () => {
      writeConfig({
        settings: { shell: '/bin/bash' },
        shortcuts: {
          global: [
            { name: 'Git Pull', command: 'git pull', aliases: ['gp', 'pull'], icon: 'git-pull-request' }
          ],
          projects: {
            '/workspace/terminaldeck': [
              { name: 'Dev Server', command: 'npm run dev', aliases: ['dev', 'serve'] }
            ]
          }
        }
      });
      const mgr = new ConfigManager(configPath);
      const cfg = mgr.load();
      expect(cfg.shortcuts).to.be.an('object');
      expect(cfg.shortcuts.global).to.be.an('array').with.lengthOf(1);
      expect(cfg.shortcuts.global[0].name).to.equal('Git Pull');
      expect(cfg.shortcuts.global[0].command).to.equal('git pull');
      expect(cfg.shortcuts.global[0].aliases).to.deep.equal(['gp', 'pull']);
      expect(cfg.shortcuts.global[0].icon).to.equal('git-pull-request');
      expect(cfg.shortcuts.projects).to.have.property('/workspace/terminaldeck');
      expect(cfg.shortcuts.projects['/workspace/terminaldeck']).to.be.an('array').with.lengthOf(1);
    });
  });

  describe('defaults', () => {
    it('returns default empty shortcuts when shortcuts section is missing', () => {
      writeConfig({ settings: { shell: '/bin/bash' } });
      const mgr = new ConfigManager(configPath);
      const cfg = mgr.load();
      expect(cfg.shortcuts).to.be.an('object');
      expect(cfg.shortcuts.global).to.be.an('array').that.is.empty;
      expect(cfg.shortcuts.projects).to.be.an('object');
      expect(Object.keys(cfg.shortcuts.projects)).to.have.lengthOf(0);
    });

    it('defaults global to empty array when only projects provided', () => {
      writeConfig({
        shortcuts: {
          projects: { '/some/path': [{ name: 'Test', command: 'echo test' }] }
        }
      });
      const mgr = new ConfigManager(configPath);
      const cfg = mgr.load();
      expect(cfg.shortcuts.global).to.be.an('array').that.is.empty;
    });

    it('defaults projects to empty object when only global provided', () => {
      writeConfig({
        shortcuts: {
          global: [{ name: 'Test', command: 'echo test' }]
        }
      });
      const mgr = new ConfigManager(configPath);
      const cfg = mgr.load();
      expect(cfg.shortcuts.projects).to.be.an('object');
      expect(Object.keys(cfg.shortcuts.projects)).to.have.lengthOf(0);
    });
  });

  describe('validation', () => {
    it('rejects non-object shortcuts section', () => {
      writeConfig({ shortcuts: 'bad' });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/shortcuts.*must be an object/i);
    });

    it('rejects array as shortcuts section', () => {
      writeConfig({ shortcuts: [] });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/shortcuts.*must be an object/i);
    });

    it('rejects non-array shortcuts.global', () => {
      writeConfig({ shortcuts: { global: 'bad' } });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/shortcuts\.global must be an array/i);
    });

    it('rejects non-object shortcuts.projects', () => {
      writeConfig({ shortcuts: { projects: 'bad' } });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/shortcuts\.projects must be an object/i);
    });

    it('rejects shortcuts.projects as an array', () => {
      writeConfig({ shortcuts: { projects: [] } });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/shortcuts\.projects must be an object/i);
    });

    it('rejects global shortcut missing name', () => {
      writeConfig({ shortcuts: { global: [{ command: 'echo test' }] } });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/shortcut.*must have.*name/i);
    });

    it('rejects global shortcut missing command', () => {
      writeConfig({ shortcuts: { global: [{ name: 'Test' }] } });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/shortcut.*must have.*command/i);
    });

    it('rejects global shortcut with non-string name', () => {
      writeConfig({ shortcuts: { global: [{ name: 123, command: 'echo test' }] } });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/shortcut.*name.*must be a string/i);
    });

    it('rejects global shortcut with non-string command', () => {
      writeConfig({ shortcuts: { global: [{ name: 'Test', command: 123 }] } });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/shortcut.*command.*must be a string/i);
    });

    it('rejects shortcut with non-array aliases', () => {
      writeConfig({ shortcuts: { global: [{ name: 'Test', command: 'echo test', aliases: 'bad' }] } });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/aliases.*must be an array/i);
    });

    it('rejects shortcut with non-string alias entry', () => {
      writeConfig({ shortcuts: { global: [{ name: 'Test', command: 'echo test', aliases: [123] }] } });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/alias.*must be a string/i);
    });

    it('rejects shortcut with non-string icon', () => {
      writeConfig({ shortcuts: { global: [{ name: 'Test', command: 'echo test', icon: 123 }] } });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/icon.*must be a string/i);
    });

    it('rejects project shortcut missing name', () => {
      writeConfig({ shortcuts: { projects: { '/path': [{ command: 'echo test' }] } } });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/shortcut.*must have.*name/i);
    });

    it('rejects project shortcut with non-array value', () => {
      writeConfig({ shortcuts: { projects: { '/path': 'bad' } } });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/project.*shortcuts.*must be an array/i);
    });

    it('accepts valid shortcuts with all optional fields', () => {
      writeConfig({
        shortcuts: {
          global: [
            { name: 'Test', command: 'echo test', aliases: ['t'], icon: 'play' }
          ],
          projects: {
            '/some/path': [
              { name: 'Build', command: 'make build', aliases: ['b'] }
            ]
          }
        }
      });
      const mgr = new ConfigManager(configPath);
      const cfg = mgr.load();
      expect(cfg.shortcuts.global).to.have.lengthOf(1);
      expect(cfg.shortcuts.projects['/some/path']).to.have.lengthOf(1);
    });

    it('accepts shortcuts with only required fields (no aliases or icon)', () => {
      writeConfig({
        shortcuts: {
          global: [{ name: 'Test', command: 'echo test' }]
        }
      });
      const mgr = new ConfigManager(configPath);
      const cfg = mgr.load();
      expect(cfg.shortcuts.global[0].name).to.equal('Test');
      expect(cfg.shortcuts.global[0].command).to.equal('echo test');
    });
  });

  describe('getShortcuts()', () => {
    it('returns merged project + global shortcuts when cwd matches', () => {
      writeConfig({
        shortcuts: {
          global: [
            { name: 'Git Pull', command: 'git pull', aliases: ['gp'] }
          ],
          projects: {
            '/workspace/terminaldeck': [
              { name: 'Dev Server', command: 'npm run dev', aliases: ['dev'] }
            ]
          }
        }
      });
      const mgr = new ConfigManager(configPath);
      mgr.load();
      const shortcuts = mgr.getShortcuts('/workspace/terminaldeck');
      expect(shortcuts).to.be.an('array');
      // Project shortcuts appear first
      expect(shortcuts[0].name).to.equal('Dev Server');
      expect(shortcuts[1].name).to.equal('Git Pull');
    });

    it('returns only global shortcuts when cwd does not match any project', () => {
      writeConfig({
        shortcuts: {
          global: [
            { name: 'Git Pull', command: 'git pull' }
          ],
          projects: {
            '/workspace/terminaldeck': [
              { name: 'Dev Server', command: 'npm run dev' }
            ]
          }
        }
      });
      const mgr = new ConfigManager(configPath);
      mgr.load();
      const shortcuts = mgr.getShortcuts('/some/other/path');
      expect(shortcuts).to.be.an('array').with.lengthOf(1);
      expect(shortcuts[0].name).to.equal('Git Pull');
    });

    it('returns only global shortcuts when no cwd provided', () => {
      writeConfig({
        shortcuts: {
          global: [
            { name: 'Git Pull', command: 'git pull' }
          ],
          projects: {
            '/workspace/terminaldeck': [
              { name: 'Dev Server', command: 'npm run dev' }
            ]
          }
        }
      });
      const mgr = new ConfigManager(configPath);
      mgr.load();
      const shortcuts = mgr.getShortcuts();
      expect(shortcuts).to.be.an('array').with.lengthOf(1);
      expect(shortcuts[0].name).to.equal('Git Pull');
    });

    it('uses longest matching project path when cwd matches multiple', () => {
      writeConfig({
        shortcuts: {
          global: [
            { name: 'Global', command: 'echo global' }
          ],
          projects: {
            '/workspace': [
              { name: 'Workspace', command: 'echo workspace' }
            ],
            '/workspace/terminaldeck': [
              { name: 'TerminalDeck', command: 'echo td' }
            ],
            '/workspace/terminaldeck/server': [
              { name: 'Server', command: 'echo server' }
            ]
          }
        }
      });
      const mgr = new ConfigManager(configPath);
      mgr.load();

      // cwd is /workspace/terminaldeck/server — should match /workspace/terminaldeck/server
      let shortcuts = mgr.getShortcuts('/workspace/terminaldeck/server');
      expect(shortcuts[0].name).to.equal('Server');

      // cwd is /workspace/terminaldeck — should match /workspace/terminaldeck
      shortcuts = mgr.getShortcuts('/workspace/terminaldeck');
      expect(shortcuts[0].name).to.equal('TerminalDeck');

      // cwd is /workspace/terminaldeck/client — should match /workspace/terminaldeck
      shortcuts = mgr.getShortcuts('/workspace/terminaldeck/client');
      expect(shortcuts[0].name).to.equal('TerminalDeck');
    });

    it('returns empty array when no shortcuts configured', () => {
      writeConfig({ settings: { shell: '/bin/bash' } });
      const mgr = new ConfigManager(configPath);
      mgr.load();
      const shortcuts = mgr.getShortcuts('/workspace/terminaldeck');
      expect(shortcuts).to.be.an('array').that.is.empty;
    });

    it('includes source field to distinguish project vs global shortcuts', () => {
      writeConfig({
        shortcuts: {
          global: [
            { name: 'Git Pull', command: 'git pull' }
          ],
          projects: {
            '/workspace/terminaldeck': [
              { name: 'Dev Server', command: 'npm run dev' }
            ]
          }
        }
      });
      const mgr = new ConfigManager(configPath);
      mgr.load();
      const shortcuts = mgr.getShortcuts('/workspace/terminaldeck');
      expect(shortcuts[0].source).to.equal('project');
      expect(shortcuts[1].source).to.equal('global');
    });
  });
});
