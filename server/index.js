const http = require('http');
const fs = require('fs');
const path = require('path');
const { ConfigManager } = require('./config');
const { SessionManager } = require('./sessions');
const { TerminalWSServer } = require('./websocket');
const { listDirectory } = require('./filetree');
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

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
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

  const sessionManager = new SessionManager(config);
  await sessionManager.discoverSessions();

  const server = http.createServer((req, res) => {
    // API routes
    if (req.url === '/api/config' && req.method === 'GET') {
      setSecurityHeaders(res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...configManager.getConfig(), serverToken }));
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

    // Static files
    serveStatic(req, res);
  });

  const wsServer = new TerminalWSServer(server, sessionManager, { serverToken, configManager });
  wsServer.startActivityBroadcasting();

  sessionManager.on('sessionDied', () => { wsServer._broadcastSessions(); });
  sessionManager.startHealthCheck();

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
