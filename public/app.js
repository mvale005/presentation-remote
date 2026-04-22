// -----------------------------
// Element references
// -----------------------------
const nameInput = document.getElementById('nameInput');
const roomCodeInput = document.getElementById('roomCode');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const reconnectBtn = document.getElementById('reconnectBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const statusBar = document.getElementById('statusBar');
const activityLog = document.getElementById('activityLog');
const userList = document.getElementById('userList');
const lastAction = document.getElementById('lastAction');
const hostStatusBar = document.getElementById('hostStatusBar');
const hostStatusDot = document.getElementById('hostStatusDot');
const hostStatusText = document.getElementById('hostStatusText');
const hostHint = document.getElementById('hostHint');
const viewSlidesBtn = document.getElementById('viewSlidesBtn');
const slideOverlay = document.getElementById('slideOverlay');
const overlaySlide = document.getElementById('overlaySlide');
const closeOverlay = document.getElementById('closeOverlay');
const overlayPrev = document.getElementById('overlayPrev');
const overlayNext = document.getElementById('overlayNext');
const overlayNextSlide = document.getElementById('overlayNextSlide');
const SLIDE_BASE_URL = "https://remote.mvapphub.com/slides";

console.log("overlaySlide:", overlaySlide);
console.log("overlayNextSlide:", overlayNextSlide);

// -----------------------------
// App state
// -----------------------------
let socket = null;
let currentRoom = '';
let currentName = '';
let shouldReconnect = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let lastClickTime = 0;
let overlayVisible = false;

// -----------------------------
// Config
// -----------------------------
const CLICK_DELAY = 700;
const HEARTBEAT_MS = 5000;
const RECONNECT_BASE_DELAY = 1500;
const RECONNECT_MAX_DELAY = 10000;
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

// -----------------------------
// UI helpers
// -----------------------------
function addLog(message) {
    const item = document.createElement('li');
    item.textContent = message;
    activityLog.prepend(item);

    // Keep the feed short and readable
    if (activityLog.children.length > 6) {
        activityLog.removeChild(activityLog.lastElementChild);
    }
}




function renderUsers(users) {
    userList.innerHTML = '';

    if (!users || users.length === 0) {
        const empty = document.createElement('li');
        empty.textContent = 'No one has joined yet.';
        userList.appendChild(empty);
        return;
    }

    users.forEach((user) => {
        const item = document.createElement('li');
        item.textContent = user;
        userList.appendChild(item);
    });
}

function setOverlayVisible(isVisible) {
    overlayVisible = isVisible;

    if (slideOverlay) {
        slideOverlay.style.display = isVisible ? 'flex' : 'none';
        slideOverlay.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    }
}

function setHostPresence(users) {
    const hasHost = Array.isArray(users) && users.includes('Windows Host');

    hostStatusBar.classList.remove('connected', 'warm');
    hostStatusDot.classList.remove('connected');

    if (hasHost) {
        hostStatusBar.classList.add('connected');
        hostStatusDot.classList.add('connected');
        hostStatusText.textContent = 'Host connected';
        prevBtn.disabled = false;
        nextBtn.disabled = false;

        if (hostHint) hostHint.textContent = 'Ready to control slides';
    } else {
        hostStatusBar.classList.add('warm');
        hostStatusText.textContent = 'Host not connected';
        prevBtn.disabled = true;
        nextBtn.disabled = true;

        if (hostHint) hostHint.textContent = 'Waiting for host to connect...';
    }
}

function setConnectedState(isConnected, room = '') {
    statusBar.classList.remove('connected', 'warm');

    if (isConnected) {
        statusBar.classList.add('connected');
        statusDot.classList.add('connected');
    } else {
        statusDot.classList.remove('connected');
        if (room) {
            statusBar.classList.add('warm');
        }
    }

    statusText.textContent = isConnected
        ? `Connected to room ${room} as ${currentName}`
        : (currentRoom ? `Disconnected from room ${currentRoom}` : 'Not connected');

    leaveBtn.disabled = !isConnected && !currentRoom;
    joinBtn.disabled = isConnected;
    reconnectBtn.disabled = isConnected || !currentRoom || !currentName;
    nameInput.disabled = isConnected;
    roomCodeInput.disabled = isConnected;
}

function getName() {
    return nameInput.value.trim() || 'Anonymous';
}

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function scheduleReconnect() {
    if (!shouldReconnect || !currentRoom || !currentName) return;
    if (reconnectTimer) return;

    const delay = Math.min(
        RECONNECT_BASE_DELAY * Math.max(1, reconnectAttempts + 1),
        RECONNECT_MAX_DELAY
    );

    reconnectAttempts += 1;
    addLog(`Reconnecting in ${Math.round(delay / 1000)} seconds...`);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;

        if (document.visibilityState === 'visible') {
            connectSocket();
        } else {
            scheduleReconnect();
        }
    }, delay);
}

