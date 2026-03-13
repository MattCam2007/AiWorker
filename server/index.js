const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ConfigManager } = require('./config');
const { SessionManager, DEFAULT_INSTANCE } = require('./sessions');
const { FolderManager } = require('./folders');
const { TerminalWSServer } = require('./websocket');
const { listDirectory, listClaudeDirectory, listOpencodeDirectory, OPENCODE_ROOT } = require('./filetree');
const { getHistoryFilePath, createHistoryRoute } = require('./history');
const { FileManager } = require('./files');
const { createFileOps } = require('./fileops');
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
  // Strip query strings first so /?instance=... resolves to /index.html
  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/index.html';
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

function _connectListdeckSSE(ldBase, wsServer) {
  let reconnectDelay = 2000;
  const DAILY_TASK_EVENTS = new Set([
    'daily_task_created', 'daily_task_updated', 'daily_task_deleted', 'daily_tasks_cleared'
  ]);

  function connect() {
    let sseUrl;
    try {
      sseUrl = new URL('/api/v1/events', ldBase);
    } catch {
      return;
    }
    const httpMod = sseUrl.protocol === 'https:' ? require('https') : require('http');

    const req = httpMod.get(sseUrl.toString(), (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        schedule();
        return;
      }
      reconnectDelay = 2000;
      let buf = '';
      let lastEvent = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            lastEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            if (DAILY_TASK_EVENTS.has(lastEvent)) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.date) wsServer.broadcastTasksUpdate(data.date);
              } catch {}
            }
          } else if (line === '') {
            lastEvent = '';
          }
        }
      });
      res.on('end', schedule);
      res.on('error', schedule);
    });
    req.on('error', schedule);
    req.setTimeout(0);
  }

  function schedule() {
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }

  connect();
}

