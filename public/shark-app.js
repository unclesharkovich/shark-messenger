let socket;
let currentUser = null;
let currentRoom = 'shark-tank';
let avatarData = null;

function connectSocket() {
    socket = io();

    socket.on('registered', (data) => {
        currentUser = data.user;
        loadRooms();
        loadStickers();
    });

    socket.on('newMessage', (msg) => {
        if (msg.room === currentRoom) addMessage(msg, false);
    });

    socket.on('newSticker', (msg) => {
        if (msg.room === currentRoom) addSticker(msg, false);
    });

    socket.on('userJoined', (data) => {
        document.getElementById('onlineCount').textContent = data.total;
        document.getElementById('roomOnline').textContent = data.total + ' в сети';
    });

    socket.on('userLeft', (data) => {
        document.getElementById('onlineCount').textContent = data.total;
        document.getElementById('roomOnline').textContent = data.total + ' в сети';
    });

    socket.on('roomSwitched', (data) => {
        currentRoom = data.room;
        document.getElementById('messagesContainer').innerHTML = '';
        data.history.forEach(msg => {
            if (msg.sticker) addSticker(msg, msg.sender === currentUser?.username);
            else addMessage(msg, msg.sender === currentUser?.username);
        });
    });
}

function uploadAvatar(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        avatarData = e.target.result;
        document.getElementById('avatarImg').src = avatarData;
        document.getElementById('avatarImg').style.display = 'block';
        document.getElementById('avatarPlaceholder').style.display = 'none';
    };
    reader.readAsDataURL(file);
}

function register() {
    const username = document.getElementById('usernameInput').value.trim() || 'Дядя Шарк';
    const tag = document.getElementById('tagInput').value.trim();

    document.getElementById('registerPage').style.display = 'none';
    document.getElementById('chatPage').style.display = 'flex';
    document.getElementById('sidebarName').textContent = username;
    document.getElementById('sidebarTag').textContent = tag;
    if (avatarData) document.getElementById('sidebarAvatar').src = avatarData;

    connectSocket();
    socket.emit('register', { username, customTag: tag, avatar: avatarData });
}

function loadRooms() {
    fetch('/api/rooms')
        .then(r => r.json())
        .then(rooms => {
            const list = document.getElementById('roomsList');
            list.innerHTML = rooms.map(r =>
                `<div class="room-item ${r.id === currentRoom ? 'active' : ''}" onclick="switchRoom('${r.id}')">${r.name} (${r.online})</div>`
            ).join('');
        });
}

function switchRoom(roomId) {
    document.getElementById('currentRoom').textContent =
        roomId === 'shark-tank' ? '🦈 Акулья бухта' :
        roomId === 'deep-ocean' ? '🌊 Глубокий океан' : '🐠 Коралловый риф';
    if (socket) socket.emit('switchRoom', roomId);
    loadRooms();
}

function toggleTagEditor() {
    document.getElementById('tagEditor').classList.toggle('hidden');
    document.getElementById('tagEditInput').focus();
}

function updateTag() {
    const tag = document.getElementById('tagEditInput').value.trim();
    document.getElementById('sidebarTag').textContent = tag;
    document.getElementById('tagEditor').classList.add('hidden');
    if (socket) socket.emit('updateTag', tag);
}

function sendMessage() {
    const text = document.getElementById('messageInput').value.trim();
    if (!text || !socket) return;
    socket.emit('sendMessage', { text });
    document.getElementById('messageInput').value = '';
}

function handleKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function addMessage(msg, isOwn) {
    const div = document.createElement('div');
    div.className = 'message ' + (isOwn ? 'own' : '');
    div.innerHTML = `
        ${!isOwn ? `<img class="message-avatar" src="${msg.avatar || ''}" onerror="this.textContent='🦈'">` : ''}
        <div class="message-body">
            <div class="message-sender">${msg.sender} ${msg.tag ? '<span class="message-tag">'+msg.tag+'</span>' : ''}</div>
            <div class="message-text">${msg.text}</div>
            <div class="message-time">${msg.time}</div>
        </div>
    `;
    document.getElementById('messagesContainer').appendChild(div);
    document.getElementById('messagesContainer').scrollTop = 99999;
}

function loadStickers() {
    const stickers = ['🦈','🌊','🐟','🦑','🐋','🦀','🐙','🦭','🐚','🪸','⚡','💀','🔥','💙','🦈💨','🌊✨','🐟💨','😎'];
    document.getElementById('stickerGrid').innerHTML = stickers.map(s =>
        `<div class="sticker-item" onclick="sendSticker('${s}')">${s}</div>`
    ).join('');
}

function toggleStickers() {
    document.getElementById('stickerGrid').classList.toggle('open');
}

function sendSticker(sticker) {
    if (!socket) return;
    socket.emit('sendSticker', { sticker });
    document.getElementById('stickerGrid').classList.remove('open');
}

function addSticker(msg, isOwn) {
    const div = document.createElement('div');
    div.className = 'message ' + (isOwn ? 'own' : '');
    div.innerHTML = `
        ${!isOwn ? `<img class="message-avatar" src="${msg.avatar || ''}" onerror="this.textContent='🦈'">` : ''}
        <div class="message-body">
            <div class="message-sender">${msg.sender} ${msg.tag ? '<span class="message-tag">'+msg.tag+'</span>' : ''}</div>
            <div class="message-sticker">${msg.sticker}</div>
            <div class="message-time">${msg.time}</div>
        </div>
    `;
    document.getElementById('messagesContainer').appendChild(div);
    document.getElementById('messagesContainer').scrollTop = 99999;
}

loadRooms();