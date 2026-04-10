const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'public', 'index.html');

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
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

const WebSocket = require('ws');

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

function broadcastRoomState(room) {
  const clients = rooms.get(room);
  if (!clients) return;

  const payload = JSON.stringify({
    type: 'roomState',
    users: getRoomUsers(room),
  });

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
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

wss.on('connection', (ws) => {
  ws.on('message', (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());

      if (data.type === 'join') {
        const room = String(data.room || '').trim().toUpperCase();
        const username = String(data.username || 'Anonymous').trim() || 'Anonymous';

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

        clientInfo.set(ws, { room, username });

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

        const payload = JSON.stringify({
          type: 'slide',
          action,
          username,
        });

        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
          }
        }

        console.log(`${username} clicked ${action} in room ${room}`);
      }
if (data.type === 'slideState') {
  const info = clientInfo.get(ws);
  if (!info) return;

  const { room, username } = info;
  const slideNumber = Number(data.slideNumber || 1);

  broadcastToRoom(room, {
    type: 'slideState',
    slideNumber,
    username
  });

  console.log(`${username} updated slide to ${slideNumber} in room ${room}`);
}

    } catch (err) {
      console.error('Bad message:', err.message);
    }
  });

  ws.on('close', () => {
    removeClient(ws);
  });
});

console.log('Server Running on Port 3000');