// server/server.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io"); // Import Server class from socket.io

const app = express();
const server = http.createServer(app);
const io = new Server(server); // Initialize Socket.IO with the HTTP server

const PORT = process.env.PORT || 3000;

const clientPath = path.join(__dirname, '..', 'client');
app.use(express.static(clientPath));

app.get('/ping', (req, res) => {
    res.send('pong');
});

// Socket.IO connection event
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });

    // Example: listen for a custom event from client
    socket.on('clientMessage', (data) => {
        console.log('Message from client (' + socket.id + '):', data);
        // Broadcast to all clients (including sender)
        io.emit('serverMessage', `Server received: '${data}' from ${socket.id}`);
    });

    // Send a welcome message to the connected client
    socket.emit('serverMessage', 'Welcome to the Poker Room server!');
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Socket.IO is listening for connections.`);
});