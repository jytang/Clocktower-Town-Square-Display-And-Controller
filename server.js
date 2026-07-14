const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

// gameId scopes a lobby session: each phone remembers which gameId it joined,
// so starting a new game (new id) lets everyone re-join from the same devices.
let state = { players: [], phase: 'Night', phaseNumber: 1, onBlockPlayer: null, onBlockVotes: 0, nominatedPlayer: null, nominatorPlayer: null, nowPlaying: null, gameId: Date.now() };

function broadcast() {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(state));
    }
  });
}

wss.on('connection', ws => {
  // Send current state to new client
  ws.send(JSON.stringify(state));

  // Receive updates from controller
  ws.on('message', message => {
    const data = JSON.parse(message);

    // Start a fresh game: clear the roster and mint a new gameId so every phone
    // is freed to join again. The controller sends { newGame: true }.
    if (data.newGame) {
      state.players = [];
      state.phase = 'Night';
      state.phaseNumber = 1;
      state.onBlockPlayer = null;
      state.onBlockVotes = 0;
      state.nominatedPlayer = null;
      state.nominatorPlayer = null;
      state.gameResult = null;
      state.gameId = Date.now();
      broadcast();
      return;
    }

    // A phone in the lobby self-registers via a joinRequest. Handle it as an
    // append/merge against the authoritative player list rather than a blanket
    // state overwrite — several phones may join at once, and the controller's
    // own (possibly stale) players array must not clobber them.
    if (data.joinRequest) {
      const req = data.joinRequest;
      const name = (req.name || '').trim();
      if (name && req.id) {
        // Identity is the client-minted id, not the name — so a player can rename
        // themselves and still update their own existing seat.
        const existing = state.players.find(p => p.id === req.id);
        if (existing) {
          existing.name = name;
          if (req.avatar !== undefined) existing.avatar = req.avatar || null;
          if (req.pronouns !== undefined) existing.pronouns = (req.pronouns || '').trim() || null;
        } else {
          state.players.push({
            id: req.id,
            name,
            alive: true,
            traveler: false,
            ghostVote: true,
            avatar: req.avatar || null,
            pronouns: (req.pronouns || '').trim() || null
          });
        }
      }
      broadcast();
      return;
    }

    // Merge incoming partial state so either client (controller or display) can
    // update its own fields without clobbering the other's.
    state = Object.assign(state, data);
    broadcast();
  });
});

console.log('WebSocket server running on port 8080');