const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const publicDir = path.join(__dirname, 'public');

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.ico') return 'image/x-icon';

  return 'application/octet-stream';
}

const server = http.createServer((req, res) => {

  // -----------------------------
  // CLEAR SLIDES
  // -----------------------------
  if (req.method === 'POST' && req.url === '/clear-slides') {
    const slidesDir = path.join(process.cwd(), 'public', 'slides');

    if (fs.existsSync(slidesDir)) {
      const files = fs.readdirSync(slidesDir);

      for (const file of files) {
        if (file.toLowerCase().endsWith('.png')) {
          fs.unlinkSync(path.join(slidesDir, file));
        }
      }
    }

    console.log("Server slides cleared");

    res.writeHead(200);
    res.end("Cleared");
    return;
  }

  // -----------------------------
  // UPLOAD SLIDE
  // -----------------------------
  if (req.method === 'POST' && req.url === '/upload-slide') {
    const fileName = req.headers['file-name'];

    if (!fileName) {
      res.writeHead(400);
      return res.end('Missing file name');
    }

    const slidesDir = path.join(process.cwd(), 'public', 'slides');

    if (!fs.existsSync(slidesDir)) {
      fs.mkdirSync(slidesDir, { recursive: true });
    }

    const filePath = path.join(slidesDir, fileName);
    const writeStream = fs.createWriteStream(filePath);

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      console.log('Saved:', fileName);
      res.writeHead(200);
      res.end('OK');
    });

    writeStream.on('error', (err) => {
      console.error('Write error:', err);
      res.writeHead(500);
      res.end('Error saving file');
    });

    return;
  }

  // -----------------------------
// SERVE SLIDES DIRECTORY
// -----------------------------
if (req.method === 'GET' && req.url.startsWith('/slides/')) {
  const slidesPath = path.join(process.cwd(), 'public', req.url);

  if (fs.existsSync(slidesPath)) {
    const stream = fs.createReadStream(slidesPath);

    res.writeHead(200, { 'Content-Type': 'image/png' });
    stream.pipe(res);
  } else {
    res.writeHead(404);
    res.end('Slide not found');
  }

  return;
}

  // -----------------------------
  // STATIC FILE SERVING
  // -----------------------------
  let requestPath = req.url.split('?')[0];

  if (requestPath === '/') {
    requestPath = '/index.html';
  }

  const filePath = path.normalize(path.join(publicDir, requestPath));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': getContentType(filePath) });
    res.end(content);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

const wss = new WebSocket.Server({ server });

// roomCode -> Set of sockets
const rooms = new Map();

// socket -> { room, username }
const clientInfo = new Map();

const roomSlides = new Map();

function getRoomUsers(room) {
  const clients = rooms.get(room);
  if (!clients) return [];

  const users = [];
  for (const client of clients) {
    const info = clientInfo.get(client);
    if (info && info.username) users.push(info.username);
  }
  return users;
}

function broadcastToRoom(room, message) {
  const clients = rooms.get(room);
  if (!clients) return;

  const payload =
    typeof message === 'string' ? message : JSON.stringify(message);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function broadcastRoomState(room) {
  broadcastToRoom(room, {
    type: 'roomState',
    users: getRoomUsers(room),
  });
}

function removeClient(ws) {
  const info = clientInfo.get(ws);
  if (!info) return;

  const { room } = info;
  const clients = rooms.get(room);

  if (clients) {
    clients.delete(ws);
    if (clients.size === 0) {
      rooms.delete(room);
    } else {
      broadcastRoomState(room);
    }
  }

  clientInfo.delete(ws);
}

function heartbeat() {
  this.isAlive = true;
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  ws.on('message', (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());

      if (data.type === 'ping') {
        return;
      }

      if (data.type === 'join') {
        const room = String(data.room || '').trim().toUpperCase();
        const username =
          String(data.username || 'Anonymous').trim() || 'Anonymous';

        if (!room) return;

        const previousInfo = clientInfo.get(ws);
        if (
          previousInfo &&
          previousInfo.room &&
          rooms.has(previousInfo.room)
        ) {
          rooms.get(previousInfo.room).delete(ws);
          if (rooms.get(previousInfo.room).size === 0) {
            rooms.delete(previousInfo.room);
          } else {
            broadcastRoomState(previousInfo.room);
          }
        }

        clientInfo.set(ws, { room, username });

        if (!rooms.has(room)) {
          rooms.set(room, new Set());
        }

        // ADD THIS
        if (!roomSlides.has(room)) {
          roomSlides.set(room, 1);
        }

        rooms.get(room).add(ws);

        clientInfo.set(ws, { room, username });

        // SEND CURRENT SLIDE TO NEW CLIENT
        ws.send(JSON.stringify({
          type: 'slideState',
          slideNumber: roomSlides.get(room),
          username
        }));

        console.log(`${username} joined room ${room}`);
        broadcastRoomState(room);
        return;
      }

      if (data.type === 'slide') {
        const info = clientInfo.get(ws);
        if (!info) return;

        const { room, username } = info;
        const action = String(data.action || '').toLowerCase();

        const clients = rooms.get(room);
        if (!clients) return;

        let currentSlide = roomSlides.get(room) || 1;

        if (action === 'next') {
          currentSlide += 1;
        }

        if (action === 'previous') {
          currentSlide = Math.max(1, currentSlide - 1);
        }

        roomSlides.set(room, currentSlide);

        broadcastToRoom(room, {
          type: 'slideState',
          slideNumber: currentSlide,
          username,
        });

        broadcastToRoom(room, {
          type: 'slide',
          action,
          username,
        });

        console.log(`${username} clicked ${action} in room ${room}`);
        return;
      }
      if (data.type === 'slideState') {
        const info = clientInfo.get(ws);
        if (!info) return;

        const { room, username } = info;
        const slideNumber = Number(data.slideNumber || 1);

        broadcastToRoom(room, {
          type: 'slideState',
          slideNumber,
          username,
        });

        console.log(
          `${username} updated slide to ${slideNumber} in room ${room}`
        );
      }
    } catch (err) {
      console.error('Bad message:', err.message);
    }
  });

  ws.on('close', (code, reason) => {
    const info = clientInfo.get(ws);
    const who = info?.username || 'unknown';
    const room = info?.room || 'unknown';
    const reasonText = reason ? reason.toString() : '';

    console.log(
      `Socket closed for ${who} in room ${room}. code=${code}${reasonText ? ` reason=${reasonText}` : ''
      }`
    );
    removeClient(ws);
  });
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }

    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

console.log('Server Running on Port 3000');

