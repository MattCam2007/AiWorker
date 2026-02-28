const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ConfigManager } = require('./config');

describe('Notifications — Config', () => {
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

  it('loads config with default settings when none specified', () => {
    writeConfig({ settings: {} });
    const mgr = new ConfigManager(configPath);
    const cfg = mgr.load();
    expect(cfg.settings.shell).to.equal('/bin/bash');
  });

  it('preserves custom settings when specified', () => {
    writeConfig({ settings: { shell: '/bin/zsh' } });
    const mgr = new ConfigManager(configPath);
    const cfg = mgr.load();
    expect(cfg.settings.shell).to.equal('/bin/zsh');
  });
});
