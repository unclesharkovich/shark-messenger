// ===== ПЕРЕМЕННЫЕ =====
let socket;
let currentUser = null;
let currentChatId = null;
let allStickers = [];
let onlineUsers = [];

// ===== PWA =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}

// ===== ПОДКЛЮЧЕНИЕ =====
function connect() {
    socket = io();
    
    socket.on('registered', (data) => {
        currentUser = data.user;
        // Показываем аватарку в сайдбаре после регистрации
        if (data.user.avatar) {
            const sidebarAvatar = document.getElementById('sidebarAvatar');
            if (sidebarAvatar) sidebarAvatar.src = data.user.avatar;
        }
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
    });

    socket.on('newPrivateSticker', (msg) => {
        if (currentChatId === msg.chatId || msg.senderId === currentChatId) {
            renderSticker(msg, msg.senderId === currentUser?.id);
        }
    });

    socket.on('chatHistory', (data) => {
        const container = document.getElementById('messagesContainer');
        if (container) container.innerHTML = '';
        data.messages.forEach(m => {
            if (m.sticker) renderSticker(m, m.senderId === currentUser?.id);
            else renderMessage(m, m.senderId === currentUser?.id);
        });
    });

    socket.on('newStickerAvailable', (data) => {
        allStickers.push(data.url);
        renderStickerGrid();
    });
}

// ===== РЕГИСТРАЦИЯ =====
function register() {
    const usernameEl = document.getElementById('usernameInput');
    const tagEl = document.getElementById('tagInput');
    
    const username = (usernameEl && usernameEl.value.trim()) || 'Акула';
    const tag = (tagEl && tagEl.value.trim()) || '';
    
    // Обновляем сайдбар
    const sidebarName = document.getElementById('sidebarName');
    const sidebarTag = document.getElementById('sidebarTag');
    if (sidebarName) sidebarName.textContent = username;
    if (sidebarTag) sidebarTag.textContent = tag;
    
    // Показываем чат
    const regPage = document.getElementById('registerPage');
    const chatPage = document.getElementById('chatPage');
    if (regPage) regPage.classList.add('hidden');
    if (chatPage) chatPage.classList.remove('hidden');
    
    const avatarFile = document.getElementById('avatarFile');
    if (avatarFile && avatarFile.files[0]) {
        const formData = new FormData();
        formData.append('avatar', avatarFile.files[0]);
        fetch('/api/avatar', { method: 'POST', body: formData })
            .then(r => r.json())
            .then(data => {
                // Показываем аватарку сразу
                const sidebarAvatar = document.getElementById('sidebarAvatar');
                if (sidebarAvatar) sidebarAvatar.src = data.url;
                // Подключаемся и регистрируемся
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
}

// ===== ЗАГРУЗКА АВАТАРКИ (предпросмотр) =====
function uploadAvatar(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const avatarImg = document.getElementById('avatarImg');
        const avatarPlaceholder = document.getElementById('avatarPlaceholder');
        if (avatarImg) {
            avatarImg.src = e.target.result;
            avatarImg.style.display = 'block';
        }
        if (avatarPlaceholder) avatarPlaceholder.style.display = 'none';
    };
    reader.readAsDataURL(file);
}

// ===== ПОЛЬЗОВАТЕЛИ =====
function renderUserList() {
    const list = document.getElementById('roomsList');
    if (!list) return;
    if (onlineUsers.length === 0) {
        list.innerHTML = '<div style="color:#999;padding:10px;">Пока никого нет</div>';
        return;
    }
    list.innerHTML = onlineUsers.map(u => `
        <div class="room-item ${currentChatId === u.id ? 'active' : ''}" onclick="openPrivateChat('${u.id}')">
            <span>${escapeHtml(u.username)}</span>
            ${u.tag ? `<span style="color:#999;font-size:11px;">${escapeHtml(u.tag)}</span>` : ''}
        </div>
    `).join('');
}

// ===== ЧАТЫ =====
function openPrivateChat(userId) {
    currentChatId = userId;
    const target = onlineUsers.find(u => u.id === userId);
    const currentRoom = document.getElementById('currentRoom');
    const roomOnline = document.getElementById('roomOnline');
    if (currentRoom) currentRoom.textContent = '💬 ' + (target?.username || 'Собеседник');
    if (roomOnline) roomOnline.textContent = 'личный чат';
    const container = document.getElementById('messagesContainer');
    if (container) container.innerHTML = '';
    renderUserList();
    if (socket) socket.emit('getChatHistory', { targetId: userId });
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    if (!input || !currentChatId || !socket) return;
    const text = input.value.trim();
    if (!text) return;
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
    if (!container) return;
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : ''}`;
    div.innerHTML = `
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
    if (!container) return;
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : ''}`;
    div.innerHTML = `
        <div class="message-body">
            <div class="message-header">
                <span class="message-sender">${escapeHtml(msg.senderName)}</span>
                ${msg.senderTag ? `<span class="message-tag">${escapeHtml(msg.senderTag)}</span>` : ''}
            </div>
            <img src="${msg.sticker}" alt="sticker" style="max-width:120px;border-radius:8px;">
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
    }).catch(() => {});
}

function renderStickerGrid() {
    const grid = document.getElementById('stickerGrid');
    if (!grid) return;
    if (allStickers.length === 0) {
        grid.innerHTML = '<div style="color:#999;font-size:12px;padding:10px;">Стикеров пока нет</div>';
        return;
    }
    grid.innerHTML = allStickers.map(url => `
        <div class="sticker-item" onclick="sendSticker('${url}')">
            <img src="${url}" alt="sticker" loading="lazy" style="width:100%;height:100%;object-fit:contain;">
        </div>
    `).join('');
}

function toggleStickers() {
    const grid = document.getElementById('stickerGrid');
    if (grid) grid.classList.toggle('open');
}

function sendSticker(url) {
    if (!currentChatId || !socket) return;
    socket.emit('privateSticker', { targetId: currentChatId, stickerUrl: url });
    const grid = document.getElementById('stickerGrid');
    if (grid) grid.classList.remove('open');
}

// ===== УТИЛИТЫ =====
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function toggleTagEditor() {
    const el = document.getElementById('tagEditor');
    if (el) el.classList.toggle('hidden');
    const input = document.getElementById('tagEditInput');
    if (input && el && !el.classList.contains('hidden')) input.focus();
}

function updateTag() {
    const input = document.getElementById('tagEditInput');
    if (!input) return;
    const tag = input.value.trim();
    const sidebarTag = document.getElementById('sidebarTag');
    if (sidebarTag) sidebarTag.textContent = tag;
    const tagEditor = document.getElementById('tagEditor');
    if (tagEditor) tagEditor.classList.add('hidden');
    if (socket) socket.emit('updateTag', tag);
}

// ===== АВТОРАЗМЕР ПОЛЯ ВВОДА =====
document.addEventListener('DOMContentLoaded', () => {
    const msgInput = document.getElementById('messageInput');
    if (msgInput) {
        msgInput.addEventListener('input', function() {
            this.style.height = '50px';
            this.style.height = Math.min(this.scrollHeight, 150) + 'px';
        });
    }
    
    // Предпросмотр аватарки при выборе файла
    const avatarInput = document.getElementById('avatarFile');
    if (avatarInput) {
        avatarInput.addEventListener('change', uploadAvatar);
    }
});

console.log('🦈 SharkMessenger готов к работе!');
