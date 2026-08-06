const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const WebSocket = require('ws');

const projectRoot = path.resolve(__dirname, '..');

function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', CONTROLLER_KEY: 'test-secret' },
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

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function nextState(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket state timed out')), 2000);
    const onMessage = raw => {
      const state = JSON.parse(raw.toString());
      if (predicate(state)) {
        clearTimeout(timeout);
        socket.off('message', onMessage);
        resolve(state);
      }
    };
    socket.on('message', onMessage);
  });
}

test('serves the app and enforces WebSocket roles', async t => {
  const { child, ready } = startServer();
  t.after(() => child.kill('SIGTERM'));
  const port = await ready;
  const httpBase = `http://127.0.0.1:${port}`;
  const wsBase = `ws://127.0.0.1:${port}`;

  for (const route of ['/', '/display', '/controller', '/lobby', '/healthz']) {
    const response = await fetch(`${httpBase}${route}`);
    assert.equal(response.status, 200, route);
  }

  const sounds = await fetch(`${httpBase}/api/sounds/night-sounds`);
  assert.equal(sounds.status, 200);
  assert.ok((await sounds.json()).length > 0);

  const denied = new WebSocket(`${wsBase}?role=controller&key=wrong`);
  const deniedCode = await new Promise((resolve, reject) => {
    denied.once('close', resolve);
    denied.once('error', reject);
  });
  assert.equal(deniedCode, 4001);

  const viewer = await openSocket(wsBase);
  const lobby = await openSocket(`${wsBase}?role=lobby`);
  const controller = await openSocket(`${wsBase}?role=controller&key=test-secret`);
  t.after(() => [viewer, lobby, controller].forEach(socket => socket.close()));

  const joinedState = nextState(viewer, state => state.players?.some(player => player.name === 'Alice'));
  lobby.send(JSON.stringify({ joinRequest: { id: 'alice-1', name: 'Alice' } }));
  assert.equal((await joinedState).players.length, 1);

  viewer.send(JSON.stringify({ phase: 'Day', phaseNumber: 99 }));
  const unchangedViewer = await openSocket(wsBase);
  const unchangedState = await nextState(unchangedViewer);
  unchangedViewer.close();
  assert.equal(unchangedState.phase, 'Night');

  const updatedState = nextState(viewer, state => state.phase === 'Day' && state.phaseNumber === 2);
  controller.send(JSON.stringify({ phase: 'Day', phaseNumber: 2 }));
  assert.equal((await updatedState).players.length, 1);
});
