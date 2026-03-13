const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ConfigManager } = require('./config');

describe('ConfigManager', () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminaldeck-test-'));
    configPath = path.join(tmpDir, 'terminaldeck.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const validConfig = {
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

  describe('loading and parsing', () => {
    it('loads and parses a valid config file', () => {
      writeConfig(validConfig);
      const mgr = new ConfigManager(configPath);
      const cfg = mgr.load();
      expect(cfg.settings.shell).to.equal('/bin/bash');
      expect(cfg.settings.theme.defaultColor).to.equal('#33ff33');
    });

    it('throws if config file does not exist and no previous config', () => {
      const mgr = new ConfigManager('/nonexistent/path.json');
      expect(() => mgr.load()).to.throw();
    });
  });

  describe('defaults for missing optional fields', () => {
    it('provides default settings when settings section is minimal', () => {
      const minimal = { settings: {} };
      writeConfig(minimal);
      const mgr = new ConfigManager(configPath);
      const cfg = mgr.load();
      expect(cfg.settings.shell).to.equal('/bin/bash');
      expect(cfg.settings.theme).to.be.an('object');
      expect(cfg.settings.theme.fontSize).to.be.a('number');
    });

    it('provides default settings when settings is absent', () => {
      writeConfig({});
      const mgr = new ConfigManager(configPath);
      const cfg = mgr.load();
      expect(cfg.settings.shell).to.equal('/bin/bash');
      expect(cfg.settings.theme.defaultColor).to.equal('#33ff33');
    });
  });

  describe('malformed JSON handling', () => {
    it('does not crash on malformed JSON and retains last valid config', () => {
      writeConfig(validConfig);
      const mgr = new ConfigManager(configPath);
      mgr.load();

      // Write malformed JSON
      fs.writeFileSync(configPath, '{bad json!!!');
      const cfg = mgr.load();
      // Should still have the last valid config
      expect(cfg.settings.shell).to.equal('/bin/bash');
    });

    it('throws on first load if JSON is malformed and no previous config exists', () => {
      fs.writeFileSync(configPath, '{bad json!!!');
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw();
    });
  });

  describe('validation', () => {
    it('rejects non-object settings', () => {
      writeConfig({ settings: 'bad' });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/settings/i);
    });

    it('accepts config with only settings', () => {
      writeConfig({ settings: { shell: '/bin/zsh' } });
      const mgr = new ConfigManager(configPath);
      const cfg = mgr.load();
      expect(cfg.settings.shell).to.equal('/bin/zsh');
    });

    it('accepts empty config object', () => {
      writeConfig({});
      const mgr = new ConfigManager(configPath);
      const cfg = mgr.load();
      expect(cfg.settings).to.be.an('object');
    });
  });

  describe('file watching and events', () => {
    it('emits a "change" event when the config file changes', (done) => {
      writeConfig(validConfig);
      const mgr = new ConfigManager(configPath);
      mgr.load();
      mgr.watch();

      mgr.on('change', (newConfig) => {
        expect(newConfig.settings.shell).to.equal('/bin/zsh');
        mgr.stopWatching();
        done();
      });

      // Modify the config file
      setTimeout(() => {
        const updated = {
          settings: { ...validConfig.settings, shell: '/bin/zsh' }
        };
        writeConfig(updated);
      }, 100);
    });

    it('debounces rapid file changes into a single reload', (done) => {
      writeConfig(validConfig);
      const mgr = new ConfigManager(configPath);
      mgr.load();
      mgr.watch();

      let changeCount = 0;
      mgr.on('change', () => {
        changeCount++;
      });

      const updated = {
        settings: { ...validConfig.settings, shell: '/bin/zsh' }
      };

      setTimeout(() => { writeConfig(updated); }, 50);
      setTimeout(() => { writeConfig(updated); }, 100);
      setTimeout(() => { writeConfig(updated); }, 150);

      // After debounce period (500ms + buffer), should have only emitted once
      setTimeout(() => {
        expect(changeCount).to.equal(1);
        mgr.stopWatching();
        done();
      }, 1200);
    });

    it('emits "error" on invalid config change but retains last valid', (done) => {
      writeConfig(validConfig);
      const mgr = new ConfigManager(configPath);
      mgr.load();
      mgr.watch();

      mgr.on('error', (err) => {
        // Should still have old valid config
        expect(mgr.getConfig().settings.shell).to.equal('/bin/bash');
        mgr.stopWatching();
        done();
      });

      setTimeout(() => {
        fs.writeFileSync(configPath, '{invalid json');
      }, 100);
    });
  });
});
