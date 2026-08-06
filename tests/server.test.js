const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

function startServer(extraEnv = {}) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '0',
      CONTROLLER_KEY: 'test-secret',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 3000);
    child.stdout.on('data', chunk => {
      const match = chunk.toString().match(/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code) reject(new Error(`Server exited with code ${code}`));
    });
  });

  return { child, ready };
}

function postJson(url, data, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
  });
}

test('serves the app and synchronizes state over HTTP', async t => {
  let keepAliveHits = 0;
  const keepAliveTarget = http.createServer((req, res) => {
    if (req.url === '/healthz') keepAliveHits += 1;
    res.writeHead(200);
    res.end('ok');
  });
  await new Promise(resolve => keepAliveTarget.listen(0, '127.0.0.1', resolve));
  t.after(() => keepAliveTarget.close());
  const keepAlivePort = keepAliveTarget.address().port;

  const { child, ready } = startServer({
    RENDER_EXTERNAL_URL: `http://127.0.0.1:${keepAlivePort}`,
    KEEP_ALIVE_INTERVAL_MS: '25',
  });
  t.after(() => child.kill('SIGTERM'));
  const port = await ready;
  const base = `http://127.0.0.1:${port}`;

  for (let attempt = 0; attempt < 20 && keepAliveHits === 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(keepAliveHits > 0, 'Render keep-alive should ping the external health URL');

  for (const route of ['/', '/display', '/controller', '/lobby', '/healthz']) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200, route);
  }

  const sounds = await fetch(`${base}/api/sounds/night-sounds`);
  assert.equal(sounds.status, 200);
  const soundPaths = await sounds.json();
  assert.ok(soundPaths.length > 0);
  const spacedSound = soundPaths.find(soundPath => soundPath.includes(' '));
  assert.ok(spacedSound);
  assert.equal((await fetch(`${base}/${spacedSound}`)).status, 200);

  const initial = await (await fetch(`${base}/api/state`)).json();
  assert.equal(initial.phase, 'Night');
  assert.equal(initial.revision, 0);

  const denied = await postJson(
    `${base}/api/controller`,
    { phase: 'Day' },
    { 'X-Controller-Key': 'wrong' },
  );
  assert.equal(denied.status, 401);

  const joinWait = fetch(`${base}/api/state?since=${initial.revision}`);
  await new Promise(resolve => setTimeout(resolve, 20));
  const joined = await postJson(`${base}/api/join`, { id: 'alice-1', name: 'Alice' });
  assert.equal(joined.status, 200);
  const joinedState = await (await joinWait).json();
  assert.equal(joinedState.players.length, 1);
  assert.equal(joinedState.players[0].name, 'Alice');

  const updateWait = fetch(`${base}/api/state?since=${joinedState.revision}`);
  await new Promise(resolve => setTimeout(resolve, 20));
  const updated = await postJson(
    `${base}/api/controller`,
    { phase: 'Day', phaseNumber: 2, players: joinedState.players },
    { 'X-Controller-Key': 'test-secret' },
  );
  assert.equal(updated.status, 200);
  const updatedState = await (await updateWait).json();
  assert.equal(updatedState.phase, 'Day');
  assert.equal(updatedState.phaseNumber, 2);
  assert.equal(updatedState.players.length, 1);

  const displayUpdate = await postJson(`${base}/api/display`, { nowPlaying: 'Test Track' });
  assert.equal(displayUpdate.status, 200);
  const finalState = await (await fetch(`${base}/api/state`)).json();
  assert.equal(finalState.nowPlaying, 'Test Track');
});
