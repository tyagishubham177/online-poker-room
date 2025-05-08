// client/js/ui/roomManagerUI.js

let Sockets; // To be initialized with the Sockets module from main.js

// Room Management Area Elements
const roomManagementArea = document.getElementById("room-management-area");
const createRoomForm = document.getElementById("create-room-form");
const joinRoomForm = document.getElementById("join-room-form");
const currentRoomInfoDiv = document.getElementById("current-room-info");

// Create Room Form Elements
const roomNameInput = document.getElementById("roomNameInput");
const sbInput = document.getElementById("sbInput");
const bbInput = document.getElementById("bbInput");
const createRoomButton = document.getElementById("createRoomButton");

// Join Room Form Elements
const joinRoomIdInput = document.getElementById("joinRoomIdInput");
const playerNameInput = document.getElementById("playerNameInput");
const buyInInput = document.getElementById("buyInInput");
const joinRoomButton = document.getElementById("joinRoomButton");

// Current Room Info Elements
const currentRoomNameEl = document.getElementById("currentRoomName");
const currentRoomIdShareEl = document.getElementById("currentRoomIdShare");
const copyRoomIdButton = document.getElementById("copyRoomIdButton");
const leaveRoomButton = document.getElementById("leaveRoomButton");
const startGameButton = document.getElementById("startGameButton");
const requestPayoutButton = document.getElementById("requestPayoutButton");

// Other areas to show/hide
const gameArea = document.getElementById("game-area");
const payoutDisplayArea = document.getElementById("payout-display-area");
const handHistoryArea = document.getElementById("hand-history-area");

export function init(socketsModule) {
  Sockets = socketsModule;

  createRoomButton.addEventListener("click", () => {
    const roomName = roomNameInput.value.trim();
    const sb = parseInt(sbInput.value);
    const bb = parseInt(bbInput.value);

    if (isNaN(sb) || sb <= 0 || isNaN(bb) || bb <= 0) {
      Sockets.uiUpdaters.displayMessage?.({
        type: "error",
        text: "Small and Big Blinds must be valid positive numbers.",
      });
      return;
    }
    // Add more validation for buy-in multipliers if inputs are added for them

    Sockets.createRoom({
      name: roomName || undefined, // Send undefined if empty so server uses default
      smallBlind: sb,
      bigBlind: bb,
      // Add other config options here if UI elements are added
      // minBuyInMultiplier: 20, // Example defaults, can be from form
      // maxBuyInMultiplier: 100,
    });
  });

  joinRoomButton.addEventListener("click", () => {
    const roomId = joinRoomIdInput.value.trim().toUpperCase(); // Server generates uppercase IDs
    const playerName = playerNameInput.value.trim();
    const buyIn = parseInt(buyInInput.value);

    if (!roomId) {
      Sockets.uiUpdaters.displayMessage?.({ type: "error", text: "Room ID is required." });
      return;
    }
    if (!playerName) {
      Sockets.uiUpdaters.displayMessage?.({ type: "error", text: "Player Name is required." });
      return;
    }
    if (isNaN(buyIn) || buyIn <= 0) {
      Sockets.uiUpdaters.displayMessage?.({ type: "error", text: "Buy-in must be a valid positive number." });
      return;
    }
    // Seat selection can be added later. For now, server assigns first available.
    Sockets.joinRoom(roomId, playerName, buyIn, -1); // -1 for auto-assign seat
  });

  leaveRoomButton.addEventListener("click", () => {
    Sockets.leaveRoom();
  });

  startGameButton.addEventListener("click", () => {
    Sockets.startGame();
  });

  copyRoomIdButton.addEventListener("click", () => {
    const roomIdToCopy = currentRoomIdShareEl.textContent;
    if (navigator.clipboard && roomIdToCopy) {
      navigator.clipboard
        .writeText(roomIdToCopy)
        .then(() =>
          Sockets.uiUpdaters.displayMessage?.({
            type: "success",
            text: `Room ID "${roomIdToCopy}" copied to clipboard!`,
          })
        )
        .catch((err) =>
          Sockets.uiUpdaters.displayMessage?.({ type: "error", text: "Failed to copy Room ID." })
        );
    } else {
      Sockets.uiUpdaters.displayMessage?.({
        type: "error",
        text: "Clipboard API not available or no Room ID to copy.",
      });
    }
  });

  requestPayoutButton.addEventListener("click", () => {
    Sockets.requestPayoutSheet();
  });
}

export function handleRoomCreated(roomId, roomName, isHost) {
  createRoomForm.style.display = "none";
  joinRoomForm.style.display = "none";
  currentRoomInfoDiv.style.display = "block";
  handHistoryArea.style.display = "block";

  currentRoomNameEl.textContent = roomName;
  currentRoomIdShareEl.textContent = roomId;
  updateHostControls(isHost, "waiting"); // Initial state is 'waiting'
  showGameArea(); // Show game area once in a room
}

export function handleJoinedRoomUI(roomId, roomName, isHost) {
  createRoomForm.style.display = "none";
  joinRoomForm.style.display = "none";
  currentRoomInfoDiv.style.display = "block";
  handHistoryArea.style.display = "block";

  currentRoomNameEl.textContent = roomName;
  currentRoomIdShareEl.textContent = roomId;
  updateHostControls(isHost, "waiting"); // Or current game state if provided
  showGameArea();
}

export function handleLeftRoomUI() {
  createRoomForm.style.display = "block";
  joinRoomForm.style.display = "block";
  currentRoomInfoDiv.style.display = "none";
  handHistoryArea.style.display = "none";

  currentRoomNameEl.textContent = "";
  currentRoomIdShareEl.textContent = "";
  hideGameArea();
  hidePayoutArea();
}

export function updateRoomDisplay(roomState, myPlayerId) {
  if (!roomState) return;
  currentRoomNameEl.textContent = roomState.name;
  currentRoomIdShareEl.textContent = roomState.id;

  const isHost = roomState.hostSocketId === myPlayerId;
  updateHostControls(isHost, roomState.gameState);

  // Update other room config displays if any (e.g., blinds, buy-in range)
  // For example:
  // const configDisplay = document.getElementById('room-config-display');
  // if(configDisplay) configDisplay.textContent = `Blinds: ${roomState.config.smallBlind}/${roomState.config.bigBlind}`;
}

export function updateHostControls(isHost, gameState) {
  startGameButton.style.display =
    isHost &&
    (gameState === "waiting" || gameState === "hand_ended") &&
    document.querySelectorAll("#seats-container .seat.occupied").length >= 2
      ? "inline-block"
      : "none";
  requestPayoutButton.style.display =
    isHost && gameState !== "playing" && gameState !== "starting_hand" ? "inline-block" : "none";
  // Add other host-specific controls here (e.g., config update button)
}

export function hideRoomManagement() {
  roomManagementArea.style.display = "none";
}
export function showRoomManagement() {
  roomManagementArea.style.display = "block";
}
export function showGameArea() {
  gameArea.style.display = "block";
  handHistoryArea.style.display = "block"; // Show history button too
}
export function hideGameArea() {
  gameArea.style.display = "none";
  handHistoryArea.style.display = "none";
}
export function showPayoutArea() {
  payoutDisplayArea.style.display = "block";
}
export function hidePayoutArea() {
  payoutDisplayArea.style.display = "none";
}
