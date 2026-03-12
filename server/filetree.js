const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = '/workspace';

/**
 * List a single directory level under /workspace.
 * Returns [{ name, path, type: 'dir'|'file' }] sorted dirs-first then alphabetical.
 */
async function listDirectory(dirPath) {
  // Resolve to absolute and verify it's within /workspace
  const resolved = path.resolve(WORKSPACE_ROOT, dirPath);
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    const err = new Error('Path traversal denied');
    err.code = 'TRAVERSAL';
    throw err;
  }

  // Resolve symlinks to prevent escaping /workspace via symlink targets
  try {
    const real = await fs.promises.realpath(resolved);
    if (!real.startsWith(WORKSPACE_ROOT)) {
      const err = new Error('Path traversal denied');
      err.code = 'TRAVERSAL';
      throw err;
    }
  } catch (err) {
    if (err.code === 'TRAVERSAL') throw err;
    // Directory doesn't exist — let readdir below handle the ENOENT
  }

  const entries = await fs.promises.readdir(resolved, { withFileTypes: true });

  const results = [];
  for (const entry of entries) {
    // Skip hidden files (dotfiles)
    if (entry.name.startsWith('.')) continue;

    results.push({
      name: entry.name,
      path: path.relative(WORKSPACE_ROOT, path.join(resolved, entry.name)),
      type: entry.isDirectory() ? 'dir' : 'file'
    });
  }

  // Sort: directories first, then alphabetical within each group
  results.sort(function (a, b) {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}

module.exports = { listDirectory };
