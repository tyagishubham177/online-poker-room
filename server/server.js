// server/server.js
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const initializeSocketHandlers = require("./socketHandlers"); // Import the main handler initializer

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    // Basic CORS setup for development, adjust for production
    origin: "*", // Allow all origins for now
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;

const clientPath = path.join(__dirname, "..", "client");
app.use(express.static(clientPath));

app.get("/ping", (req, res) => {
  res.send("pong");
});

initializeSocketHandlers(io); // Initialize all socket event handling logic

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Socket.IO is listening for connections.`);
});
