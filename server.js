const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Хранилище
const users = new Map();
const rooms = {
    'shark-tank': { name: '🦈 Акулья бухта', users: new Set(), messages: [] },
    'deep-ocean': { name: '🌊 Глубокий океан', users: new Set(), messages: [] },
    'reef': { name: '🐠 Коралловый риф', users: new Set(), messages: [] }
};

app.use(express.static('public'));

app.get('/api/rooms', (req, res) => {
    const list = Object.entries(rooms).map(([id, r]) => ({
        id, name: r.name, online: r.users.size
    }));
    res.json(list);
});

io.on('connection', (socket) => {
    console.log(`🦈 Подключился: ${socket.id}`);

    socket.on('register', (data) => {
        const user = {
            id: socket.id,
            username: data.username || 'Акула',
            customTag: data.customTag || '',
            avatar: data.avatar || null,
            room: 'shark-tank'
        };
        users.set(socket.id, user);
        rooms['shark-tank'].users.add(socket.id);
        socket.join('shark-tank');
        socket.emit('registered', { user, history: rooms['shark-tank'].messages });
        io.to('shark-tank').emit('userJoined', { username: user.username, total: rooms['shark-tank'].users.size });
    });

    socket.on('sendMessage', (data) => {
        const user = users.get(socket.id);
        if (!user) return;
        const msg = {
            id: uuidv4(),
            sender: user.username,
            tag: user.customTag,
            avatar: user.avatar,
            text: data.text,
            room: user.room,
            time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };
        rooms[user.room].messages.push(msg);
        io.to(user.room).emit('newMessage', msg);
    });

    socket.on('sendSticker', (data) => {
        const user = users.get(socket.id);
        if (!user) return;
        const stickerMsg = {
            id: uuidv4(),
            sender: user.username,
            tag: user.customTag,
            avatar: user.avatar,
            sticker: data.sticker,
            room: user.room,
            time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };
        rooms[user.room].messages.push(stickerMsg);
        io.to(user.room).emit('newSticker', stickerMsg);
    });

    socket.on('switchRoom', (newRoom) => {
        const user = users.get(socket.id);
        if (!user || !rooms[newRoom]) return;
        rooms[user.room].users.delete(socket.id);
        socket.leave(user.room);
        user.room = newRoom;
        rooms[newRoom].users.add(socket.id);
        socket.join(newRoom);
        socket.emit('roomSwitched', { room: newRoom, history: rooms[newRoom].messages });
    });

    socket.on('updateTag', (tag) => {
        const user = users.get(socket.id);
        if (user) user.customTag = tag;
    });

    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user && rooms[user.room]) {
            rooms[user.room].users.delete(socket.id);
            io.to(user.room).emit('userLeft', { username: user.username, total: rooms[user.room].users.size });
        }
        users.delete(socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`🦈 SharkMessenger запущен на порту ${PORT}`);
});