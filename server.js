const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

// ==================== ХРАНИЛИЩЕ ====================

const users = new Map();
const emails = new Map();
const activeCalls = new Map(); // callId → { caller, target, type }

// Папки
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');
const STICKERS_DIR = path.join(__dirname, 'public', 'stickers');
[DATA_DIR, UPLOADS_DIR, AVATARS_DIR, STICKERS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Файл с сообщениями
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

function loadMessages() {
    try {
        if (fs.existsSync(MESSAGES_FILE)) {
            return JSON.parse(fs.readFileSync(MESSAGES_FILE));
        }
    } catch (e) {}
    return { chats: {} }; // { "user1_user2": [messages], ... }
}

function saveMessages(data) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(data, null, 2));
}

let messagesStore = loadMessages();

// Автосохранение каждые 30 секунд
setInterval(() => saveMessages(messagesStore), 30000);

// ==================== MULTER ====================

const avatarStorage = multer.diskStorage({
    destination: AVATARS_DIR,
    filename: (req, file, cb) => {
        cb(null, `avatar_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`);
    }
});
const uploadAvatar = multer({
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Только изображения'));
    }
});

const stickerStorage = multer.diskStorage({
    destination: STICKERS_DIR,
    filename: (req, file, cb) => {
        cb(null, `sticker_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`);
    }
});
const uploadSticker = multer({
    storage: stickerStorage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Только изображения'));
    }
});

// ==================== EXPRESS ====================

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_DIR));

// API
app.get('/api/stickers', (req, res) => {
    fs.readdir(STICKERS_DIR, (err, files) => {
        if (err) return res.json([]);
        res.json(files.filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f)).map(f => `/stickers/${f}`));
    });
});

app.post('/api/stickers/upload', uploadSticker.single('sticker'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Нет файла' });
    const url = `/stickers/${req.file.filename}`;
    io.emit('newStickerAvailable', { url });
    res.json({ url });
});

app.post('/api/avatar', uploadAvatar.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Нет файла' });
    res.json({ url: `/uploads/avatars/${req.file.filename}` });
});

app.post('/api/bind-email', (req, res) => {
    const { socketId, email } = req.body;
    if (!socketId || !email) return res.status(400).json({ error: 'Данные неполные' });
    if (emails.has(email)) return res.status(400).json({ error: 'Email занят' });
    const user = [...users.values()].find(u => u.id === socketId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    user.email = email;
    emails.set(email, user);
    res.json({ success: true });
});

app.get('/api/users', (req, res) => {
    res.json([...users.values()].map(u => ({
        id: u.id,
        username: u.username,
        tag: u.customTag,
        avatar: u.avatar,
        online: true
    })));
});

// ==================== ФУНКЦИИ ====================

function getChatId(user1, user2) {
    return [user1, user2].sort().join('_');
}

function addMessageToStore(chatId, msg) {
    if (!messagesStore.chats[chatId]) messagesStore.chats[chatId] = [];
    messagesStore.chats[chatId].push(msg);
    if (messagesStore.chats[chatId].length > 1000) {
        messagesStore.chats[chatId] = messagesStore.chats[chatId].slice(-500);
    }
    saveMessages(messagesStore);
}

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
    console.log(`🦈 + ${socket.id}`);

    // Регистрация
    socket.on('register', (data) => {
        const user = {
            id: socket.id,
            username: data.username || 'Акула',
            customTag: data.customTag || '',
            avatar: data.avatar || null,
            email: data.email || null,
            online: true
        };
        users.set(socket.id, user);
        if (user.email) emails.set(user.email, user);

        socket.emit('registered', { user });
        io.emit('usersUpdate', [...users.values()].map(u => ({
            id: u.id, username: u.username, tag: u.customTag, avatar: u.avatar, online: u.online
        })));
    });

    // ===== ЛИЧНЫЕ СООБЩЕНИЯ =====
    socket.on('privateMessage', (data) => {
        const sender = users.get(socket.id);
        if (!sender) return;

        const chatId = getChatId(socket.id, data.targetId);
        const msg = {
            id: uuidv4(),
            chatId,
            senderId: socket.id,
            senderName: sender.username,
            senderTag: sender.customTag,
            senderAvatar: sender.avatar,
            text: data.text,
            timeFormatted: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now()
        };

        addMessageToStore(chatId, msg);

        // Отправляем обоим
        io.to(socket.id).emit('newPrivateMessage', msg);
        io.to(data.targetId).emit('newPrivateMessage', msg);
    });

    // Стикер в личку
    socket.on('privateSticker', (data) => {
        const sender = users.get(socket.id);
        if (!sender) return;

        const chatId = getChatId(socket.id, data.targetId);
        const msg = {
            id: uuidv4(),
            chatId,
            senderId: socket.id,
            senderName: sender.username,
            senderTag: sender.customTag,
            senderAvatar: sender.avatar,
            sticker: data.stickerUrl,
            timeFormatted: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now()
        };

        addMessageToStore(chatId, msg);

        io.to(socket.id).emit('newPrivateSticker', msg);
        io.to(data.targetId).emit('newPrivateSticker', msg);
    });

    // Запрос истории чата
    socket.on('getChatHistory', (data) => {
        const chatId = getChatId(socket.id, data.targetId);
        const history = messagesStore.chats[chatId] || [];
        socket.emit('chatHistory', { chatId, messages: history.slice(-200) });
    });

    // ===== ЗВОНКИ (WebRTC сигнализация) =====
    socket.on('callOffer', (data) => {
        const caller = users.get(socket.id);
        if (!caller) return;
        io.to(data.targetId).emit('incomingCall', {
            callerId: socket.id,
            callerName: caller.username,
            callerAvatar: caller.avatar,
            offer: data.offer,
            callType: data.callType
        });
    });

    socket.on('callAnswer', (data) => {
        io.to(data.targetId).emit('callAnswered', {
            answer: data.answer,
            callerId: socket.id
        });
    });

    socket.on('iceCandidate', (data) => {
        io.to(data.targetId).emit('iceCandidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    socket.on('rejectCall', (data) => {
        io.to(data.targetId).emit('callRejected', {
            reason: 'Отклонено',
            by: socket.id
        });
    });

    socket.on('endCall', (data) => {
        io.to(data.targetId).emit('callEnded', { by: socket.id });
    });

    // ===== СТАТУС =====
    socket.on('updateTag', (tag) => {
        const user = users.get(socket.id);
        if (user) {
            user.customTag = tag;
            io.emit('usersUpdate', [...users.values()].map(u => ({
                id: u.id, username: u.username, tag: u.customTag, avatar: u.avatar, online: u.online
            })));
        }
    });

    // ===== ОТКЛЮЧЕНИЕ =====
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            user.online = false;
            if (user.email) emails.delete(user.email);
        }
        users.delete(socket.id);
        io.emit('usersUpdate', [...users.values()].map(u => ({
            id: u.id, username: u.username, tag: u.customTag, avatar: u.avatar, online: u.online
        })));
        console.log(`🦈 - ${socket.id}`);
    });
});

// ==================== ЗАПУСК ====================

server.listen(PORT, () => {
    console.log(`🦈 SharkMessenger v4.0 на порту ${PORT}`);
    console.log(`💬 Личные сообщения готовы`);
    console.log(`📞 Звонки готовы (WebRTC)`);
    console.log(`📱 PWA готов`);
    console.log(`💾 Сообщения на диске`);
});
