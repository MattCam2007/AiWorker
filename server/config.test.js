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
      shell: '/bin/bash',
      defaultLayout: 'dev'
    },
    terminals: [
      { id: 'shell1', name: 'Shell', workingDir: '/tmp', autoStart: true },
      { id: 'logs', name: 'Logs', command: 'tail -f /var/log/syslog', workingDir: '/tmp', autoStart: false }
    ],
    layouts: {
      dev: {
        grid: '1x2',
        cells: [['shell1', 'logs']]
      }
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
      expect(cfg.terminals).to.have.length(2);
      expect(cfg.layouts.dev.grid).to.equal('1x2');
    });

    it('throws if config file does not exist and no previous config', () => {
      const mgr = new ConfigManager('/nonexistent/path.json');
      expect(() => mgr.load()).to.throw();
    });
  });

  describe('defaults for missing optional fields', () => {
    it('provides default settings when settings section is minimal', () => {
      const minimal = {
        settings: {},
        terminals: [{ id: 'shell1', name: 'Shell' }],
        layouts: {
          default: { grid: '1x1', cells: [['shell1']] }
        }
      };
      writeConfig(minimal);
      const mgr = new ConfigManager(configPath);
      const cfg = mgr.load();
      expect(cfg.settings.shell).to.equal('/bin/bash');
      expect(cfg.settings.theme).to.be.an('object');
      expect(cfg.settings.theme.fontSize).to.be.a('number');
      expect(cfg.settings.defaultLayout).to.be.a('string');
    });

    it('provides defaults for terminal entries missing optional fields', () => {
      const cfg = {
        settings: {},
        terminals: [{ id: 't1', name: 'Test' }],
        layouts: { default: { grid: '1x1', cells: [['t1']] } }
      };
      writeConfig(cfg);
      const mgr = new ConfigManager(configPath);
      const loaded = mgr.load();
      const t = loaded.terminals[0];
      expect(t.autoStart).to.equal(false);
      expect(t.workingDir).to.be.a('string');
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
      expect(cfg.terminals).to.have.length(2);
    });

    it('throws on first load if JSON is malformed and no previous config exists', () => {
      fs.writeFileSync(configPath, '{bad json!!!');
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw();
    });
  });

  describe('validation', () => {
    it('requires settings, terminals, and layouts sections', () => {
      writeConfig({ settings: {} });
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/terminals/i);
    });

    it('validates terminal IDs are unique', () => {
      const cfg = {
        settings: {},
        terminals: [
          { id: 'dup', name: 'One' },
          { id: 'dup', name: 'Two' }
        ],
        layouts: { default: { grid: '1x1', cells: [['dup']] } }
      };
      writeConfig(cfg);
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/duplicate/i);
    });

    it('validates layout cell references match existing terminal IDs', () => {
      const cfg = {
        settings: {},
        terminals: [{ id: 'shell1', name: 'Shell' }],
        layouts: {
          dev: { grid: '1x2', cells: [['shell1', 'nonexistent']] }
        }
      };
      writeConfig(cfg);
      const mgr = new ConfigManager(configPath);
      expect(() => mgr.load()).to.throw(/nonexistent/i);
    });
  });

  describe('file watching and events', () => {
    it('emits a "change" event when the config file changes', (done) => {
      writeConfig(validConfig);
      const mgr = new ConfigManager(configPath);
      mgr.load();
      mgr.watch();

      mgr.on('change', (newConfig) => {
        expect(newConfig.terminals).to.have.length(1);
        mgr.stopWatching();
        done();
      });

      // Modify the config file
      setTimeout(() => {
        const updated = {
          settings: validConfig.settings,
          terminals: [{ id: 'shell1', name: 'Shell', workingDir: '/tmp' }],
          layouts: { dev: { grid: '1x1', cells: [['shell1']] } }
        };
        writeConfig(updated);
      }, 100);
    });

    it('emits "error" on invalid config change but retains last valid', (done) => {
      writeConfig(validConfig);
      const mgr = new ConfigManager(configPath);
      mgr.load();
      mgr.watch();

      mgr.on('error', (err) => {
        // Should still have old valid config
        expect(mgr.getConfig().terminals).to.have.length(2);
        mgr.stopWatching();
        done();
      });

      setTimeout(() => {
        fs.writeFileSync(configPath, '{invalid json');
      }, 100);
    });
  });
});
