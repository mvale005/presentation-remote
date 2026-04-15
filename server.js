const publicDir = path.join(__dirname, 'public');

const filePath = path.join(publicDir, req.url === '/' ? 'index.html' : req.url);

fs.readFile(filePath, (err, content) => {
  if (!err) {
    const ext = path.extname(filePath);
    const type = ext === '.png' ? 'image/png' : 'text/html';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
    return;
  }
});
const server = http.createServer((req, res) => {
  const filePath = path.join(publicDir, 'index.html');

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error loading page');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
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
  ws.on('error', (err) => {
  console.log('WebSocket error:', err.message);
});

ws.on('close', (code, reason) => {
  const reasonText = reason ? reason.toString() : '';
  console.log(`Socket closed. code=${code}${reasonText ? ` reason=${reasonText}` : ''}`);
});
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
        const username = String(data.username || 'Anonymous').trim() || 'Anonymous';
        const role = String(data.role || 'viewer').trim().toLowerCase();

        if (!room) return;

        const previousInfo = clientInfo.get(ws);
        if (previousInfo && previousInfo.room && rooms.has(previousInfo.room)) {
          rooms.get(previousInfo.room).delete(ws);
          if (rooms.get(previousInfo.room).size === 0) {
            rooms.delete(previousInfo.room);
          } else {
            broadcastRoomState(previousInfo.room);
          }
        }

        clientInfo.set(ws, { room, username, role });

        if (!rooms.has(room)) {
          rooms.set(room, new Set());
        }
        rooms.get(room).add(ws);

        console.log(`${username} joined room ${room}`);
        broadcastRoomState(room);
        return;
      }

      if (data.type === 'slide') {
        const info = clientInfo.get(ws);
        if (!info) return;

        const { room, username } = info;
        const action = String(data.action || '');

        const clients = rooms.get(room);
        if (!clients) return;

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

        console.log(`${username} updated slide to ${slideNumber} in room ${room}`);
        return;
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

  console.log(`Socket closed for ${who} in room ${room}. code=${code}${reasonText ? ` reason=${reasonText}` : ''}`);
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
}, 5000);

wss.on('close', () => {
  clearInterval(interval);
});

console.log('Server Running on Port 3000');