const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT === undefined ? 8000 : Number(process.env.PORT);
const ROOT = __dirname;
const ASSETS_ROOT = path.join(ROOT, 'assets');
const CONTROLLER_KEY = process.env.CONTROLLER_KEY || '';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
};

const pageRoutes = new Map([
  ['/display', 'display.html'],
  ['/display.html', 'display.html'],
  ['/controller', 'controller.html'],
  ['/controller.html', 'controller.html'],
  ['/lobby', 'lobby.html'],
  ['/lobby.html', 'lobby.html'],
  ['/favicon.ico', 'favicon.ico'],
]);

function send(res, statusCode, body, contentType, headers = {}) {
  res.writeHead(statusCode, { 'Content-Type': contentType, ...headers });
  res.end(body);
}

function sendFile(req, res, filePath, cacheControl = 'no-store') {
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      return;
    }

    const headers = {
      'Cache-Control': cacheControl,
      'Content-Length': stats.size,
    };
    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, ...headers });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        send(res, 500, 'Unable to read file', 'text/plain; charset=utf-8');
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  });
}

const landingPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Clocktower Storyteller</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 760px; margin: 4rem auto; padding: 0 1rem; text-align: center; background: #171717; color: #fff; }
    h1 { color: #fbbf24; }
    nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 1rem; margin-top: 2rem; }
    a { padding: 1rem 1.5rem; border-radius: .5rem; color: #fff; background: #2563eb; font-weight: 700; text-decoration: none; }
    a:first-child { background: #dc2626; }
    a:last-child { background: #059669; }
  </style>
</head>
<body>
  <h1>Blood on the Clocktower Storyteller</h1>
  <p>Choose an interface:</p>
  <nav>
    <a href="/display">TV Display</a>
    <a href="/controller">Controller</a>
    <a href="/lobby">Player Lobby</a>
  </nav>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    send(res, 400, 'Bad request', 'text/plain; charset=utf-8');
    return;
  }

  if (pathname === '/healthz') {
    send(res, 200, JSON.stringify({ status: 'ok' }), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
    return;
  }

  if (pathname === '/') {
    send(res, 200, req.method === 'HEAD' ? '' : landingPage, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
    return;
  }

  const soundMatch = pathname.match(/^\/api\/sounds\/([a-z0-9-]+-sounds)$/);
  if (soundMatch) {
    const soundDirectory = path.join(ASSETS_ROOT, soundMatch[1]);
    fs.readdir(soundDirectory, (error, files = []) => {
      const sounds = error
        ? []
        : files
          .filter(file => /\.(mp3|ogg|wav|m4a)$/i.test(file))
          .map(file => `assets/${soundMatch[1]}/${file}`);
      send(res, 200, req.method === 'HEAD' ? '' : JSON.stringify(sounds), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
    });
    return;
  }

  const pageFile = pageRoutes.get(pathname);
  if (pageFile) {
    sendFile(req, res, path.join(ROOT, pageFile));
    return;
  }

  if (pathname.startsWith('/assets/')) {
    const relativePath = pathname.slice('/assets/'.length);
    const assetPath = path.resolve(ASSETS_ROOT, relativePath);
    if (assetPath.startsWith(`${ASSETS_ROOT}${path.sep}`)) {
      sendFile(req, res, assetPath, 'public, max-age=3600');
      return;
    }
  }

  send(res, 404, 'Not found', 'text/plain; charset=utf-8');
});

const wss = new WebSocket.Server({ server });

// gameId scopes a lobby session: starting a new game lets the same devices join again.
let state = {
  players: [],
  phase: 'Night',
  phaseNumber: 1,
  onBlockPlayer: null,
  onBlockVotes: 0,
  nominatedPlayer: null,
  nominatorPlayer: null,
  nowPlaying: null,
  gameId: Date.now(),
};

function broadcast() {
  const payload = JSON.stringify(state);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function keysMatch(providedKey) {
  if (!CONTROLLER_KEY) return true;
  const expected = Buffer.from(CONTROLLER_KEY);
  const provided = Buffer.from(providedKey || '');
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

function handleJoinRequest(joinRequest) {
  const name = (joinRequest.name || '').trim();
  if (!name || !joinRequest.id) return;

  const existing = state.players.find(player => player.id === joinRequest.id);
  if (existing) {
    existing.name = name;
    if (joinRequest.avatar !== undefined) existing.avatar = joinRequest.avatar || null;
    if (joinRequest.pronouns !== undefined) existing.pronouns = (joinRequest.pronouns || '').trim() || null;
  } else {
    state.players.push({
      id: joinRequest.id,
      name,
      alive: true,
      traveler: false,
      ghostVote: true,
      avatar: joinRequest.avatar || null,
      pronouns: (joinRequest.pronouns || '').trim() || null,
    });
  }
  broadcast();
}

wss.on('connection', (ws, request) => {
  const connectionUrl = new URL(request.url, 'http://localhost');
  const role = connectionUrl.searchParams.get('role') || 'viewer';

  if (role === 'controller' && !keysMatch(connectionUrl.searchParams.get('key'))) {
    ws.close(4001, 'Controller key required');
    return;
  }

  ws.send(JSON.stringify(state));

  ws.on('message', message => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      ws.send(JSON.stringify({ error: 'Invalid JSON message' }));
      return;
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return;
    }

    if (role === 'lobby') {
      if (data.joinRequest && typeof data.joinRequest === 'object') {
        handleJoinRequest(data.joinRequest);
      }
      return;
    }

    if (role === 'display') {
      if (Object.hasOwn(data, 'nowPlaying')) {
        state.nowPlaying = data.nowPlaying;
        broadcast();
      }
      return;
    }

    if (role !== 'controller') {
      return;
    }

    if (data.newGame) {
      state = {
        players: [],
        phase: 'Night',
        phaseNumber: 1,
        onBlockPlayer: null,
        onBlockVotes: 0,
        nominatedPlayer: null,
        nominatorPlayer: null,
        nowPlaying: null,
        gameResult: null,
        gameId: Date.now(),
      };
      broadcast();
      return;
    }

    if (data.joinRequest) {
      handleJoinRequest(data.joinRequest);
      return;
    }

    state = Object.assign(state, data);
    broadcast();
  });
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : PORT;
  console.log(`Clocktower server listening on http://${HOST}:${listeningPort}`);
  if (CONTROLLER_KEY) {
    console.log('Controller access-key protection is enabled');
  }
});

function shutdown() {
  wss.clients.forEach(client => client.close(1001, 'Server shutting down'));
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
