const { exec, execSync } = require('child_process');
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
let exportTimeout = null;
let isExporting = false;
let pendingSlide = null;

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
    console.log("UPLOAD FUNCTION CALLED:", slideNumber);

    const slidesDir = "C:\\presentation-host\\public\\slides";

    const targets = [
        `Slide${slideNumber}.PNG`,
        `Slide${slideNumber + 1}.PNG`
    ];

    for (const file of targets) {
        const filePath = path.join(slidesDir, file);

        let fileBuffer = null;

        // 🔥 Wait until file is actually readable (not locked)
        for (let i = 0; i < 15; i++) {
            try {
                fileBuffer = fs.readFileSync(filePath);
                break; // success
            } catch (err) {
                // file not ready yet → wait
                await new Promise(r => setTimeout(r, 100));
            }
        }

        if (!fileBuffer) {
            console.log("Skipping file (still locked or missing):", file);
            continue;
        }

        try {
            const response = await fetch("https://remote.mvapphub.com/upload-slide", {
                method: "POST",
                headers: {
                    "Content-Type": "application/octet-stream",
                    "File-Name": "current.PNG"
                },
                body: fileBuffer
            });

            console.log("UPLOAD STATUS:", response.status);

            const text = await response.text();
            console.log("UPLOAD RESPONSE:", text);

        } catch (err) {
            console.log("UPLOAD FAILED:", err.message);
        }
    }

    console.log("Slides upload complete");
}
///---------------------
// helper function 
//----------------------
async function waitForServerFile(slideNumber) {
    const url = `https://remote.mvapphub.com/slides/Slide${slideNumber}.PNG`;

    for (let i = 0; i < 10; i++) {
        try {
            const res = await fetch(url, { method: 'HEAD' });

            if (res.status === 200) {
                return true;
            }
        } catch { }

        await new Promise(r => setTimeout(r, 100));
    }

    return false;
}


async function waitForServerFile(slideNumber) {
    const url = `https://remote.mvapphub.com/slides/Slide${slideNumber}.PNG`;

    for (let i = 0; i < 10; i++) {
        try {
            const res = await fetch(url, { method: 'HEAD' });

            if (res.status === 200) {
                return true;
            }
        } catch { }

        await new Promise(r => setTimeout(r, 100));
    }

    return false;
}

// -----------------------------
// KEY PRESS
// -----------------------------


function focusPowerPoint() {
    try {
        execSync(`powershell -Command "(New-Object -ComObject WScript.Shell).AppActivate('PowerPoint')"`);
    } catch (e) {
        console.log("Could not focus PowerPoint");
    }
}

async function pressKey(keyName) {
    focusPowerPoint(); // 👈 bring PowerPoint to front

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
// CLEAR SERVER SLIDES
// -----------------------------
async function clearServerSlides() {
    try {
        await fetch("https://remote.mvapphub.com/clear-slides", {
            method: "POST"
        });
        console.log("Server slides cleared");
    } catch (err) {
        console.log("Failed to clear server slides", err.message);
    }
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
        clearServerSlides();

        socket.send(JSON.stringify({
            type: 'join',
            room: ROOM_CODE,
            username: HOST_NAME,
            role: 'host'
        }));

        console.log(`Joined room ${ROOM_CODE}`);
        console.log("Initial export for slide 1");
        setTimeout(() => {
            console.log("Initial export for slide 1");
            exportSlides(1);
            uploadSlides(1);
        }, 500);
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

                triggerExport(currentSlide);


            }

            if (action === 'previous') {
                console.log(`${sender} → PREVIOUS`);
                await pressKey('left');

                currentSlide = Math.max(1, currentSlide - 1);

                triggerExport(currentSlide);

                socket.send(JSON.stringify({
                    type: 'slideState',
                    slideNumber: currentSlide
                }));
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

async function triggerExport(slideNumber) {
    if (isExporting) {
        pendingSlide = slideNumber;
        return;
    }

    isExporting = true;

    console.log("EXPORT START:", slideNumber);

    // 1. export
    await new Promise(resolve => {
        exec(
            `powershell -ExecutionPolicy Bypass -File "C:\\presentation-host\\export.ps1" -slideIndex ${slideNumber}`,
            () => resolve()
        );
    });

    // 2. upload
    await uploadSlides(slideNumber);

    // 3. VERIFY FILE EXISTS ON SERVER
    const url = `https://remote.mvapphub.com/slides/Slide${slideNumber}.PNG`;

  

    // 4. ONLY NOW notify frontend
  if (socket && socket.readyState === WebSocket.OPEN) {
  socket.send(JSON.stringify({
    type: 'slideState',
    slideNumber: slideNumber
  }));
}

    isExporting = false;

    if (pendingSlide !== null && pendingSlide !== slideNumber) {
        const next = pendingSlide;
        pendingSlide = null;
        triggerExport(next);
    }
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