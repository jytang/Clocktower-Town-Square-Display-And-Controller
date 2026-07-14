const http = require('http');
const fs = require('fs');
const path = require('path');

const IP = process.argv[2] || 'localhost';
const PORT = 8000;

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Parse URL
  const parsedUrl = new URL(req.url, `http://${IP}:${PORT}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);
  
  console.log(`Request received: ${req.method} ${pathname}`);
  
  // Default to show both links if root is requested
  if (pathname === '/') {
    const displayFile = `display_${IP.replace(/\./g, '_')}.html`;
    const controllerFile = `controller_${IP.replace(/\./g, '_')}.html`;
    const lobbyFile = `lobby_${IP.replace(/\./g, '_')}.html`;
    
    const html = `<!DOCTYPE html>
    <html>
    <head>
        <title>Clocktower Storyteller</title>
        <style>
            body { 
                font-family: Arial, sans-serif; 
                max-width: 800px; 
                margin: 50px auto; 
                text-align: center; 
                background: #1a1a1a;
                color: white;
            }
            .links { 
                display: flex; 
                justify-content: center; 
                gap: 20px; 
                margin-top: 30px;
            }
            a { 
                display: block; 
                padding: 20px 40px; 
                background: #2563eb; 
                color: white; 
                text-decoration: none; 
                border-radius: 8px;
                font-size: 18px;
                font-weight: bold;
                transition: background 0.3s;
            }
            a:hover { 
                background: #1d4ed8; 
            }
            .display { background: #dc2626; }
            .display:hover { background: #b91c1c; }
            .lobby { background: #059669; }
            .lobby:hover { background: #047857; }
            h1 { color: #fbbf24; }
        </style>
    </head>
    <body>
        <h1>Blood on the Clocktower Storyteller</h1>
        <p>Select which interface you want to open:</p>
        <div class="links">
            <a href="/${displayFile}" class="display">TV Display</a>
            <a href="/${controllerFile}">Controller</a>
            <a href="/${lobbyFile}" class="lobby">Player Lobby</a>
        </div>
    </body>
    </html>`;
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }
  
  // API: list sound files in a category so the display can pick one at random
  // e.g. /api/sounds/morning-sounds -> ["morning-sounds/foo.mp3", ...]
  const soundMatch = pathname.match(/^\/api\/sounds\/([a-z0-9-]+-sounds)$/);
  if (soundMatch) {
    const dir = path.join(__dirname, 'assets', soundMatch[1]);
    fs.readdir(dir, (err, files) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      if (err) { res.end('[]'); return; }
      const audio = files
        .filter(f => /\.(mp3|ogg|wav|m4a)$/i.test(f))
        .map(f => `assets/${soundMatch[1]}/${f}`);
      res.end(JSON.stringify(audio));
    });
    return;
  }

  // Construct full file path
  const filePath = path.join(__dirname, pathname);
  console.log(`Looking for file: ${filePath}`);
  
  // Check if file exists and is one of our IP-specific files or favicon
  const displayFile = `display_${IP.replace(/\./g, '_')}.html`;
  const controllerFile = `controller_${IP.replace(/\./g, '_')}.html`;
  const lobbyFile = `lobby_${IP.replace(/\./g, '_')}.html`;

  // Allow audio assets under /assets/morning-sounds and /assets/night-sounds
  const isSoundAsset = /^\/assets\/[a-z0-9-]+-sounds\/[^/]+\.(mp3|ogg|wav|m4a)$/i.test(pathname);

  if (fs.existsSync(filePath) && (pathname.includes(displayFile) || pathname.includes(controllerFile) || pathname.includes(lobbyFile) || pathname === '/favicon.ico' || isSoundAsset)) {
    console.log(`Serving file: ${pathname}`);
    // Get file extension
    const ext = path.parse(filePath).ext;
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    // Read and serve file
    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.error(`Error reading file: ${err}`);
        res.writeHead(500);
        res.end('Error loading file');
        return;
      }
      
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
    });
  } else {
    console.log(`File not found or not allowed: ${pathname}`);
    console.log(`Allowed files: ${displayFile}, ${controllerFile}`);
    // File not found or not allowed
    res.writeHead(404);
    res.end('File not found or access denied');
  }
});

server.listen(PORT, IP, () => {
  console.log(`HTTP server running at http://${IP}:${PORT}`);
  console.log(`Serving only IP-specific files for ${IP}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('HTTP server shutting down...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('HTTP server shutting down...');
  server.close(() => {
    process.exit(0);
  });
});