// -----------------------------
// WebSocket connection
// -----------------------------
function connectSocket() {
    const room = roomCodeInput.value.trim().toUpperCase() || currentRoom;
    const name = nameInput.value.trim() || currentName || 'Anonymous';

    if (!room) {
        addLog('Enter a room code first.');
        roomCodeInput.focus();
        return;
    }

    currentRoom = room;
    currentName = name;
    shouldReconnect = true;
    clearReconnectTimer();

    // Close any existing socket before opening a new one
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        try {
            socket.close();
        } catch (err) {
            // ignore close errors
        }
    }

    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        reconnectAttempts = 0;
        setConnectedState(true, currentRoom);
        addLog(`Connected to room ${currentRoom} as ${currentName}.`);

        socket.send(JSON.stringify({
            type: 'join',
            room: currentRoom,
            username: currentName
        }));
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            // Slide preview / overlay visuals


            if (data.type === 'slideState') {
                const currentSlide = Number(data.slideNumber) || 1;
                const img = document.getElementById('mainSlideImg');

                if (!img) return;

                const baseUrl = `https://remote.mvapphub.com/slides/Slide${currentSlide}.PNG`;

                console.log("WAITING FOR IMAGE:", baseUrl);

                waitForImage(baseUrl).then(() => {
                    console.log("LOADING IMAGE:", baseUrl);
                    img.src = baseUrl + '?' + Date.now();
                });
            }

            //
            function waitForImage(url, maxAttempts = 20, delay = 150) {
    return new Promise((resolve) => {
        let attempts = 0;

        function check() {
            fetch(url, { method: 'HEAD' })
                .then(res => {
                    if (res.ok) {
                        resolve();
                    } else {
                        retry();
                    }
                })
                .catch(retry);
        }

        function retry() {
            attempts++;
            if (attempts >= maxAttempts) {
                console.log("GIVING UP:", url);
                resolve();
            } else {
                setTimeout(check, delay);
            }
        }

        check();
    });
}


            // Slide preview / overlay visuals (REAL LOOK)


            // Room presence updates
            if (data.type === 'roomState') {
                const users = data.users || [];
                renderUsers(users);
                setHostPresence(users);
            }

            // Log slide actions
            if (data.type === 'slide') {
                const who = data.username ? data.username : 'Someone';
                const actionLabel = String(data.action || '').trim();
                const isMe = who === currentName;

                addLog(`${isMe ? 'You' : who} → ${actionLabel}`);

                if (lastAction) {
                    lastAction.textContent = `Last action: ${isMe ? 'You' : who} → ${actionLabel}`;
                }
            }
        } catch (err) {
            console.warn('Bad message from server:', err);
        }
    };

    socket.onclose = () => {
        socket = null;
        setConnectedState(false, currentRoom);
        addLog('Disconnected.');

        if (shouldReconnect && currentRoom && currentName) {
            scheduleReconnect();
        }
    };

    socket.onerror = () => {
        addLog('Connection error.');
    };
}

// -----------------------------
// Slide controls
// -----------------------------
function sendSlideAction(action) {
    const now = Date.now();

    // Prevent accidental double-click spam
    if (now - lastClickTime < CLICK_DELAY) {
        addLog('Slow down a bit...');
        return;
    }

    lastClickTime = now;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        addLog('Join a room before using slide controls.');
        return;
    }

    socket.send(JSON.stringify({
        type: 'slide',
        action,
        username: currentName
    }));

    // Small button flash for feedback
    const btn = action === 'Next' ? nextBtn : prevBtn;
    if (btn) {
        btn.classList.remove('click-flash');
        void btn.offsetWidth; // force reflow so animation replays
        btn.classList.add('click-flash');
    }
}

// -----------------------------
// Event listeners
// -----------------------------
joinBtn.addEventListener('click', () => {
    const room = roomCodeInput.value.trim().toUpperCase();
    const name = getName();

    if (!room) {
        addLog('Enter a room code first.');
        roomCodeInput.focus();
        return;
    }

    currentRoom = room;
    currentName = name;
    shouldReconnect = true;
    connectSocket();
});

reconnectBtn.addEventListener('click', () => {
    if (!currentRoom) {
        addLog('Join a room first.');
        return;
    }

    shouldReconnect = true;
    connectSocket();
});

leaveBtn.addEventListener('click', () => {
    shouldReconnect = false;
    clearReconnectTimer();

    if (socket) {
        try {
            socket.close();
        } catch (err) {
            // ignore
        }
    }

    socket = null;
    roomCodeInput.value = '';
    currentRoom = '';
    currentName = '';
    setConnectedState(false, '');
    renderUsers([]);
    addLog('Left room.');
});

prevBtn.addEventListener('click', () => sendSlideAction('Previous'));
nextBtn.addEventListener('click', () => sendSlideAction('Next'));

if (viewSlidesBtn) {
    viewSlidesBtn.addEventListener('click', () => {
        setOverlayVisible(!overlayVisible);
    });
}

if (closeOverlay) {
    closeOverlay.addEventListener('click', () => setOverlayVisible(false));
}

if (overlayPrev) {
    overlayPrev.addEventListener('click', () => sendSlideAction('Previous'));
}

if (overlayNext) {
    overlayNext.addEventListener('click', () => sendSlideAction('Next'));
}

roomCodeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') joinBtn.click();
});

nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') joinBtn.click();
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlayVisible) {
        setOverlayVisible(false);
    }
});

// Heartbeat keeps the socket warm
setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping', source: 'client' }));
    }
}, HEARTBEAT_MS);

// Reconnect if the page comes back into focus
function attemptResumeConnection() {
    if (!shouldReconnect || !currentRoom || !currentName) return;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        clearReconnectTimer();
        connectSocket();
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        attemptResumeConnection();
    }
});

window.addEventListener('focus', attemptResumeConnection);
window.addEventListener('pageshow', attemptResumeConnection);

// Initial UI state
setConnectedState(false, '');
setOverlayVisible(false);