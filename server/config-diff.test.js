const { expect } = require('chai');
const { computeConfigDiff } = require('./config-diff');

describe('computeConfigDiff', () => {
  const baseConfig = {
    settings: {
      theme: { defaultColor: '#33ff33', background: '#0a0a0a' },
      shell: '/bin/bash',
      defaultLayout: 'dev'
    },
    terminals: [
      { id: 'shell1', name: 'Shell', workingDir: '/tmp', autoStart: true },
      { id: 'logs', name: 'Logs', command: 'tail -f /var/log/syslog', autoStart: false }
    ],
    layouts: {
      dev: { grid: '2x1', cells: [['shell1', 'logs']] }
    }
  };

  it('identifies added terminals', () => {
    const newConfig = {
      ...baseConfig,
      terminals: [
        ...baseConfig.terminals,
        { id: 'newshell', name: 'New Shell', autoStart: true }
      ]
    };

    const diff = computeConfigDiff(baseConfig, newConfig);
    expect(diff.addedTerminals).to.deep.equal([
      { id: 'newshell', name: 'New Shell', autoStart: true }
    ]);
    expect(diff.removedTerminals).to.deep.equal([]);
  });

  it('identifies removed terminals', () => {
    const newConfig = {
      ...baseConfig,
      terminals: [baseConfig.terminals[0]],
      layouts: { dev: { grid: '1x1', cells: [['shell1']] } }
    };

    const diff = computeConfigDiff(baseConfig, newConfig);
    expect(diff.removedTerminals).to.deep.equal(['logs']);
    expect(diff.addedTerminals).to.deep.equal([]);
  });

  it('identifies modified terminals (same ID, changed properties)', () => {
    const newConfig = {
      ...baseConfig,
      terminals: [
        { id: 'shell1', name: 'Renamed Shell', workingDir: '/home', autoStart: true },
        baseConfig.terminals[1]
      ]
    };

    const diff = computeConfigDiff(baseConfig, newConfig);
    expect(diff.modifiedTerminals).to.deep.equal(['shell1']);
    expect(diff.addedTerminals).to.deep.equal([]);
    expect(diff.removedTerminals).to.deep.equal([]);
  });

  it('detects layout changes', () => {
    const newConfig = {
      ...baseConfig,
      layouts: {
        dev: { grid: '1x1', cells: [['shell1']] },
        focus: { grid: '1x1', cells: [['logs']] }
      }
    };

    const diff = computeConfigDiff(baseConfig, newConfig);
    expect(diff.layoutsChanged).to.be.true;
  });

  it('detects no layout changes when layouts are identical', () => {
    const diff = computeConfigDiff(baseConfig, baseConfig);
    expect(diff.layoutsChanged).to.be.false;
  });

  it('detects theme changes', () => {
    const newConfig = {
      ...baseConfig,
      settings: {
        ...baseConfig.settings,
        theme: { defaultColor: '#ff0000', background: '#0a0a0a' }
      }
    };

    const diff = computeConfigDiff(baseConfig, newConfig);
    expect(diff.themeChanged).to.be.true;
  });

  it('detects settings changes', () => {
    const newConfig = {
      ...baseConfig,
      settings: {
        ...baseConfig.settings,
        defaultLayout: 'focus'
      }
    };

    const diff = computeConfigDiff(baseConfig, newConfig);
    expect(diff.settingsChanged).to.be.true;
  });

  it('returns empty diff when configs are identical', () => {
    const diff = computeConfigDiff(baseConfig, baseConfig);
    expect(diff.addedTerminals).to.deep.equal([]);
    expect(diff.removedTerminals).to.deep.equal([]);
    expect(diff.modifiedTerminals).to.deep.equal([]);
    expect(diff.layoutsChanged).to.be.false;
    expect(diff.themeChanged).to.be.false;
    expect(diff.settingsChanged).to.be.false;
  });
});
