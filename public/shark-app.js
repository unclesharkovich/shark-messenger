// ===== ПЕРЕМЕННЫЕ =====
let socket;
let currentUser = null;
let currentChatId = null;
let allStickers = [];
let peerConnection = null;
let localStream = null;
let onlineUsers = [];

// ===== PWA =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

// ===== ПОДКЛЮЧЕНИЕ =====
function connect() {
    socket = io();
    
    socket.on('registered', (data) => {
        currentUser = data.user;
        showChat();
        loadStickers();
    });

    socket.on('usersUpdate', (users) => {
        onlineUsers = users.filter(u => u.id !== currentUser?.id);
        renderUserList();
    });

    socket.on('newPrivateMessage', (msg) => {
        if (currentChatId === msg.chatId || msg.senderId === currentChatId) {
            renderMessage(msg, msg.senderId === currentUser?.id);
        }
        updateChatPreview(msg);
    });

    socket.on('newPrivateSticker', (msg) => {
        if (currentChatId === msg.chatId || msg.senderId === currentChatId) {
            renderSticker(msg, msg.senderId === currentUser?.id);
        }
    });

    socket.on('chatHistory', (data) => {
        document.getElementById('messagesContainer').innerHTML = '';
        data.messages.forEach(m => {
            if (m.sticker) renderSticker(m, m.senderId === currentUser?.id);
            else renderMessage(m, m.senderId === currentUser?.id);
        });
    });

    // Звонки
    socket.on('incomingCall', (data) => {
        if (confirm(`📞 Входящий ${data.callType === 'video' ? 'видео' : 'голосовой'} звонок от ${data.callerName}`)) {
            startCall(data.callerId, data.callType, data.offer);
        } else {
            socket.emit('rejectCall', { targetId: data.callerId });
        }
    });

    socket.on('callAnswered', async (data) => {
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    });

    socket.on('iceCandidate', async (data) => {
        if (peerConnection && data.candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    });

    socket.on('callRejected', () => {
        endCall();
        alert('📞 Звонок отклонён');
    });

    socket.on('callEnded', () => {
        endCall();
        alert('📞 Звонок завершён');
    });

    socket.on('newStickerAvailable', (data) => {
        allStickers.push(data.url);
        renderStickerGrid();
    });
}

// ===== РЕГИСТРАЦИЯ =====
function register() {
    const usernameEl = document.getElementById('usernameInput') || document.getElementById('regUsername');
    const tagEl = document.getElementById('tagInput') || document.getElementById('regTag');
    
    const username = (usernameEl && usernameEl.value.trim()) || 'Акула';
    const tag = (tagEl && tagEl.value.trim()) || '';
    
    const sidebarName = document.getElementById('sidebarName');
    const sidebarTag = document.getElementById('sidebarTag');
    if (sidebarName) sidebarName.textContent = username;
    if (sidebarTag) sidebarTag.textContent = tag;
    
    const avatarFile = document.getElementById('avatarFile');
    if (avatarFile && avatarFile.files[0]) {
        const formData = new FormData();
        formData.append('avatar', avatarFile.files[0]);
        fetch('/api/avatar', { method: 'POST', body: formData })
            .then(r => r.json())
            .then(data => {
                const sidebarAvatar = document.getElementById('sidebarAvatar');
                if (sidebarAvatar) sidebarAvatar.src = data.url;
                connect();
                setTimeout(() => {
                    if (socket && socket.connected) {
                        socket.emit('register', { username, customTag: tag, avatar: data.url });
                    }
                }, 300);
            })
            .catch(() => {
                connect();
                setTimeout(() => {
                    if (socket && socket.connected) {
                        socket.emit('register', { username, customTag: tag });
                    }
                }, 300);
            });
    } else {
        connect();
        setTimeout(() => {
            if (socket && socket.connected) {
                socket.emit('register', { username, customTag: tag });
            }
        }, 500);
    }
    
    const regPage = document.getElementById('registerPage');
    const chatPage = document.getElementById('chatPage');
    if (regPage) regPage.classList.add('hidden');
    if (chatPage) chatPage.classList.remove('hidden');
}
function showChat() {
    document.getElementById('registerPage').classList.add('hidden');
    document.getElementById('chatPage').classList.remove('hidden');
}

// ===== СПИСОК ПОЛЬЗОВАТЕЛЕЙ =====
function renderUserList() {
    const list = document.getElementById('usersList');
    list.innerHTML = onlineUsers.map(u => `
        <div class="user-item ${currentChatId === u.id ? 'active' : ''}" onclick="openPrivateChat('${u.id}')">
            <img src="${u.avatar || ''}" onerror="this.remove()" class="user-avatar">
            <div class="user-info">
                <div class="user-name">${escapeHtml(u.username)}</div>
                ${u.tag ? `<div class="user-tag">${escapeHtml(u.tag)}</div>` : ''}
            </div>
            <div class="user-online"></div>
            <div class="user-actions">
                <button class="btn-call" onclick="event.stopPropagation(); startCall('${u.id}', 'audio')" title="Звонок">📞</button>
                <button class="btn-call" onclick="event.stopPropagation(); startCall('${u.id}', 'video')" title="Видео">📹</button>
            </div>
        </div>
    `).join('');
}

// ===== ЛИЧНЫЕ ЧАТЫ =====
function openPrivateChat(userId) {
    currentChatId = userId;
    document.getElementById('chatTargetName').textContent = 
        onlineUsers.find(u => u.id === userId)?.username || 'Собеседник';
    document.getElementById('chatArea').classList.remove('hidden');
    document.getElementById('emptyChat').classList.add('hidden');
    renderUserList();
    
    socket.emit('getChatHistory', { targetId: userId });
}

// ===== СООБЩЕНИЯ =====
function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text || !currentChatId) return;
    
    socket.emit('privateMessage', { targetId: currentChatId, text });
    input.value = '';
    input.style.height = '50px';
}

