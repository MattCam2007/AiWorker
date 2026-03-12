const fs = require('fs');
const path = require('path');

function createFileOps(workspaceRoot) {
  async function _validatePath(p) {
    const resolved = path.resolve(workspaceRoot, p);
    if (!resolved.startsWith(workspaceRoot)) {
      throw { code: 'TRAVERSAL', message: 'Path traversal denied' };
    }
    try {
      const real = await fs.promises.realpath(resolved);
      if (!real.startsWith(workspaceRoot)) {
        throw { code: 'TRAVERSAL', message: 'Path traversal denied' };
      }
    } catch (err) {
      if (err.code === 'TRAVERSAL') throw err;
      // ENOENT is fine — path doesn't exist yet
    }
    return resolved;
  }

  function _validateName(name) {
    if (!name || name.includes('/') || name.includes('\\') || name.includes('\0') || name.startsWith('.')) {
      throw { code: 'INVALID_NAME', message: 'Invalid name' };
    }
  }

  async function createFile(parentDir, name) {
    _validateName(name);
    const resolvedParent = await _validatePath(parentDir);
    const fullPath = path.join(resolvedParent, name);
    try {
      await fs.promises.writeFile(fullPath, '', { flag: 'wx' });
    } catch (err) {
      if (err.code === 'EEXIST') throw { code: 'EEXIST', message: 'File already exists' };
      throw err;
    }
    return { name, path: path.relative(workspaceRoot, fullPath), type: 'file' };
  }

  async function createDirectory(parentDir, name) {
    _validateName(name);
    const resolvedParent = await _validatePath(parentDir);
    const fullPath = path.join(resolvedParent, name);
    try {
      await fs.promises.mkdir(fullPath);
    } catch (err) {
      if (err.code === 'EEXIST') throw { code: 'EEXIST', message: 'Directory already exists' };
      throw err;
    }
    return { name, path: path.relative(workspaceRoot, fullPath), type: 'dir' };
  }

  return { createFile, createDirectory };
}

module.exports = { createFileOps };
