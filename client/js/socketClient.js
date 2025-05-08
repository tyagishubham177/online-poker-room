// client/js/socketClient.js

let socket;

// UI update callback functions to be registered by main.js or UI modules
const uiUpdaters = {
  updateRoomState: null, // (roomState) => {}
  updateHandState: null, // (handState) => {}
  displayMessage: null, // (messageObject) => {} // { type: 'info/error/game', text: '', sender: '' }
  showNotification: null, // (notification) => {}
  handleRoomCreation: null, // (data) => {} // { roomId, roomName, hostId, initialRoomState }
  handleJoinedRoom: null, // (data) => {} // { roomId, player, roomState }
  handlePlayerJoined: null, // (data) => {} // { player, roomState } (another player joined)
  handlePlayerLeft: null, // (data) => {} // { playerId, playerName, newHostId, roomState }
  handleConfigUpdate: null, // (data) => {} // { newConfig, roomState }
  handleGameStart: null, // (data) => {} // { handState, roomState }
  handleDealHoleCards: null, // (data) => {} // { holeCards, handNumber }
  handleNextTurn: null, // (data) => {} // { currentPlayerSocketId, timeRemaining }
  handleHandEnd: null, // (data) => {} // { handState, roomState } (winners, etc.)
  handlePayoutSheet: null, // (data) => {} // { ledgerText, ledgerCSV }
  handleSessionFlushed: null, // (data) => {}
  handleRebuyRequest: null, // (data) => {} // For host: { playerId, playerName, requestedAmount }
  handleRebuyResult: null, // (data) => {} // For player: { success, message, newStack (if approved) }
  handleHistory: null, // (data) => {} // {history}
  handleError: null, // (errorData) => {} // General error display
};

export function registerUIUpdater(name, fn) {
  if (uiUpdaters.hasOwnProperty(name)) {
    uiUpdaters[name] = fn;
  } else {
    console.warn(`No UI updater found for ${name}`);
  }
}

