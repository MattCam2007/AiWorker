const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ConfigManager } = require('./config');

describe('Notifications — Config (promptPattern)', () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminaldeck-notif-test-'));
    configPath = path.join(tmpDir, 'terminaldeck.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(cfg) {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  }

  it('applies default promptPattern when not specified', () => {
    writeConfig({ settings: {} });
    const mgr = new ConfigManager(configPath);
    const cfg = mgr.load();
    expect(cfg.settings.promptPattern).to.equal('\\$\\s*$');
  });

  it('preserves custom promptPattern when specified', () => {
    writeConfig({ settings: { promptPattern: '%\\s*$' } });
    const mgr = new ConfigManager(configPath);
    const cfg = mgr.load();
    expect(cfg.settings.promptPattern).to.equal('%\\s*$');
  });

  it('rejects non-string promptPattern', () => {
    writeConfig({ settings: { promptPattern: 123 } });
    const mgr = new ConfigManager(configPath);
    expect(() => mgr.load()).to.throw(/promptPattern/i);
  });

  it('accepts valid string promptPattern', () => {
    writeConfig({ settings: { promptPattern: '>>>\\s*$' } });
    const mgr = new ConfigManager(configPath);
    const cfg = mgr.load();
    expect(cfg.settings.promptPattern).to.equal('>>>\\s*$');
  });
});
