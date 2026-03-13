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

  async function dedupName(dir, name) {
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    let candidate = name;
    let i = 2;
    while (true) {
      try {
        await fs.promises.access(path.join(dir, candidate));
        // file exists, try next
        candidate = `${base} (${i})${ext}`;
        i++;
        if (i > 99) throw new Error('Too many duplicates');
      } catch (err) {
        if (err.code === 'ENOENT') return candidate;
        if (err.message === 'Too many duplicates') throw err;
        throw err;
      }
    }
  }

  async function rename(targetPath, newName) {
    _validateName(newName);
    const resolvedTarget = await _validatePath(targetPath);
    let stat;
    try {
      stat = await fs.promises.stat(resolvedTarget);
    } catch (err) {
      if (err.code === 'ENOENT') throw { code: 'ENOENT', message: 'Not found' };
      throw err;
    }
    const newFullPath = path.join(path.dirname(resolvedTarget), newName);
    await _validatePath(path.relative(workspaceRoot, newFullPath));
    await fs.promises.rename(resolvedTarget, newFullPath);
    return {
      name: newName,
      path: path.relative(workspaceRoot, newFullPath),
      type: stat.isDirectory() ? 'dir' : 'file',
    };
  }

  async function remove(targetPath) {
    const resolved = await _validatePath(targetPath);
    let stat;
    try {
      stat = await fs.promises.stat(resolved);
    } catch (err) {
      if (err.code === 'ENOENT') throw { code: 'ENOENT', message: 'Not found' };
      throw err;
    }
    if (stat.isDirectory()) {
      await fs.promises.rm(resolved, { recursive: true });
    } else {
      await fs.promises.unlink(resolved);
    }
    return { success: true };
  }

  async function copy(srcPath, destDir) {
    const resolvedSrc = await _validatePath(srcPath);
    const resolvedDestDir = await _validatePath(destDir);
    let stat;
    try {
      stat = await fs.promises.stat(resolvedSrc);
    } catch (err) {
      if (err.code === 'ENOENT') throw { code: 'ENOENT', message: 'Not found' };
      throw err;
    }
    const srcName = path.basename(resolvedSrc);
    const finalName = await dedupName(resolvedDestDir, srcName);
    const destFullPath = path.join(resolvedDestDir, finalName);
    if (stat.isDirectory()) {
      await fs.promises.cp(resolvedSrc, destFullPath, { recursive: true });
    } else {
      try {
        await fs.promises.copyFile(resolvedSrc, destFullPath, fs.constants.COPYFILE_EXCL);
      } catch (err) {
        if (err.code === 'EEXIST') {
          const finalName2 = await dedupName(resolvedDestDir, srcName);
          const destFullPath2 = path.join(resolvedDestDir, finalName2);
          await fs.promises.copyFile(resolvedSrc, destFullPath2, fs.constants.COPYFILE_EXCL);
          return {
            name: finalName2,
            path: path.relative(workspaceRoot, destFullPath2),
            type: 'file',
          };
        }
        throw err;
      }
    }
    return {
      name: finalName,
      path: path.relative(workspaceRoot, destFullPath),
      type: stat.isDirectory() ? 'dir' : 'file',
    };
  }

  async function move(srcPath, destDir) {
    const resolvedSrc = await _validatePath(srcPath);
    const resolvedDestDir = await _validatePath(destDir);
    let stat;
    try {
      stat = await fs.promises.stat(resolvedSrc);
    } catch (err) {
      if (err.code === 'ENOENT') throw { code: 'ENOENT', message: 'Not found' };
      throw err;
    }
    const srcName = path.basename(resolvedSrc);
    const newPath = path.join(resolvedDestDir, srcName);
    await fs.promises.rename(resolvedSrc, newPath);
    return {
      name: srcName,
      path: path.relative(workspaceRoot, newPath),
      type: stat.isDirectory() ? 'dir' : 'file',
    };
  }

  return { createFile, createDirectory, rename, remove, copy, move };
}

module.exports = { createFileOps };