export function connectToServer() {
  if (socket && socket.connected) {
    console.log("Already connected.");
    return;
  }

  socket = io({
    // Optional: reconnection attempts, timeouts, etc.
    // reconnectionAttempts: 5,
    // reconnectionDelay: 1000,
  });

  // --- Standard Connection Events ---
  socket.on("connect", () => {
    console.log("Connected to server! Socket ID:", socket.id);
    uiUpdaters.displayMessage?.({ type: "info", text: `Connected to server. Your ID: ${socket.id}` });
  });

  socket.on("disconnect", (reason) => {
    console.log("Disconnected from server:", reason);
    uiUpdaters.displayMessage?.({
      type: "error",
      text: `Disconnected: ${reason}. Attempting to reconnect...`,
    });
    // UI should reflect disconnected state, maybe show a reconnect button or overlay
  });

  socket.on("connect_error", (err) => {
    console.error("Connection error:", err);
    uiUpdaters.displayMessage?.({ type: "error", text: `Connection failed: ${err.message}` });
  });

  // --- Custom Room Event Listeners ---
  socket.on("roomCreated", (data) => uiUpdaters.handleRoomCreation?.(data));
  socket.on("joinedRoom", (data) => uiUpdaters.handleJoinedRoom?.(data));
  socket.on("roomNotFound", (data) =>
    uiUpdaters.displayMessage?.({ type: "error", text: `Room ${data.roomId} not found.` })
  );
  socket.on("errorCreatingRoom", (data) =>
    uiUpdaters.displayMessage?.({ type: "error", text: `Error creating room: ${data.message}` })
  );
  socket.on("errorJoiningRoom", (data) =>
    uiUpdaters.displayMessage?.({ type: "error", text: `Error joining room: ${data.message}` })
  );
  socket.on("playerJoined", (data) => {
    uiUpdaters.handlePlayerJoined?.(data);
    uiUpdaters.displayMessage?.({ type: "info", text: `${data.player.name} has joined.` });
  });
  socket.on("playerLeft", (data) => {
    uiUpdaters.handlePlayerLeft?.(data);
    uiUpdaters.displayMessage?.({ type: "info", text: `${data.playerName || "A player"} has left.` });
  });
  socket.on("leftRoom", () => uiUpdaters.displayMessage?.({ type: "info", text: "You have left the room." })); // Clear UI related to room
  socket.on("roomConfigUpdated", (data) => uiUpdaters.handleConfigUpdate?.(data));
  socket.on("configUpdateFailed", (data) =>
    uiUpdaters.displayMessage?.({ type: "error", text: `Config update failed: ${data.message}` })
  );

  // --- Custom Game Play Event Listeners ---
  socket.on("gameStarted", (data) => uiUpdaters.handleGameStart?.(data));
  socket.on("gameStartFailed", (data) =>
    uiUpdaters.displayMessage?.({ type: "error", text: `Game start failed: ${data.message}` })
  );
  socket.on("dealHoleCards", (data) => uiUpdaters.handleDealHoleCards?.(data));
  socket.on("gameStateUpdate", (data) => {
    // This is a frequent one
    uiUpdaters.updateRoomState?.(data.roomState);
    uiUpdaters.updateHandState?.(data.handState);
  });
  socket.on("nextTurn", (data) => uiUpdaters.handleNextTurn?.(data));
  socket.on("actionFailed", (data) =>
    uiUpdaters.displayMessage?.({ type: "error", text: `Action failed: ${data.message}` })
  );
  socket.on("handEnded", (data) => uiUpdaters.handleHandEnd?.(data));
  socket.on("gameMessage", (data) =>
    uiUpdaters.displayMessage?.({ type: "game", text: data.text, sender: data.sender || "System" })
  );

  // --- Rebuy Event Listeners ---
  socket.on("rebuyRequestedForApproval", (data) => uiUpdaters.handleRebuyRequest?.(data)); // For host
  socket.on("rebuyResult", (data) => uiUpdaters.handleRebuyResult?.(data)); // For player who requested
  socket.on("rebuyApprovalResult", (data) => {
    // For host who approved/denied
    if (data.success)
      uiUpdaters.displayMessage?.({ type: "info", text: `Rebuy for player ${data.playerId} processed.` });
    else uiUpdaters.displayMessage?.({ type: "error", text: `Rebuy approval error: ${data.message}` });
  });
  socket.on("playerRebought", (data) => {
    // For all players
    uiUpdaters.updateRoomState?.(data.roomState); // Update player stacks
    uiUpdaters.displayMessage?.({ type: "info", text: `${data.player.name} has re-bought.` });
  });
  socket.on("rebuyApproved", (data) =>
    uiUpdaters.handleRebuyResult?.({ success: true, message: "Rebuy approved!", newStack: data.newStack })
  );
  socket.on("rebuyDenied", (data) =>
    uiUpdaters.handleRebuyResult?.({ success: false, message: data.message })
  );

  // --- Payout & Session End Listeners ---
  socket.on("payoutSheetGenerated", (data) => uiUpdaters.handlePayoutSheet?.(data));
  socket.on("payoutError", (data) =>
    uiUpdaters.displayMessage?.({ type: "error", text: `Payout error: ${data.message}` })
  );
  socket.on("sessionFlushed", (data) => {
    uiUpdaters.handleSessionFlushed?.(data);
    uiUpdaters.displayMessage?.({ type: "info", text: data.message });
    // Client should likely disconnect or navigate away here
  });
  socket.on("flushError", (data) =>
    uiUpdaters.displayMessage?.({ type: "error", text: `Session flush error: ${data.message}` })
  );

  // --- Hand History ---
  socket.on("lastHandsHistory", (data) => uiUpdaters.handleHistory?.(data));
  socket.on("historyError", (data) =>
    uiUpdaters.displayMessage?.({ type: "error", text: `History error: ${data.message}` })
  );

  // --- General Error from Server ---
  // Consider a generic 'serverError' event for unhandled issues
  socket.on("serverError", (data) => {
    console.error("Generic Server Error:", data);
    uiUpdaters.handleError?.(data);
    uiUpdaters.displayMessage?.({ type: "error", text: `Server error: ${data.message || "Unknown error"}` });
  });
}

// --- Emitter Functions (Actions Client Can Take) ---
export function createRoom(config) {
  if (!socket) return console.error("Socket not connected");
  socket.emit("createRoom", config);
}

export function joinRoom(roomId, playerName, buyInAmount, seatIndex) {
  if (!socket) return console.error("Socket not connected");
  socket.emit("joinRoom", { roomId, playerName, buyInAmount, seatIndex });
}

export function leaveRoom() {
  if (!socket) return console.error("Socket not connected");
  socket.emit("leaveRoom");
}

export function updateRoomConfig(newConfig) {
  if (!socket) return console.error("Socket not connected");
  socket.emit("updateRoomConfig", newConfig);
}

export function startGame() {
  if (!socket) return console.error("Socket not connected");
  socket.emit("startGame");
}

export function playerAction(action, amount) {
  if (!socket) return console.error("Socket not connected");
  socket.emit("playerAction", { action, amount });
}

export function requestRebuy(amount) {
  if (!socket) return console.error("Socket not connected");
  socket.emit("requestRebuy", { amount });
}

export function approveRebuy(targetPlayerId) {
  if (!socket) return console.error("Socket not connected");
  socket.emit("approveRebuy", { targetPlayerId });
}
export function denyRebuy(targetPlayerId) {
  if (!socket) return console.error("Socket not connected");
  socket.emit("denyRebuy", { targetPlayerId });
}

export function requestPayoutSheet() {
  if (!socket) return console.error("Socket not connected");
  socket.emit("requestPayoutSheet");
}
export function confirmEndSessionAndFlush() {
  if (!socket) return console.error("Socket not connected");
  socket.emit("confirmEndSessionAndFlush");
}
export function fetchLastHands() {
  if (!socket) return console.error("Socket not connected");
  socket.emit("fetchLastHands");
}

// Utility to get current socket ID if needed by UI
export function getMySocketId() {
  return socket ? socket.id : null;
}
