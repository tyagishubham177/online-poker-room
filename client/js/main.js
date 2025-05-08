// client/js/main.js
console.log("Client main.js loaded!");

// Connect to the Socket.IO server
// The io() function is available globally after including socket.io.js
const socket = io();

const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendMessageButton = document.getElementById("sendMessageButton");

// Listen for connection event
socket.on("connect", () => {
  console.log("Connected to Socket.IO server! Socket ID:", socket.id);
  addMessageToPage(`Connected with ID: ${socket.id}`);
});

// Listen for disconnection event
socket.on("disconnect", () => {
  console.log("Disconnected from Socket.IO server!");
  addMessageToPage("Disconnected from server.");
});

// Listen for 'serverMessage' events from the server
socket.on("serverMessage", (data) => {
  console.log("Message from server:", data);
  addMessageToPage(`Server: ${data}`);
});

// Send a message when the button is clicked
sendMessageButton.addEventListener("click", () => {
  const message = messageInput.value;
  if (message.trim() !== "") {
    socket.emit("clientMessage", message); // Emit 'clientMessage' to server
    addMessageToPage(`You: ${message}`);
    messageInput.value = ""; // Clear input
  }
});

function addMessageToPage(message) {
  const p = document.createElement("p");
  p.textContent = message;
  messagesDiv.appendChild(p);
}
