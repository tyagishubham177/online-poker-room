// client/js/main.js
import * as Sockets from "./socketClient.js";
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

  // ROOM STATE ➡️ update display + stash for TableUI
  Sockets.registerUIUpdater("updateRoomState", (roomState) => {
    RoomUI.updateRoomDisplay(roomState, Sockets.getMySocketId());
    TableUI.updatePlayersOnTable(roomState.seats, roomState.players, Sockets.getMySocketId());
    TableUI.setCurrentRoomStateForTableUI(roomState);
    isHost = roomState.hostSocketId === Sockets.getMySocketId();
    RoomUI.updateHostControls(isHost, roomState.gameState);
    PlayerActionsUI.updateRebuyApprovalList(null, isHost);
  });

  // HAND STATE ➡️ update table + stash for TableUI
  Sockets.registerUIUpdater("updateHandState", (handState) => {
    TableUI.updateTableDisplay(handState, Sockets.getMySocketId());
    TableUI.setCurrentHandStateForTableUI(handState);
    PlayerActionsUI.updateActionButtons(handState, Sockets.getMySocketId());
  });

  // Notifications
  Sockets.registerUIUpdater("displayMessage", NotificationsUI.displayMessage);
  Sockets.registerUIUpdater("showNotification", NotificationsUI.showNotification);

  // ROOM LIFECYCLE
  Sockets.registerUIUpdater("handleRoomCreation", (data) => {
    currentRoomId = data.roomId;
    myPlayerId = Sockets.getMySocketId();
    isHost = data.hostId === myPlayerId;
    RoomUI.handleRoomCreated(data.roomId, data.roomName, isHost);
    RoomUI.updateRoomDisplay(data.initialRoomState, myPlayerId);
    NotificationsUI.displayMessage({
      type: "success",
      text: `Room "${data.roomName}" created! ID: ${data.roomId}`,
    });
    TableUI.updatePlayersOnTable(data.initialRoomState.seats, data.initialRoomState.players, myPlayerId);
  });

  Sockets.registerUIUpdater("handleJoinedRoom", (data) => {
    currentRoomId = data.roomId;
    myPlayerId = Sockets.getMySocketId();
    isHost = data.roomState.hostSocketId === myPlayerId;
    RoomUI.handleJoinedRoomUI(data.roomId, data.roomState.name, isHost);
    RoomUI.updateRoomDisplay(data.roomState, myPlayerId);
    TableUI.updatePlayersOnTable(data.roomState.seats, data.roomState.players, myPlayerId);
    PlayerActionsUI.checkAndShowRebuy(data.player);
    NotificationsUI.displayMessage({
      type: "success",
      text: `Joined room "${data.roomState.name}".`,
    });
  });

  Sockets.registerUIUpdater("handlePlayerJoined", (data) => {
    RoomUI.updateRoomDisplay(data.roomState, myPlayerId);
    TableUI.updatePlayersOnTable(data.roomState.seats, data.roomState.players, myPlayerId);
  });

  Sockets.registerUIUpdater("handlePlayerLeft", (data) => {
    if (data.playerId === myPlayerId) {
      RoomUI.handleLeftRoomUI();
      TableUI.clearTable();
      PlayerActionsUI.hideAllActionAreas();
      currentRoomId = null;
      myPlayerId = null;
      isHost = false;
    } else {
      RoomUI.updateRoomDisplay(data.roomState, myPlayerId);
      TableUI.updatePlayersOnTable(data.roomState.seats, data.roomState.players, myPlayerId);
      isHost = data.newHostId === myPlayerId;
      RoomUI.updateHostControls(isHost, data.roomState.gameState);
    }
  });

  Sockets.registerUIUpdater("handleConfigUpdate", (data) => {
    RoomUI.updateRoomDisplay(data.roomState, myPlayerId);
    NotificationsUI.displayMessage({
      type: "info",
      text: "Room configuration updated.",
    });
  });

  // GAME FLOW
  Sockets.registerUIUpdater("handleGameStart", (data) => {
    RoomUI.hideRoomManagement();
    RoomUI.showGameArea();
    TableUI.updateTableDisplay(data.handState, myPlayerId);
    RoomUI.updateHostControls(isHost, data.roomState.gameState);
    PlayerActionsUI.hideRebuyArea();
    NotificationsUI.displayMessage({
      type: "game",
      text: "Game has started!",
    });
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
    TableUI.updateTableDisplay(data.handState, myPlayerId);
    PlayerActionsUI.hideActionButtons();
    const me = data.roomState.players.find((p) => p.socketId === myPlayerId);
    if (me) PlayerActionsUI.checkAndShowRebuy(me, data.roomState.config);
    RoomUI.updateHostControls(isHost, data.roomState.gameState);
  });

  Sockets.registerUIUpdater("handleRebuyRequest", (data) => {
    PlayerActionsUI.addRebuyRequestToHostList(data.playerId, data.playerName, data.requestedAmount);
  });

  Sockets.registerUIUpdater("handleRebuyResult", (data) => {
    if (data.success) {
      NotificationsUI.displayMessage({
        type: "success",
        text: data.message || `Rebuy approved! New stack: ${data.newStack}`,
      });
      PlayerActionsUI.hideRebuyArea();
    } else {
      NotificationsUI.displayMessage({
        type: "error",
        text: data.message || "Rebuy failed/denied.",
      });
    }
  });

  Sockets.registerUIUpdater("handlePayoutSheet", (data) => {
    PayoutUI.displayPayoutSheet(data.ledgerText, data.ledgerCSV);
    RoomUI.showPayoutArea();
    RoomUI.hideGameArea();
    RoomUI.updateHostControls(isHost, "session_ended");
  });

  Sockets.registerUIUpdater("handleSessionFlushed", (data) => {
    NotificationsUI.displayMessage({ type: "info", text: data.message });
    RoomUI.handleLeftRoomUI();
    TableUI.clearTable();
    PlayerActionsUI.hideAllActionAreas();
    PayoutUI.hidePayoutSheet();
    currentRoomId = null;
    myPlayerId = null;
    isHost = false;
  });

  Sockets.registerUIUpdater("handleHistory", (data) => HistoryUI.displayHistory(data.history));

  Sockets.registerUIUpdater("handleError", (errorData) =>
    NotificationsUI.displayMessage({
      type: "error",
      text: `Server Error: ${errorData.message}`,
    })
  );

  // INIT MODULES
  RoomUI.init(Sockets);
  PlayerActionsUI.init(Sockets);
  PayoutUI.init(Sockets);
  HistoryUI.init(Sockets);

  // CONNECT
  Sockets.connectToServer();
  document.getElementById("connection-status").textContent = "Connecting...";
  Sockets.registerUIUpdater("displayMessage", (msgData) => {
    NotificationsUI.displayMessage(msgData);
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
