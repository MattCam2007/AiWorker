const http = require('http');
const fs = require('fs');
const path = require('path');
const { ConfigManager } = require('./config');
const { SessionManager } = require('./sessions');
const { WebSocketServer: TerminalWSServer } = require('./websocket');

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

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  // Strip query strings
  filePath = filePath.split('?')[0];
  // Prevent directory traversal
  const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(CLIENT_DIR, safePath);

  // Ensure we're still within CLIENT_DIR
  if (!fullPath.startsWith(CLIENT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(fullPath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

async function createApp(options = {}) {
  const configPath = options.configPath || path.join(__dirname, '..', 'config', 'terminaldeck.json');
  const port = options.port ?? parseInt(process.env.TERMINALDECK_PORT || '3000', 10);

  const configManager = new ConfigManager(configPath);
  const config = configManager.load();

  const sessionManager = new SessionManager(config);
  await sessionManager.startAll();

  const server = http.createServer((req, res) => {
    // API routes
    if (req.url === '/api/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(configManager.getConfig()));
      return;
    }

    if (req.url === '/api/sessions' && req.method === 'GET') {
      sessionManager.listSessions().then((sessions) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(sessions));
      });
      return;
    }

    // Static files
    serveStatic(req, res);
  });

  const wsServer = new TerminalWSServer(server, sessionManager);

  // Config hot-reload
  configManager.watch();
  configManager.on('change', async (newConfig) => {
    await sessionManager.handleConfigReload(newConfig);
    wsServer.broadcastConfigReload(newConfig);
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
        server.close(resolve);
      });
    }
  };
}

// If run directly (not required as module)
if (require.main === module) {
  createApp().then((app) => {
    console.log(`TerminalDeck running on http://localhost:${app.port}`);
  }).catch((err) => {
    console.error('Failed to start TerminalDeck:', err);
    process.exit(1);
  });
}

module.exports = { createApp };