async function createApp(options = {}) {
  const { randomBytes } = require('crypto');
  const serverToken = randomBytes(32).toString('hex');

  const configPath = options.configPath || path.join(__dirname, '..', 'config', 'terminaldeck.json');
  const port = options.port ?? parseInt(process.env.TERMINALDECK_PORT || '3000', 10);

  const configManager = new ConfigManager(configPath);
  const config = configManager.load();

  // Allow overriding tmux socket/prefix/instancesPath (used by tests for isolation)
  if (options.tmuxSocket) config.tmuxSocket = options.tmuxSocket;
  if (options.sessionPrefix) config.sessionPrefix = options.sessionPrefix;
  if (options.instancesPath) config.instancesPath = options.instancesPath;

  const historyFilePath = getHistoryFilePath(config.settings.shell);
  const historyRoute = createHistoryRoute(historyFilePath);

  const sessionManager = new SessionManager(config);
  await sessionManager.discoverSessions();

  // Per-instance folder managers, lazy-created on first access
  const folderManagers = new Map();
  const defaultFoldersPath = options.foldersPath || path.join(__dirname, '..', 'config', 'folders.json');

  function getFolderManager(instanceId) {
    const id = instanceId || DEFAULT_INSTANCE;
    if (!folderManagers.has(id)) {
      const foldersPath = id === DEFAULT_INSTANCE
        ? defaultFoldersPath
        : path.join(__dirname, '..', 'config', `folders-${id}.json`);
      const fm = new FolderManager(foldersPath);
      fm.load();
      folderManagers.set(id, fm);
    }
    return folderManagers.get(id);
  }

  // Pre-load the default instance folder manager
  getFolderManager(DEFAULT_INSTANCE);

  const fileManager = new FileManager(configManager);

  const fileOps = createFileOps(options.fileOpsRoot || '/workspace');

  const server = http.createServer((req, res) => {
    // API routes
    if (req.url === '/api/config' && req.method === 'GET') {
      setSecurityHeaders(res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...configManager.getConfig(), serverToken, claudeRoot: path.join(os.homedir(), '.claude'), opencodeRoot: OPENCODE_ROOT }));
      return;
    }

    if (req.url.startsWith('/api/folders') && req.method === 'GET') {
      const foldersUrl = new URL(req.url, 'http://localhost');
      const instanceId = foldersUrl.searchParams.get('instance') || DEFAULT_INSTANCE;
      const fm = getFolderManager(instanceId);
      setSecurityHeaders(res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        folders: fm.getFolders(),
        sessionFolders: fm.getSessionFolders()
      }));
      return;
    }

    if (req.url.startsWith('/api/sessions') && req.method === 'GET') {
      const sessionsUrl = new URL(req.url, 'http://localhost');
      const instanceId = sessionsUrl.searchParams.get('instance') || DEFAULT_INSTANCE;
      (async () => {
        const sessions = await sessionManager.listSessions(instanceId);
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

    if (req.method === 'GET' && req.url.startsWith('/api/claude-files')) {
      const url = new URL(req.url, 'http://localhost');
      const dirPath = url.searchParams.get('path') || '.';
      (async () => {
        const entries = await listClaudeDirectory(dirPath);
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

    if (req.method === 'GET' && req.url.startsWith('/api/opencode-files')) {
      const url = new URL(req.url, 'http://localhost');
      const dirPath = url.searchParams.get('path') || '.';
      (async () => {
        const entries = await listOpencodeDirectory(dirPath);
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

    // --- File editor API routes ---
    // Used by EditorPanel to open, read, save, and close workspace files.
    // Kept at /api/notes for client compatibility; files are edited in place.

    if (req.url === '/api/notes' && req.method === 'GET') {
      setSecurityHeaders(res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fileManager.listFiles()));
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
        if (!data.filePath || typeof data.filePath !== 'string') {
          setSecurityHeaders(res);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'filePath is required' }));
          return;
        }
        var file = fileManager.openFile(data.filePath);
        if (!file) {
          setSecurityHeaders(res);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid file path' }));
          return;
        }
        setSecurityHeaders(res);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(file));
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
    var fileMatch = req.url.match(/^\/api\/notes\/([a-zA-Z0-9_-]+)(\?.*)?$/);
    if (fileMatch) {
      var fileId = fileMatch[1];

      if (req.method === 'GET') {
        var file = fileManager.getFile(fileId);
        setSecurityHeaders(res);
        if (!file) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(file));
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
          var result = fileManager.saveFile(fileId, data.content);
          setSecurityHeaders(res);
          if (!result) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
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
        var closeResult = fileManager.closeFile(fileId);
        setSecurityHeaders(res);
        if (!closeResult) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(closeResult));
        }
        return;
      }
    }

    // Listdeck proxy — forwards /api/listdeck/* to the configured Listdeck server
    if (req.url.startsWith('/api/listdeck/')) {
      const ldConfig = configManager.getConfig().listdeck || {};
      const ldBase = (ldConfig.url || 'http://localhost:5000').replace(/\/$/, '');
      const subPath = req.url.slice('/api/listdeck'.length); // e.g. /daily/2026-03-12
      const targetUrl = ldBase + '/api/v1' + subPath;
      log.log('[listdeck proxy]', req.method, targetUrl);

      readBody(req).then(function (body) {
        let parsedTarget;
        try { parsedTarget = new URL(targetUrl); } catch (e) {
          setSecurityHeaders(res);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid Listdeck URL' }));
          return;
        }

        const proxyOpts = {
          hostname: parsedTarget.hostname,
          port: parsedTarget.port || 80,
          path: parsedTarget.pathname + parsedTarget.search,
          method: req.method,
          headers: { 'Content-Type': 'application/json' }
        };

        const proxyReq = http.request(proxyOpts, function (proxyRes) {
          var chunks = [];
          proxyRes.on('data', function (c) { chunks.push(c); });
          proxyRes.on('end', function () {
            setSecurityHeaders(res);
            res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
            res.end(Buffer.concat(chunks));
          });
        });

        proxyReq.on('error', function () {
          if (!res.headersSent) {
            setSecurityHeaders(res);
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Listdeck unreachable' }));
          }
        });

        if (body && (req.method === 'POST' || req.method === 'PATCH')) {
          proxyReq.write(body);
        }
        proxyReq.end();
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/fileops/create') {
      readBody(req).then(async function (body) {
        var data;
        try { data = JSON.parse(body); } catch (e) {
          setSecurityHeaders(res); res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' })); return;
        }
        if (!data.parent || !data.name || !data.type) {
          setSecurityHeaders(res); res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'parent, name, type required' })); return;
        }
        try {
          var entry;
          if (data.type === 'file') {
            entry = await fileOps.createFile(data.parent, data.name);
          } else if (data.type === 'dir') {
            entry = await fileOps.createDirectory(data.parent, data.name);
          } else {
            setSecurityHeaders(res); res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'type must be file or dir' })); return;
          }
          setSecurityHeaders(res); res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(entry));
        } catch (err) {
          setSecurityHeaders(res);
          if (err.code === 'TRAVERSAL') { res.writeHead(403); res.end(JSON.stringify({ error: 'Forbidden' })); }
          else if (err.code === 'INVALID_NAME') { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid name' })); }
          else if (err.code === 'EEXIST') { res.writeHead(409); res.end(JSON.stringify({ error: 'Already exists' })); }
          else { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
        }
      }).catch(function (err) { if (!res.headersSent) { setSecurityHeaders(res); res.writeHead(500); res.end(JSON.stringify({ error: err.message })); } });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/fileops/rename') {
      readBody(req).then(async function (body) {
        var data;
        try { data = JSON.parse(body); } catch (e) {
          setSecurityHeaders(res); res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' })); return;
        }
        if (!data.path || !data.newName) {
          setSecurityHeaders(res); res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'path and newName required' })); return;
        }
        try {
          var entry = await fileOps.rename(data.path, data.newName);
          setSecurityHeaders(res); res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(entry));
        } catch (err) {
          setSecurityHeaders(res);
          if (err.code === 'TRAVERSAL') { res.writeHead(403); res.end(JSON.stringify({ error: 'Forbidden' })); }
          else if (err.code === 'INVALID_NAME') { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid name' })); }
          else if (err.code === 'ENOENT') { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); }
          else { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
        }
      }).catch(function (err) { if (!res.headersSent) { setSecurityHeaders(res); res.writeHead(500); res.end(JSON.stringify({ error: err.message })); } });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/fileops/delete') {
      readBody(req).then(async function (body) {
        var data;
        try { data = JSON.parse(body); } catch (e) {
          setSecurityHeaders(res); res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' })); return;
        }
        if (!data.path) {
          setSecurityHeaders(res); res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'path required' })); return;
        }
        try {
          var result = await fileOps.remove(data.path);
          setSecurityHeaders(res); res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          setSecurityHeaders(res);
          if (err.code === 'TRAVERSAL') { res.writeHead(403); res.end(JSON.stringify({ error: 'Forbidden' })); }
          else if (err.code === 'ENOENT') { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); }
          else { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
        }
      }).catch(function (err) { if (!res.headersSent) { setSecurityHeaders(res); res.writeHead(500); res.end(JSON.stringify({ error: err.message })); } });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/fileops/copy') {
      readBody(req).then(async function (body) {
        var data;
        try { data = JSON.parse(body); } catch (e) {
          setSecurityHeaders(res); res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' })); return;
        }
        if (!data.src || !data.destDir) {
          setSecurityHeaders(res); res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'src and destDir required' })); return;
        }
        try {
          var entry = await fileOps.copy(data.src, data.destDir);
          setSecurityHeaders(res); res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(entry));
        } catch (err) {
          setSecurityHeaders(res);
          if (err.code === 'TRAVERSAL') { res.writeHead(403); res.end(JSON.stringify({ error: 'Forbidden' })); }
          else if (err.code === 'ENOENT') { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); }
          else { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
        }
      }).catch(function (err) { if (!res.headersSent) { setSecurityHeaders(res); res.writeHead(500); res.end(JSON.stringify({ error: err.message })); } });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/fileops/move') {
      readBody(req).then(async function (body) {
        var data;
        try { data = JSON.parse(body); } catch (e) {
          setSecurityHeaders(res); res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' })); return;
        }
        if (!data.src || !data.destDir) {
          setSecurityHeaders(res); res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'src and destDir required' })); return;
        }
        try {
          var entry = await fileOps.move(data.src, data.destDir);
          setSecurityHeaders(res); res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(entry));
        } catch (err) {
          setSecurityHeaders(res);
          if (err.code === 'TRAVERSAL') { res.writeHead(403); res.end(JSON.stringify({ error: 'Forbidden' })); }
          else if (err.code === 'ENOENT') { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); }
          else { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
        }
      }).catch(function (err) { if (!res.headersSent) { setSecurityHeaders(res); res.writeHead(500); res.end(JSON.stringify({ error: err.message })); } });
      return;
    }

    // Static files
    serveStatic(req, res);
  });

  const wsServer = new TerminalWSServer(server, sessionManager, { serverToken, configManager, getFolderManager });
  wsServer.startActivityBroadcasting();

  // Connect to Listdeck SSE stream and relay daily task events to control clients
  const ldConfig = configManager.getConfig().listdeck || {};
  const ldBase = (ldConfig.url || '').replace(/\/$/, '');
  if (ldBase) {
    _connectListdeckSSE(ldBase, wsServer);
  }

  sessionManager.on('sessionDied', (sessionId, sessionName, instanceId) => {
    wsServer._broadcastSessions(instanceId || DEFAULT_INSTANCE);
  });
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
    fileManager,
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
