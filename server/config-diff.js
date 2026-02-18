function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

function computeConfigDiff(oldConfig, newConfig) {
  const oldTerminalMap = new Map();
  for (const t of oldConfig.terminals) {
    oldTerminalMap.set(t.id, t);
  }

  const newTerminalMap = new Map();
  for (const t of newConfig.terminals) {
    newTerminalMap.set(t.id, t);
  }

  const addedTerminals = newConfig.terminals.filter(t => !oldTerminalMap.has(t.id));
  const removedTerminals = oldConfig.terminals
    .filter(t => !newTerminalMap.has(t.id))
    .map(t => t.id);
  const modifiedTerminals = newConfig.terminals
    .filter(t => oldTerminalMap.has(t.id) && !deepEqual(oldTerminalMap.get(t.id), t))
    .map(t => t.id);

  const layoutsChanged = !deepEqual(oldConfig.layouts, newConfig.layouts);
  const themeChanged = !deepEqual(
    oldConfig.settings && oldConfig.settings.theme,
    newConfig.settings && newConfig.settings.theme
  );
  const settingsChanged = !deepEqual(oldConfig.settings, newConfig.settings);

  return {
    addedTerminals,
    removedTerminals,
    modifiedTerminals,
    layoutsChanged,
    themeChanged,
    settingsChanged
  };
}

module.exports = { computeConfigDiff };
