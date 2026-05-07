// Ждём загрузки страницы
document.addEventListener('DOMContentLoaded', function() {
    
    // ===== ЭЛЕМЕНТЫ =====
    const regUsername = document.getElementById('regUsername');
    const regTag = document.getElementById('regTag');
    const regButton = document.getElementById('regButton');
    const avatarFileInput = document.getElementById('avatarFileInput');
    const avatarPreview = document.getElementById('avatarPreview');
    const avatarPlaceholder = document.getElementById('avatarPlaceholder');
    const registerPage = document.getElementById('registerPage');
    const chatPage = document.getElementById('chatPage');
    const sidebarName = document.getElementById('sidebarName');
    const sidebarTag = document.getElementById('sidebarTag');
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    const usersList = document.getElementById('usersList');
    const currentRoom = document.getElementById('currentRoom');
    const roomOnline = document.getElementById('roomOnline');
    const messagesContainer = document.getElementById('messagesContainer');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const stickerGrid = document.getElementById('stickerGrid');
    const stickerToggleBtn = document.getElementById('stickerToggleBtn');
    const stickerUploadBtn = document.getElementById('stickerUploadBtn');
    const tagToggleBtn = document.getElementById('tagToggleBtn');
    const tagEditor = document.getElementById('tagEditor');
    const tagEditInput = document.getElementById('tagEditInput');
    const tagSaveBtn = document.getElementById('tagSaveBtn');

    // ===== ПЕРЕМЕННЫЕ =====
    let socket;
    let currentUser = null;
    let currentChatId = null;
    let allStickers = [];
    let onlineUsers = [];

    // ===== ПРЕДПРОСМОТР АВАТАРКИ =====
    avatarFileInput.addEventListener('change', function() {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            avatarPreview.src = e.target.result;
            avatarPreview.style.display = 'block';
            avatarPlaceholder.style.display = 'none';
        };
        reader.readAsDataURL(file);
    });

    // ===== ПОДКЛЮЧЕНИЕ =====
    function connect() {
        socket = io();
        
        socket.on('registered', function(data) {
            currentUser = data.user;
            if (data.user.avatar && sidebarAvatar) {
                sidebarAvatar.src = data.user.avatar;
            }
            loadStickers();
            console.log('✅ Зарегистрирован:', data.user.username);
        });

        socket.on('usersUpdate', function(users) {
            onlineUsers = users.filter(function(u) { return u.id !== currentUser?.id; });
            renderUserList();
        });

        socket.on('newPrivateMessage', function(msg) {
            if (currentChatId === msg.chatId || msg.senderId === currentChatId) {
                renderMessage(msg, msg.senderId === currentUser?.id);
            }
        });

        socket.on('newPrivateSticker', function(msg) {
            if (currentChatId === msg.chatId || msg.senderId === currentChatId) {
                renderSticker(msg, msg.senderId === currentUser?.id);
            }
        });

        socket.on('chatHistory', function(data) {
            messagesContainer.innerHTML = '';
            data.messages.forEach(function(m) {
                if (m.sticker) renderSticker(m, m.senderId === currentUser?.id);
                else renderMessage(m, m.senderId === currentUser?.id);
            });
        });

        socket.on('newStickerAvailable', function(data) {
            allStickers.push(data.url);
            renderStickerGrid();
        });
    }

    // ===== РЕГИСТРАЦИЯ =====
    function register() {
        const username = regUsername.value.trim() || 'Акула';
        const tag = regTag.value.trim() || '';
        
        sidebarName.textContent = username;
        sidebarTag.textContent = tag;
        registerPage.classList.add('hidden');
        chatPage.classList.remove('hidden');
        
        const file = avatarFileInput.files[0];
        if (file) {
            const formData = new FormData();
            formData.append('avatar', file);
            fetch('/api/avatar', { method: 'POST', body: formData })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    sidebarAvatar.src = data.url;
                    connect();
                    waitForSocket(function() {
                        socket.emit('register', { username: username, customTag: tag, avatar: data.url });
                    });
                })
                .catch(function() {
                    connect();
                    waitForSocket(function() {
                        socket.emit('register', { username: username, customTag: tag });
                    });
                });
        } else {
            connect();
            waitForSocket(function() {
                socket.emit('register', { username: username, customTag: tag });
            });
        }
    }

    function waitForSocket(callback) {
        if (socket && socket.connected) {
            callback();
        } else {
            setTimeout(function() { waitForSocket(callback); }, 100);
        }
    }

    // ===== ПОЛЬЗОВАТЕЛИ =====
    function renderUserList() {
        if (onlineUsers.length === 0) {
            usersList.innerHTML = '<div style="color:#999;padding:10px;">Пока никого нет</div>';
            return;
        }
        usersList.innerHTML = onlineUsers.map(function(u) {
            return '<div class="room-item' + (currentChatId === u.id ? ' active' : '') + '" data-userid="' + u.id + '">' +
                '<span>' + escapeHtml(u.username) + '</span>' +
                (u.tag ? '<span style="color:#999;font-size:11px;">' + escapeHtml(u.tag) + '</span>' : '') +
                '</div>';
        }).join('');
        
        // Вешаем обработчики
        usersList.querySelectorAll('.room-item').forEach(function(item) {
            item.addEventListener('click', function() {
                openPrivateChat(this.dataset.userid);
            });
        });
    }

    // ===== ЧАТЫ =====
    function openPrivateChat(userId) {
        currentChatId = userId;
        var target = onlineUsers.find(function(u) { return u.id === userId; });
        currentRoom.textContent = '💬 ' + (target ? target.username : 'Собеседник');
        roomOnline.textContent = 'личный чат';
        messagesContainer.innerHTML = '';
        renderUserList();
        if (socket) socket.emit('getChatHistory', { targetId: userId });
    }

    function sendMessage() {
        var text = messageInput.value.trim();
        if (!text || !currentChatId || !socket) return;
        socket.emit('privateMessage', { targetId: currentChatId, text: text });
        messageInput.value = '';
        messageInput.style.height = '50px';
    }

    function renderMessage(msg, isOwn) {
        var div = document.createElement('div');
        div.className = 'message ' + (isOwn ? 'own' : '');
        div.innerHTML = '<div class="message-body">' +
            '<div class="message-header">' +
                '<span class="message-sender">' + escapeHtml(msg.senderName) + '</span>' +
                (msg.senderTag ? '<span class="message-tag">' + escapeHtml(msg.senderTag) + '</span>' : '') +
            '</div>' +
            '<div class="message-text">' + escapeHtml(msg.text) + '</div>' +
            '<div class="message-time">' + msg.timeFormatted + '</div>' +
        '</div>';
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function renderSticker(msg, isOwn) {
        var div = document.createElement('div');
        div.className = 'message ' + (isOwn ? 'own' : '');
        div.innerHTML = '<div class="message-body">' +
            '<div class="message-header">' +
                '<span class="message-sender">' + escapeHtml(msg.senderName) + '</span>' +
                (msg.senderTag ? '<span class="message-tag">' + escapeHtml(msg.senderTag) + '</span>' : '') +
            '</div>' +
            '<img src="' + msg.sticker + '" alt="sticker" style="max-width:120px;border-radius:8px;">' +
            '<div class="message-time">' + msg.timeFormatted + '</div>' +
        '</div>';
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // ===== СТИКЕРЫ =====
    function loadStickers() {
        fetch('/api/stickers')
            .then(function(r) { return r.json(); })
            .then(function(s) { allStickers = s; renderStickerGrid(); })
            .catch(function() {});
    }

    function renderStickerGrid() {
        if (allStickers.length === 0) {
            stickerGrid.innerHTML = '<div style="color:#999;font-size:12px;padding:10px;">Стикеров пока нет</div>';
            return;
        }
        stickerGrid.innerHTML = allStickers.map(function(url) {
            return '<div class="sticker-item" data-url="' + url + '">' +
                '<img src="' + url + '" alt="sticker" loading="lazy" style="width:100%;height:100%;object-fit:contain;">' +
                '</div>';
        }).join('');
        
        stickerGrid.querySelectorAll('.sticker-item').forEach(function(item) {
            item.addEventListener('click', function() {
                if (!currentChatId || !socket) return;
                socket.emit('privateSticker', { targetId: currentChatId, stickerUrl: this.dataset.url });
                stickerGrid.classList.remove('open');
            });
        });
    }

    function toggleStickers() {
        stickerGrid.classList.toggle('open');
    }

    function uploadNewSticker() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', function() {
            var file = this.files[0];
            if (!file) return;
            var fd = new FormData();
            fd.append('sticker', file);
            fetch('/api/stickers/upload', { method: 'POST', body: fd })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    allStickers.push(data.url);
                    renderStickerGrid();
                });
        });
        input.click();
    }

    // ===== ТЕГ =====
    function toggleTagEditor() {
        tagEditor.classList.toggle('hidden');
        if (!tagEditor.classList.contains('hidden')) tagEditInput.focus();
    }

    function updateTag() {
        var tag = tagEditInput.value.trim();
        sidebarTag.textContent = tag;
        tagEditor.classList.add('hidden');
        if (socket) socket.emit('updateTag', tag);
    }

    // ===== УТИЛИТЫ =====
    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ===== ОБРАБОТЧИКИ =====
    regButton.addEventListener('click', register);
    sendBtn.addEventListener('click', sendMessage);
    stickerToggleBtn.addEventListener('click', toggleStickers);
    stickerUploadBtn.addEventListener('click', uploadNewSticker);
    tagToggleBtn.addEventListener('click', toggleTagEditor);
    tagSaveBtn.addEventListener('click', updateTag);

    messageInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    messageInput.addEventListener('input', function() {
        this.style.height = '50px';
        this.style.height = Math.min(this.scrollHeight, 150) + 'px';
    });

    console.log('🦈 SharkMessenger готов!');
});
