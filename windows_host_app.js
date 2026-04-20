const { exec } = require('child_process');
const WebSocket = require('ws');
const keySender = require('node-key-sender');
const fs = require('fs');
const path = require('path');

// -----------------------------
// CONFIG
// -----------------------------
const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3000';
const ROOM_CODE = (process.env.ROOM_CODE || 'ROOM1').trim().toUpperCase();
const HOST_NAME = process.env.HOST_NAME || 'Windows Host';

const HEARTBEAT_MS = 5000;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 10000;

let socket = null;
let shouldReconnect = true;
let reconnectTimer = null;
let reconnectAttempts = 0;
let currentSlide = 1;

// -----------------------------
// EXPORT SLIDES
// -----------------------------
function exportSlides(slideNumber) {
  console.log("EXPORT TRIGGERED:", slideNumber);

  exec(
    `powershell -ExecutionPolicy Bypass -File "C:\\presentation-host\\export.ps1" -slideIndex ${slideNumber}`,
    (err, stdout, stderr) => {
      console.log("STDOUT:", stdout);
      console.log("STDERR:", stderr);

      if (err) {
        console.log("EXPORT ERROR:", err.message);
      }
    }
  );
}

// -----------------------------
// UPLOAD SLIDES
// -----------------------------
async function uploadSlides(slideNumber) {
  const slidesDir = "C:\\presentation-host\\public\\slides";

  const targets = [
    `Slide${slideNumber}.PNG`,
    `Slide${slideNumber + 1}.PNG`
  ];

  for (const file of targets) {
    const filePath = path.join(slidesDir, file);

    if (!fs.existsSync(filePath)) continue;

    const fileBuffer = fs.readFileSync(filePath);

    try {
      await fetch("https://remote.mvapphub.com/upload-slide", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "File-Name": file
        },
        body: fileBuffer
      });

      console.log(`Uploaded: ${file}`);
    } catch (err) {
      console.log("Upload failed:", file, err.message);
    }
  }

  console.log("Slides upload complete");
}

// -----------------------------
// KEY PRESS
// -----------------------------
function pressKey(keyName) {
  return keySender.sendKey(keyName).catch((err) => {
    console.error(`Failed to press ${keyName}:`, err.message);
  });
}

// -----------------------------
// PING
// -----------------------------
function sendPing() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'ping', source: 'host' }));
  }
}

// -----------------------------
// RECONNECT
// -----------------------------
function scheduleReconnect() {
  if (!shouldReconnect) return;

  if (reconnectTimer) clearTimeout(reconnectTimer);

  const delay = Math.min(
    RECONNECT_BASE_MS * Math.max(1, reconnectAttempts + 1),
    RECONNECT_MAX_MS
  );

  reconnectAttempts += 1;
  console.log(`Reconnecting in ${Math.round(delay / 1000)} seconds...`);

  reconnectTimer = setTimeout(connect, delay);
}

// -----------------------------
// CONNECT
// -----------------------------
function connect() {
  console.log(`Connecting to: ${SERVER_URL}`);

  socket = new WebSocket(SERVER_URL);

  socket.on('open', () => {
    reconnectAttempts = 0;
    console.log('Connected to server.');

    socket.send(JSON.stringify({
      type: 'join',
      room: ROOM_CODE,
      username: HOST_NAME,
      role: 'host'
    }));

    console.log(`Joined room ${ROOM_CODE}`);
  });

  socket.on('message', async (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());

      if (data.type !== 'slide') return;

      const action = String(data.action || '').toLowerCase();
      const sender = String(data.username || 'someone');

      if (action === 'next') {
        console.log(`${sender} → NEXT`);
        await pressKey('right');

        currentSlide += 1;

    setInterval(() => {
        exportSlides(currentSlide);
        uploadSlides(currentSlide);
      }, 1000); // every 1 second

        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'slideState',
            slideNumber: currentSlide
          }));
        }
      }

      if (action === 'previous') {
        console.log(`${sender} → PREVIOUS`);
        await pressKey('left');

        currentSlide = Math.max(1, currentSlide - 1);
          setInterval(() => {
            exportSlides(currentSlide);
            uploadSlides(currentSlide);
          }, 1000); // every 1 second

        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'slideState',
            slideNumber: currentSlide
          }));
        }
      }

    } catch (err) {
      console.error('Bad message:', err.message);
    }
  });

  socket.on('close', () => {
    console.log('Disconnected');
    if (shouldReconnect) scheduleReconnect();
  });

  socket.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });
}

// -----------------------------
// HEARTBEAT
// -----------------------------
setInterval(sendPing, HEARTBEAT_MS);

// -----------------------------
// SHUTDOWN
// -----------------------------
process.on('SIGINT', () => {
  shouldReconnect = false;

  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (socket) socket.close();

  console.log('\nHost app stopped.');
  process.exit(0);
});

// -----------------------------
// START
// -----------------------------
connect();