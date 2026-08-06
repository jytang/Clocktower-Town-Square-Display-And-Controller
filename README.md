# Blood on the Clocktower - Digital Storyteller System

A digital town-square display and controller for running Blood on the Clocktower games across multiple devices. The Node.js service hosts all three browser interfaces and keeps them synchronized with HTTP long-polling.

## Interfaces

- `/display` — shared TV or projector display
- `/controller` — storyteller controls
- `/lobby` — player self-registration page

## Run locally

Requires Node.js 20 or newer.

```bash
./setup.sh
```

The server listens on port `8000` by default. The setup script prints URLs using the computer's local IP so phones and TVs on the same network can connect. You can also start it directly:

```bash
npm install
npm start
```

Set `PORT` to use a different port.

## Deploy to Render

The included `render.yaml` deploys the project as one free Render Web Service with managed HTTPS. It uses ordinary HTTP requests rather than persistent WebSocket connections.

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. In the Render dashboard, select **New > Blueprint**.
3. Connect the repository and select the branch containing `render.yaml`.
4. Review the `botc-display` service and apply the Blueprint.
5. When deployment finishes, reveal the generated `CONTROLLER_KEY` value on the service's **Environment** page.
6. Open the assigned `onrender.com` URL. The controller asks for the key the first time you use it in each browser session.

The public links will be:

- `https://YOUR-SERVICE.onrender.com/display`
- `https://YOUR-SERVICE.onrender.com/controller`
- `https://YOUR-SERVICE.onrender.com/lobby`

On Render, the server pings its own `/healthz` endpoint every 10 minutes to prevent the free instance's 15-minute idle shutdown. Render can still restart free instances for deployments or maintenance. Game state is stored in memory, so a restart or redeploy starts a fresh game.

Only share the lobby and display links publicly. The controller page is protected by the generated storyteller key; keep that key private.

## Features

- Real-time player and phase synchronization
- Player self-registration with avatars and pronouns
- Alive, dead, traveler, and ghost-vote states
- Nomination and execution displays
- Day/night themes, music, and sound effects
- Responsive layouts for phones and large displays

## Tests

```bash
npm test
```

The Playwright suite covers display rendering and game-state presentation across supported player counts.
