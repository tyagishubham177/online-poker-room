// client/js/main.js
import * as Sockets from "./socketClient.js";
// Import UI modules (we'll create these in the next steps)
import * as RoomUI from "./ui/roomManagerUI.js";
import * as TableUI from "./ui/tableUI.js";
import * as PlayerActionsUI from "./ui/playerActionsUI.js";
import * as NotificationsUI from "./ui/notificationsUI.js";
import * as PayoutUI from "./ui/payoutUI.js";
import * as HistoryUI from "./ui/handHistoryUI.js";

// --- Global State (Simplified for MVP) ---
let currentRoomId = null;
let myPlayerId = null; // This will be our socket.id
let isHost = false;

function initializeApp() {
  console.log("Initializing Poker App Client...");

  // Register UI updaters with the socket client
  Sockets.registerUIUpdater("updateRoomState", (roomState) => {
    RoomUI.updateRoomDisplay(roomState, Sockets.getMySocketId());
    TableUI.updatePlayersOnTable(roomState.seats, roomState.players, Sockets.getMySocketId());
    // Update host status based on roomState.hostSocketId
    isHost = roomState.hostSocketId === Sockets.getMySocketId();
    RoomUI.updateHostControls(isHost, roomState.gameState);
    PlayerActionsUI.updateRebuyApprovalList(null, isHost); // Clear old list initially
  });
  Sockets.registerUIUpdater("updateHandState", (handState) => {
    TableUI.updateTableDisplay(handState, Sockets.getMySocketId());
    PlayerActionsUI.updateActionButtons(handState, Sockets.getMySocketId());
  });
  Sockets.registerUIUpdater("displayMessage", NotificationsUI.displayMessage);
  Sockets.registerUIUpdater("showNotification", NotificationsUI.showNotification); // More prominent notifications

  Sockets.registerUIUpdater("handleRoomCreation", (data) => {
    currentRoomId = data.roomId;
    myPlayerId = Sockets.getMySocketId(); // Should be set now
    isHost = data.hostId === myPlayerId;
    RoomUI.handleRoomCreated(data.roomId, data.roomName, isHost);
    RoomUI.updateRoomDisplay(data.initialRoomState, myPlayerId); // Show initial state (host is in)
    NotificationsUI.displayMessage({
      type: "success",
      text: `Room "${data.roomName}" created! ID: ${data.roomId}`,
    });
    // Host automatically joins, so we can update player list too
    TableUI.updatePlayersOnTable(data.initialRoomState.seats, data.initialRoomState.players, myPlayerId);
  });
  Sockets.registerUIUpdater("handleJoinedRoom", (data) => {
    currentRoomId = data.roomId;
    myPlayerId = Sockets.getMySocketId();
    isHost = data.roomState.hostSocketId === myPlayerId;
    RoomUI.handleJoinedRoomUI(data.roomId, data.roomState.name, isHost);
    RoomUI.updateRoomDisplay(data.roomState, myPlayerId);
    TableUI.updatePlayersOnTable(data.roomState.seats, data.roomState.players, myPlayerId);
    PlayerActionsUI.checkAndShowRebuy(data.player); // Check if player is busted on join
    NotificationsUI.displayMessage({ type: "success", text: `Joined room "${data.roomState.name}".` });
  });
  Sockets.registerUIUpdater("handlePlayerJoined", (data) => {
    // Another player joined
    RoomUI.updateRoomDisplay(data.roomState, myPlayerId);
    TableUI.updatePlayersOnTable(data.roomState.seats, data.roomState.players, myPlayerId);
  });
  Sockets.registerUIUpdater("handlePlayerLeft", (data) => {
    if (data.playerId === myPlayerId) {
      // It was me who left
      RoomUI.handleLeftRoomUI();
      TableUI.clearTable();
      PlayerActionsUI.hideAllActionAreas();
      currentRoomId = null;
      myPlayerId = null;
      isHost = false;
    } else {
      // Another player left
      RoomUI.updateRoomDisplay(data.roomState, myPlayerId);
      TableUI.updatePlayersOnTable(data.roomState.seats, data.roomState.players, myPlayerId);
      // Update host status if it changed
      isHost = data.newHostId === myPlayerId;
      RoomUI.updateHostControls(isHost, data.roomState.gameState);
    }
  });
  Sockets.registerUIUpdater("handleConfigUpdate", (data) => {
    RoomUI.updateRoomDisplay(data.roomState, myPlayerId); // Config is part of roomState
    NotificationsUI.displayMessage({ type: "info", text: "Room configuration updated." });
  });

  Sockets.registerUIUpdater("handleGameStart", (data) => {
    RoomUI.hideRoomManagement(); // Or just disable certain parts
    RoomUI.showGameArea();
    TableUI.updateTableDisplay(data.handState, myPlayerId);
    RoomUI.updateHostControls(isHost, data.roomState.gameState); // Disable start game button
    PlayerActionsUI.hideRebuyArea(); // Hide rebuy if it was shown
    NotificationsUI.displayMessage({ type: "game", text: "Game has started!" });
  });
  Sockets.registerUIUpdater("handleDealHoleCards", (data) => {
    TableUI.updateMyHoleCards(data.holeCards);
  });
  Sockets.registerUIUpdater("handleNextTurn", (data) => {
    TableUI.highlightCurrentPlayer(data.currentPlayerSocketId, data.timeRemaining);
    PlayerActionsUI.updateActionButtons(
      null,
      Sockets.getMySocketId(),
      data.currentPlayerSocketId === Sockets.getMySocketId()
    );
  });
  Sockets.registerUIUpdater("handleHandEnd", (data) => {
    TableUI.updateTableDisplay(data.handState, myPlayerId); // Show winners, final board
    PlayerActionsUI.hideActionButtons(); // Hide buttons after hand ends
    // Check if current player is busted and show rebuy option
    const me = data.roomState.players.find((p) => p.socketId === myPlayerId);
    if (me) PlayerActionsUI.checkAndShowRebuy(me, data.roomState.config);

    // Next hand might auto-start, or host needs to click start
    RoomUI.updateHostControls(isHost, data.roomState.gameState); // Re-enable start game if host & 'hand_ended'
  });
  Sockets.registerUIUpdater("handleRebuyRequest", (data) => {
    // For host
    PlayerActionsUI.addRebuyRequestToHostList(data.playerId, data.playerName, data.requestedAmount);
  });
  Sockets.registerUIUpdater("handleRebuyResult", (data) => {
    // For player who requested
    if (data.success) {
      NotificationsUI.displayMessage({
        type: "success",
        text: data.message || `Rebuy approved! New stack: ${data.newStack}`,
      });
      PlayerActionsUI.hideRebuyArea();
    } else {
      NotificationsUI.displayMessage({ type: "error", text: data.message || "Rebuy failed/denied." });
    }
  });

  Sockets.registerUIUpdater("handlePayoutSheet", (data) => {
    PayoutUI.displayPayoutSheet(data.ledgerText, data.ledgerCSV);
    RoomUI.showPayoutArea();
    RoomUI.hideGameArea();
    RoomUI.updateHostControls(isHost, "session_ended"); // Host can now confirm flush
  });
  Sockets.registerUIUpdater("handleSessionFlushed", (data) => {
    NotificationsUI.displayMessage({ type: "info", text: data.message });
    // Reset entire UI to initial state
    RoomUI.handleLeftRoomUI(); // Resets most of room UI
    TableUI.clearTable();
    PlayerActionsUI.hideAllActionAreas();
    PayoutUI.hidePayoutSheet();
    currentRoomId = null;
    myPlayerId = null;
    isHost = false;
    // setTimeout(() => window.location.reload(), 3000); // Optional: force reload
  });
  Sockets.registerUIUpdater("handleHistory", (data) => HistoryUI.displayHistory(data.history));
  Sockets.registerUIUpdater("handleError", (errorData) =>
    NotificationsUI.displayMessage({ type: "error", text: `Server Error: ${errorData.message}` })
  );

  // Initialize UI Modules
  RoomUI.init(Sockets); // Pass Sockets for emitting actions
  PlayerActionsUI.init(Sockets);
  PayoutUI.init(Sockets);
  HistoryUI.init(Sockets);
  // TableUI and NotificationsUI are mostly renderers, may not need init if they don't emit.

  // Attempt to connect to the server
  Sockets.connectToServer();

  // Initial UI setup
  document.getElementById("connection-status").textContent = "Connecting...";
  Sockets.registerUIUpdater("displayMessage", (msgData) => {
    NotificationsUI.displayMessage(msgData); // Default message display
    if (msgData.text.startsWith("Connected to server")) {
      document.getElementById("connection-status").textContent = "Connected";
      document.getElementById("connection-status").style.color = "green";
    } else if (msgData.text.startsWith("Disconnected")) {
      document.getElementById("connection-status").textContent = "Disconnected";
      document.getElementById("connection-status").style.color = "red";
    }
  });
}

// Start the app when the DOM is ready
document.addEventListener("DOMContentLoaded", initializeApp);
