const http = require('http');
const fs = require('fs');
const path = require('path');
const { ConfigManager } = require('./config');
const { SessionManager } = require('./sessions');
const { FolderManager } = require('./folders');
const { TerminalWSServer } = require('./websocket');
const { listDirectory } = require('./filetree');
const { getHistoryFilePath, createHistoryRoute } = require('./history');
const { NoteManager } = require('./notes');
const log = require('./log');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

const CLIENT_DIR = path.join(__dirname, '..', 'client');

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on('data', function (chunk) { chunks.push(chunk); });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString()); });
    req.on('error', reject);
  });
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self' ws: wss:; script-src 'self'");
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  // Strip query strings
  filePath = filePath.split('?')[0];
  // Prevent directory traversal
  const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(CLIENT_DIR, safePath);

  // Ensure we're still within CLIENT_DIR
  if (!fullPath.startsWith(CLIENT_DIR + path.sep)) {
    setSecurityHeaders(res);
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      setSecurityHeaders(res);
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(fullPath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    setSecurityHeaders(res);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

async function createApp(options = {}) {
  const { randomBytes } = require('crypto');
  const serverToken = randomBytes(32).toString('hex');

  const configPath = options.configPath || path.join(__dirname, '..', 'config', 'terminaldeck.json');
  const port = options.port ?? parseInt(process.env.TERMINALDECK_PORT || '3000', 10);

  const configManager = new ConfigManager(configPath);
  const config = configManager.load();

  // Allow overriding tmux socket/prefix (used by tests for isolation)
  if (options.tmuxSocket) config.tmuxSocket = options.tmuxSocket;
  if (options.sessionPrefix) config.sessionPrefix = options.sessionPrefix;

  const historyFilePath = getHistoryFilePath(config.settings.shell);
  const historyRoute = createHistoryRoute(historyFilePath);

  const sessionManager = new SessionManager(config);
  await sessionManager.discoverSessions();

  const foldersPath = options.foldersPath || path.join(__dirname, '..', 'config', 'folders.json');
  const folderManager = new FolderManager(foldersPath);
  folderManager.load();

  const noteManager = new NoteManager(configManager);

  const server = http.createServer((req, res) => {
    // API routes
    if (req.url === '/api/config' && req.method === 'GET') {
      setSecurityHeaders(res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...configManager.getConfig(), serverToken }));
      return;
    }

    if (req.url === '/api/folders' && req.method === 'GET') {
      setSecurityHeaders(res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        folders: folderManager.getFolders(),
        sessionFolders: folderManager.getSessionFolders()
      }));
      return;
    }

    if (req.url === '/api/sessions' && req.method === 'GET') {
      (async () => {
        const sessions = await sessionManager.listSessions();
        setSecurityHeaders(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(sessions));
      })().catch((err) => {
        if (!res.headersSent) {
          setSecurityHeaders(res);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/shortcuts')) {
      const url = new URL(req.url, 'http://localhost');
      const cwd = url.searchParams.get('cwd') || undefined;
      const shortcuts = configManager.getShortcuts(cwd);
      setSecurityHeaders(res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(shortcuts));
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/files')) {
      const url = new URL(req.url, 'http://localhost');
      const dirPath = url.searchParams.get('path') || '.';
      (async () => {
        const entries = await listDirectory(dirPath);
        setSecurityHeaders(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(entries));
      })().catch((err) => {
        if (!res.headersSent) {
          setSecurityHeaders(res);
          if (err.code === 'TRAVERSAL') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden' }));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        }
      });
      return;
    }

    if (req.url === '/api/history' && req.method === 'GET') {
      historyRoute(req, res);
      return;
    }

    // --- Note API routes ---

    if (req.url === '/api/notes' && req.method === 'GET') {
      setSecurityHeaders(res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(noteManager.listNotes()));
      return;
    }

    if (req.url === '/api/notes' && req.method === 'POST') {
      readBody(req).then(function (body) {
        var data;
        try { data = JSON.parse(body); } catch (e) {
          setSecurityHeaders(res);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }
        // Open an existing workspace file as a note
        if (data.filePath && typeof data.filePath === 'string') {
          var note = noteManager.openFile(data.filePath);
          if (!note) {
            setSecurityHeaders(res);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid file path' }));
            return;
          }
          setSecurityHeaders(res);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(note));
          return;
        }
        if (!data.name || typeof data.name !== 'string') {
          setSecurityHeaders(res);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'name is required' }));
          return;
        }
        var note = noteManager.createNote(data.name);
        setSecurityHeaders(res);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(note));
      }).catch(function (err) {
        if (!res.headersSent) {
          setSecurityHeaders(res);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Match /api/notes/:id routes
    var noteMatch = req.url.match(/^\/api\/notes\/([a-zA-Z0-9_-]+)(\?.*)?$/);
    if (noteMatch) {
      var noteId = noteMatch[1];

      if (req.method === 'GET') {
        var note = noteManager.getNote(noteId);
        setSecurityHeaders(res);
        if (!note) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Note not found' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(note));
        }
        return;
      }

      if (req.method === 'PUT') {
        readBody(req).then(function (body) {
          var data;
          try { data = JSON.parse(body); } catch (e) {
            setSecurityHeaders(res);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
            return;
          }
          if (typeof data.content !== 'string') {
            setSecurityHeaders(res);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'content is required' }));
            return;
          }
          var result = noteManager.saveNote(noteId, data.content);
          setSecurityHeaders(res);
          if (!result) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Note not found' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            // Broadcast note_saved to all control clients
            wsServer.broadcastNoteSaved(noteId);
          }
        }).catch(function (err) {
          if (!res.headersSent) {
            setSecurityHeaders(res);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      if (req.method === 'DELETE') {
        var url = new URL(req.url, 'http://localhost');
        var deleteFile = url.searchParams.get('deleteFile') === 'true';
        var deleteResult = noteManager.deleteNote(noteId, deleteFile);
        setSecurityHeaders(res);
        if (!deleteResult) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Note not found' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(deleteResult));
        }
        return;
      }
    }

    // Static files
    serveStatic(req, res);
  });

  const wsServer = new TerminalWSServer(server, sessionManager, { serverToken, configManager, folderManager });
  wsServer.startActivityBroadcasting();

  sessionManager.on('sessionDied', () => { wsServer._broadcastSessions(); });
  sessionManager.startHealthCheck();

  // Watch history file for changes and push updates to clients
  wsServer.watchHistoryFile(historyFilePath);

  // Config hot-reload (settings/theme only)
  configManager.watch();
  configManager.on('change', (newConfig) => {
    wsServer.broadcastConfigReload(newConfig);
  });
  configManager.on('error', (err) => {
    log.error('Config error (retaining last valid config):', err.message);
  });

  const actualPort = await new Promise((resolve) => {
    server.listen(port, () => {
      resolve(server.address().port);
    });
  });

  return {
    server,
    port: actualPort,
    configManager,
    sessionManager,
    noteManager,
    wsServer,
    close() {
      return new Promise((resolve) => {
        configManager.stopWatching();
        sessionManager.stopHealthCheck();
        wsServer.closeAll();
        server.close(resolve);
      });
    }
  };
}

// If run directly (not required as module)
if (require.main === module) {
  createApp().then((app) => {
    log.log(`TerminalDeck running on http://localhost:${app.port}`);

    const shutdown = async () => {
      log.log('Shutting down...');
      await app.close();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('uncaughtException', (err) => {
      log.error('[fatal] uncaught exception:', err);
    });
    process.on('unhandledRejection', (reason) => {
      log.error('[fatal] unhandled rejection:', reason);
    });
  }).catch((err) => {
    log.error('Failed to start TerminalDeck:', err);
    process.exit(1);
  });
}

module.exports = { createApp };
