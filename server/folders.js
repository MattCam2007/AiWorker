'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DEFAULT_PATH = path.join(__dirname, '..', 'config', 'folders.json');

function isValidFolderColor(val) {
  return val === null || /^#[0-9a-fA-F]{6}$/.test(val);
}

class FolderManager {
  constructor(filePath) {
    this._filePath = filePath || DEFAULT_PATH;
    this._folders = [];
    this._sessionFolders = {};
  }

  load() {
    try {
      const raw = fs.readFileSync(this._filePath, 'utf-8');
      const data = JSON.parse(raw);
      this._folders = Array.isArray(data.folders) ? data.folders : [];
      this._sessionFolders =
        data.sessionFolders &&
        typeof data.sessionFolders === 'object' &&
        !Array.isArray(data.sessionFolders)
          ? data.sessionFolders
          : {};
    } catch {
      this._folders = [];
      this._sessionFolders = {};
    }
  }

  _save() {
    const data = { folders: this._folders, sessionFolders: this._sessionFolders };
    fs.writeFileSync(this._filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  getFolders() {
    return this._folders.slice();
  }

  getSessionFolders() {
    return Object.assign({}, this._sessionFolders);
  }

  createFolder(name, parentId) {
    if (!name || typeof name !== 'string' || name.length > 100) {
      throw new Error('Folder name must be a non-empty string of 100 characters or fewer');
    }
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Folder name cannot be blank');
    if (parentId != null && !this._folders.find(f => f.id === parentId)) {
      throw new Error('Parent folder not found');
    }
    const folder = { id: randomUUID(), name: trimmed, parentId: parentId || null, collapsed: false, headerBg: null, headerColor: null, headerHighlight: null, startCommand: null };
    this._folders.push(folder);
    this._save();
    return folder;
  }

  updateFolder(id, updates) {
    const folder = this._folders.find(f => f.id === id);
    if (!folder) return false;
    if (updates.name !== undefined) {
      if (typeof updates.name !== 'string' || updates.name.length > 100) throw new Error('Invalid folder name');
      const trimmed = updates.name.trim();
      if (!trimmed) throw new Error('Folder name cannot be blank');
      folder.name = trimmed;
    }
    if (updates.collapsed !== undefined) {
      folder.collapsed = !!updates.collapsed;
    }
    if (updates.parentId !== undefined) {
      if (updates.parentId !== null && !this._isValidParent(id, updates.parentId)) {
        throw new Error('Invalid parent: would create a cycle');
      }
      folder.parentId = updates.parentId;
    }
    if (updates.headerBg !== undefined) {
      folder.headerBg = isValidFolderColor(updates.headerBg) ? updates.headerBg : null;
    }
    if (updates.headerColor !== undefined) {
      folder.headerColor = isValidFolderColor(updates.headerColor) ? updates.headerColor : null;
    }
    if (updates.headerHighlight !== undefined) {
      folder.headerHighlight = isValidFolderColor(updates.headerHighlight) ? updates.headerHighlight : null;
    }
    if (updates.startCommand !== undefined) {
      if (updates.startCommand === null || updates.startCommand === '') {
        folder.startCommand = null;
      } else if (typeof updates.startCommand === 'string' && updates.startCommand.length <= 500) {
        folder.startCommand = updates.startCommand.trim() || null;
      }
    }
    this._save();
    return true;
  }

  _isValidParent(folderId, candidateParentId) {
    let current = candidateParentId;
    const seen = new Set();
    while (current) {
      if (current === folderId) return false;
      if (seen.has(current)) return false;
      seen.add(current);
      const f = this._folders.find(f => f.id === current);
      current = f ? f.parentId : null;
    }
    return true;
  }

  deleteFolder(id) {
    const idx = this._folders.findIndex(f => f.id === id);
    if (idx === -1) return false;
    const folder = this._folders[idx];
    // Reparent children to the deleted folder's parent
    for (const child of this._folders) {
      if (child.parentId === id) child.parentId = folder.parentId;
    }
    // Unassign sessions from this folder
    for (const [sessionId, fId] of Object.entries(this._sessionFolders)) {
      if (fId === id) delete this._sessionFolders[sessionId];
    }
    this._folders.splice(idx, 1);
    this._save();
    return true;
  }

  moveTerminal(sessionId, folderId) {
    if (folderId == null || folderId === '') {
      delete this._sessionFolders[sessionId];
    } else {
      if (!this._folders.find(f => f.id === folderId)) throw new Error('Folder not found');
      this._sessionFolders[sessionId] = folderId;
    }
    this._save();
    return true;
  }

  cleanupSessions(validSessionIds) {
    const validSet = new Set(validSessionIds);
    let changed = false;
    for (const sessionId of Object.keys(this._sessionFolders)) {
      if (!validSet.has(sessionId)) {
        delete this._sessionFolders[sessionId];
        changed = true;
      }
    }
    if (changed) this._save();
  }
}

module.exports = { FolderManager };
