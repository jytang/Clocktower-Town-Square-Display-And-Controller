#!/bin/bash

set -e

echo "=== Blood on the Clocktower Storyteller Setup ==="

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required: https://nodejs.org/"
  exit 1
fi

echo "Installing dependencies..."
npm install

APP_PORT="${PORT:-8000}"
export PORT="$APP_PORT"

LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || true)
if [ -z "$LOCAL_IP" ]; then
  LOCAL_IP=$(ipconfig getifaddr en1 2>/dev/null || true)
fi
LOCAL_IP="${LOCAL_IP:-localhost}"

echo "Starting the web server..."
node server.js &
SERVER_PID=$!

shutdown_server() {
  echo ""
  echo "Shutting down..."
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}

trap shutdown_server EXIT INT TERM

echo ""
echo "TV Display:  http://$LOCAL_IP:$APP_PORT/display"
echo "Controller:  http://$LOCAL_IP:$APP_PORT/controller"
echo "Player Lobby: http://$LOCAL_IP:$APP_PORT/lobby"
echo "Keep this terminal open while playing. Press Ctrl+C to stop."

wait "$SERVER_PID"