function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function renderMessage(msg, isOwn) {
    const container = document.getElementById('messagesContainer');
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : ''}`;
    div.innerHTML = `
        ${!isOwn ? `<img class="message-avatar" src="${msg.senderAvatar || ''}" onerror="this.remove()">` : ''}
        <div class="message-body">
            <div class="message-header">
                <span class="message-sender">${escapeHtml(msg.senderName)}</span>
                ${msg.senderTag ? `<span class="message-tag">${escapeHtml(msg.senderTag)}</span>` : ''}
            </div>
            <div class="message-text">${escapeHtml(msg.text)}</div>
            <div class="message-time">${msg.timeFormatted}</div>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function renderSticker(msg, isOwn) {
    const container = document.getElementById('messagesContainer');
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : ''}`;
    div.innerHTML = `
        ${!isOwn ? `<img class="message-avatar" src="${msg.senderAvatar || ''}" onerror="this.remove()">` : ''}
        <div class="message-body">
            <div class="message-header">
                <span class="message-sender">${escapeHtml(msg.senderName)}</span>
                ${msg.senderTag ? `<span class="message-tag">${escapeHtml(msg.senderTag)}</span>` : ''}
            </div>
            <img class="message-sticker-img" src="${msg.sticker}" alt="sticker">
            <div class="message-time">${msg.timeFormatted}</div>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ===== СТИКЕРЫ =====
function loadStickers() {
    fetch('/api/stickers').then(r => r.json()).then(s => {
        allStickers = s;
        renderStickerGrid();
    });
}

function renderStickerGrid() {
    const grid = document.getElementById('stickerGrid');
    grid.innerHTML = allStickers.map(url => `
        <div class="sticker-item" onclick="sendSticker('${url}')">
            <img src="${url}" alt="sticker" loading="lazy">
        </div>
    `).join('');
}

function toggleStickers() {
    document.getElementById('stickerGrid').classList.toggle('open');
}

function sendSticker(url) {
    if (!currentChatId) return;
    socket.emit('privateSticker', { targetId: currentChatId, stickerUrl: url });
    document.getElementById('stickerGrid').classList.remove('open');
}

function uploadNewSticker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
        const file = input.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('sticker', file);
        fetch('/api/stickers/upload', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(data => {
                allStickers.push(data.url);
                renderStickerGrid();
            });
    };
    input.click();
}

// ===== ЗВОНКИ (WebRTC) =====
async function startCall(targetId, callType) {
    localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === 'video'
    });
    
    peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    
    peerConnection.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('iceCandidate', { targetId, candidate: e.candidate });
        }
    };
    
    peerConnection.ontrack = (e) => {
        const remoteVideo = document.getElementById('remoteVideo');
        remoteVideo.srcObject = e.streams[0];
        document.getElementById('callOverlay').classList.remove('hidden');
    };
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('callOffer', { targetId, offer, callType });
    
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('callOverlay').classList.remove('hidden');
}

function endCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    document.getElementById('callOverlay').classList.add('hidden');
    document.getElementById('localVideo').srcObject = null;
    document.getElementById('remoteVideo').srcObject = null;
    socket.emit('endCall', { targetId: currentChatId });
}

// ===== УТИЛИТЫ =====
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function toggleTagEditor() {
    const el = document.getElementById('tagEditor');
    el.classList.toggle('hidden');
    if (!el.classList.contains('hidden')) document.getElementById('tagEditInput').focus();
}

function updateTag() {
    const tag = document.getElementById('tagEditInput').value.trim();
    document.getElementById('sidebarTag').textContent = tag;
    document.getElementById('tagEditor').classList.add('hidden');
    socket.emit('updateTag', tag);
}

function showEmailModal() { document.getElementById('emailModal').style.display = 'flex'; }
function skipEmail() { document.getElementById('emailModal').style.display = 'none'; }

function bindEmail() {
    const email = document.getElementById('emailInput').value.trim();
    if (!email) return;
    fetch('/api/bind-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socketId: socket.id, email })
    }).then(r => r.json()).then(d => {
        if (d.success) {
            document.getElementById('sidebarEmail').textContent = email;
            document.getElementById('emailModal').style.display = 'none';
        } else alert(d.error);
    });
}

// Предпросмотр аватарки
document.getElementById('avatarFile')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => document.getElementById('avatarPreview').src = ev.target.result;
        reader.readAsDataURL(file);
    }
});

// Авторазмер поля ввода
document.getElementById('messageInput')?.addEventListener('input', function() {
    this.style.height = '50px';
    this.style.height = Math.min(this.scrollHeight, 150) + 'px';
});
