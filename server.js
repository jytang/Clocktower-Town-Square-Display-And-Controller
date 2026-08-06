const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT === undefined ? 8000 : Number(process.env.PORT);
const ROOT = __dirname;
const ASSETS_ROOT = path.join(ROOT, 'assets');
const CONTROLLER_KEY = process.env.CONTROLLER_KEY || '';
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const LONG_POLL_TIMEOUT_MS = 15_000;

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

let state = freshGameState();
let revision = 0;
const stateWaiters = new Set();

function freshGameState() {
  return {
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
}

function send(res, statusCode, body, contentType, headers = {}) {
  res.writeHead(statusCode, { 'Content-Type': contentType, ...headers });
  res.end(body);
}

function sendJson(res, statusCode, value) {
  send(res, statusCode, JSON.stringify(value), 'application/json; charset=utf-8', {
    'Cache-Control': 'no-store',
  });
}

function currentState() {
  return { ...state, revision };
}

function sendCurrentState(res) {
  sendJson(res, 200, currentState());
}

function finishWaiter(waiter) {
  if (!stateWaiters.delete(waiter)) return;
  clearTimeout(waiter.timeout);
  sendCurrentState(waiter.res);
}

function publishState() {
  revision += 1;
  for (const waiter of [...stateWaiters]) finishWaiter(waiter);
}

function waitForState(res) {
  const waiter = { res, timeout: null };
  waiter.timeout = setTimeout(() => finishWaiter(waiter), LONG_POLL_TIMEOUT_MS);
  stateWaiters.add(waiter);
  res.on('close', () => {
    if (stateWaiters.delete(waiter)) clearTimeout(waiter.timeout);
  });
}

function readJson(req, res, callback) {
  let body = '';
  let bytes = 0;
  let tooLarge = false;

  req.setEncoding('utf8');
  req.on('data', chunk => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_JSON_BYTES) {
      tooLarge = true;
      return;
    }
    body += chunk;
  });
  req.on('end', () => {
    if (tooLarge) {
      sendJson(res, 413, { error: 'Request body too large' });
      return;
    }
    try {
      const data = JSON.parse(body || '{}');
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid payload');
      callback(data);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON payload' });
    }
  });
  req.on('error', () => sendJson(res, 400, { error: 'Unable to read request' }));
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
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

function keysMatch(providedKey) {
  if (!CONTROLLER_KEY) return true;
  const expected = Buffer.from(CONTROLLER_KEY);
  const provided = Buffer.from(providedKey || '');
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

function handleJoinRequest(joinRequest) {
  const name = typeof joinRequest.name === 'string' ? joinRequest.name.trim() : '';
  if (!name || !joinRequest.id) return false;

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
  publishState();
  return true;
}

const controllerFields = [
  'players',
  'phase',
  'phaseNumber',
  'onBlockPlayer',
  'onBlockVotes',
  'nominatedPlayer',
  'nominatorPlayer',
  'audioCmd',
  'timerCmd',
  'galleryCmd',
  'gameResult',
];

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
  let requestUrl;
  let pathname;
  try {
    requestUrl = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    send(res, 400, 'Bad request', 'text/plain; charset=utf-8');
    return;
  }
  if (req.method === 'GET' && pathname === '/api/state') {
    const since = Number(requestUrl.searchParams.get('since'));
    if (requestUrl.searchParams.has('since') && Number.isInteger(since) && since === revision) waitForState(res);
    else sendCurrentState(res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/join') {
    readJson(req, res, data => {
      if (!handleJoinRequest(data)) {
        sendJson(res, 400, { error: 'Player id and name are required' });
        return;
      }
      sendJson(res, 200, { ok: true, revision });
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/display') {
    readJson(req, res, data => {
      if (!Object.hasOwn(data, 'nowPlaying')) {
        sendJson(res, 400, { error: 'nowPlaying is required' });
        return;
      }
      state.nowPlaying = data.nowPlaying || null;
      publishState();
      sendJson(res, 200, { ok: true, revision });
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/controller') {
    if (!keysMatch(req.headers['x-controller-key'])) {
      sendJson(res, 401, { error: 'Controller key required' });
      return;
    }
    readJson(req, res, data => {
      if (data.newGame) {
        state = freshGameState();
      } else {
        for (const field of controllerFields) {
          if (Object.hasOwn(data, field)) state[field] = data[field];
        }
      }
      publishState();
      sendJson(res, 200, { ok: true, revision });
    });
    return;
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' });
    return;
  }

  if (pathname === '/healthz') {
    sendJson(res, 200, { status: 'ok' });
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
      sendJson(res, 200, sounds);
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

server.listen(PORT, HOST, () => {
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : PORT;
  console.log(`Clocktower server listening on http://${HOST}:${listeningPort}`);
  if (CONTROLLER_KEY) console.log('Controller access-key protection is enabled');
});

function shutdown() {
  for (const waiter of [...stateWaiters]) {
    stateWaiters.delete(waiter);
    clearTimeout(waiter.timeout);
    sendJson(waiter.res, 503, { error: 'Server shutting down' });
  }
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
