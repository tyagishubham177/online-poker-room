// server/server.js
const express = require("express");
const http = require("http"); // Node.js native http module
const path = require("path"); // Node.js native path module for working with file paths

const app = express(); // Initialize an Express application
const server = http.createServer(app); // Create an HTTP server using our Express app

const PORT = process.env.PORT || 3000; // Use port from environment variable or default to 3000

// Serve static files from the 'client' directory
// __dirname is the directory where server.js is located (i.e., mvp-poker-room/server)
// path.join helps create a correct path regardless of operating system
// We want to serve files from 'mvp-poker-room/client', so we go one level up from __dirname
const clientPath = path.join(__dirname, "..", "client");
app.use(express.static(clientPath));

// A simple route to check if the server is running
app.get("/ping", (req, res) => {
  res.send("pong");
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Client files will be served from: ${clientPath}`);
});