// client/js/ui/tableUI.js

const seatsContainer = document.getElementById("seats-container");
const communityCardsEl = document.getElementById("community-cards");
const mainPotEl = document.getElementById("main-pot");
const myHoleCardsEl = document.getElementById("my-hole-cards");

const MAX_SEATS = 9; // Should match server config FR-4

// Helper to create a card element (simple text for now)
function createCardElement(cardString) {
  const cardDiv = document.createElement("span");
  cardDiv.classList.add("card");
  // Simple text representation. Could be images later.
  // e.g., cardString "AH" -> A♥
  let rank = cardString[0];
  let suit = cardString[1];
  let suitSymbol = "";
  switch (suit.toUpperCase()) {
    case "H":
      suitSymbol = "♥";
      cardDiv.style.color = "red";
      break;
    case "D":
      suitSymbol = "♦";
      cardDiv.style.color = "red";
      break;
    case "C":
      suitSymbol = "♣";
      break;
    case "S":
      suitSymbol = "♠";
      break;
  }
  cardDiv.textContent = `${rank}${suitSymbol} `;
  return cardDiv;
}

export function clearTable() {
  seatsContainer.innerHTML = ""; // Clear all seats
  communityCardsEl.innerHTML = "--";
  mainPotEl.textContent = "0";
  myHoleCardsEl.innerHTML = "--";
  // Initialize seats once when the page loads or when tableUI is initialized
  for (let i = 0; i < MAX_SEATS; i++) {
    const seatDiv = document.createElement("div");
    seatDiv.classList.add("seat");
    seatDiv.dataset.seatIndex = i;
    seatDiv.innerHTML = `
            <div class="seat-info">
                <span class="player-name">Empty</span>
                <span class="player-stack"></span>
                <span class="player-bet"></span>
                <span class="player-status"></span>
            </div>
            <div class="player-cards-at-seat"></div> <!-- For showing cards at showdown -->
            <div class="dealer-button" style="display:none;">D</div>
        `;
    seatsContainer.appendChild(seatDiv);
  }
}
// Call clearTable on load to set up empty seats
clearTable();

/**
 * Updates all player information displayed at the seats.
 * @param {Array<string|null>} seatPlayerIds - Array of socketIds or null for each seat.
 * @param {Array<object>} playersPublicInfo - Array of player public state objects.
 * @param {string} myPlayerId - The current client's player ID (socket ID).
 */
export function updatePlayersOnTable(seatsData, playersList, myPlayerId) {
  if (!seatsContainer) return;

  const seatElements = seatsContainer.querySelectorAll(".seat");

  seatElements.forEach((seatDiv, index) => {
    const socketIdAtSeat = seatsData ? seatsData[index] : null; // seatsData is room.seats from server
    const player = socketIdAtSeat ? playersList.find((p) => p.socketId === socketIdAtSeat) : null;

    const nameEl = seatDiv.querySelector(".player-name");
    const stackEl = seatDiv.querySelector(".player-stack");
    const betEl = seatDiv.querySelector(".player-bet");
    const statusEl = seatDiv.querySelector(".player-status");
    const playerCardsAtSeatEl = seatDiv.querySelector(".player-cards-at-seat");
    playerCardsAtSeatEl.innerHTML = ""; // Clear previous showdown cards

    if (player) {
      nameEl.textContent = player.name + (player.socketId === myPlayerId ? " (You)" : "");
      stackEl.textContent = `Stack: ${player.stack}`;
      betEl.textContent = player.currentBetInRound > 0 ? `Bet: ${player.currentBetInRound}` : "";
      statusEl.textContent = "";
      if (player.hasFolded) statusEl.textContent = "Folded";
      else if (player.isAllIn) statusEl.textContent = "ALL-IN";
      else if (player.isSittingOut) statusEl.textContent = "Sitting Out";

      seatDiv.classList.add("occupied");
      seatDiv.classList.remove("empty");
      if (player.socketId === myPlayerId) {
        seatDiv.classList.add("my-seat");
      } else {
        seatDiv.classList.remove("my-seat");
      }
    } else {
      nameEl.textContent = "Empty";
      stackEl.textContent = "";
      betEl.textContent = "";
      statusEl.textContent = "";
      seatDiv.classList.remove("occupied", "my-seat");
      seatDiv.classList.add("empty");
    }
  });
}

/**
 * Updates the main table display (community cards, pots, player bets/status during hand).
 * @param {object} handState - The current hand state from the server.
 * @param {string} myPlayerId - The current client's player ID.
 */
export function updateTableDisplay(handState, myPlayerId) {
  if (!handState) {
    // If hand ends and handState becomes null, clear relevant parts or show "Waiting for next hand"
    communityCardsEl.innerHTML = "--";
    mainPotEl.textContent = "0";
    // updatePlayersOnTable might be called separately with roomState to update stacks after hand.
    return;
  }

  // Community Cards
  communityCardsEl.innerHTML = ""; // Clear previous
  if (handState.communityCards && handState.communityCards.length > 0) {
    handState.communityCards.forEach((cardStr) => {
      communityCardsEl.appendChild(createCardElement(cardStr));
    });
  } else {
    communityCardsEl.textContent = "--";
  }

  // Pots
  let totalPot = 0;
  if (handState.pots && handState.pots.length > 0) {
    handState.pots.forEach((pot) => (totalPot += pot.amount));
  }
  mainPotEl.textContent = totalPot;
  // TODO: Display side pots if structure allows

  // Update individual player info at seats (bets, status, dealer button)
  const seatElements = seatsContainer.querySelectorAll(".seat");
  seatElements.forEach((seatDiv) => {
    const seatIndex = parseInt(seatDiv.dataset.seatIndex);
    const playerInHand = handState.players.find((p) => p.seatNumber === seatIndex);
    const betEl = seatDiv.querySelector(".player-bet");
    const statusEl = seatDiv.querySelector(".player-status");
    const dealerButtonEl = seatDiv.querySelector(".dealer-button");
    const playerCardsAtSeatEl = seatDiv.querySelector(".player-cards-at-seat");

    // Clear showdown cards from previous hand if any visible
    if (!handState.isHandOver || handState.currentBettingRound !== "SHOWDOWN") {
      playerCardsAtSeatEl.innerHTML = "";
    }

    if (playerInHand) {
      betEl.textContent = playerInHand.currentBetInRound > 0 ? `Bet: ${playerInHand.currentBetInRound}` : "";
      statusEl.textContent = ""; // Clear previous status
      if (playerInHand.hasFolded) statusEl.textContent = "Folded";
      else if (playerInHand.isAllIn) statusEl.textContent = "ALL-IN";
      else if (playerInHand.lastAction) statusEl.textContent = playerInHand.lastAction.toUpperCase();

      // Show player cards if it's showdown and they are involved
      if (handState.isHandOver && handState.currentBettingRound === "SHOWDOWN") {
        const winnerEntry = handState.winners?.find((w) => w.playerId === playerInHand.socketId);
        if (
          playerInHand.holeCards &&
          playerInHand.holeCards.length > 0 &&
          (playerInHand.totalBetInHand > 0 || winnerEntry)
        ) {
          // Show if contributed or won
          playerCardsAtSeatEl.innerHTML = ""; // Clear
          playerInHand.holeCards.forEach((cardStr) => {
            playerCardsAtSeatEl.appendChild(createCardElement(cardStr));
          });
          if (winnerEntry && winnerEntry.handDetails?.name) {
            const handNameEl = document.createElement("div");
            handNameEl.classList.add("hand-name-showdown");
            handNameEl.textContent = winnerEntry.handDetails.name;
            playerCardsAtSeatEl.appendChild(handNameEl);
          }
        }
      }
    } else {
      // Seat might be occupied but player not in current hand (e.g. sitting out)
      const roomPlayer = handState.players.find((p) => p.seatNumber === seatIndex && p.isSittingOut);
      if (roomPlayer) statusEl.textContent = "Sitting Out";
      else betEl.textContent = ""; // Clear bet if seat is empty or player sitting out
    }

    // Dealer Button
    dealerButtonEl.style.display = handState.dealerSeatIndex === seatIndex ? "inline-block" : "none";
  });

  // Update my hole cards (this is separate because it's private)
  // `handleDealHoleCards` updater in `socketClient.js` will call `updateMyHoleCards` directly.
}

export function updateMyHoleCards(cards) {
  myHoleCardsEl.innerHTML = ""; // Clear previous
  if (cards && cards.length === 2) {
    cards.forEach((cardStr) => {
      myHoleCardsEl.appendChild(createCardElement(cardStr));
    });
  } else {
    myHoleCardsEl.textContent = "--";
  }
}

export function highlightCurrentPlayer(currentPlayerSocketId, timeRemaining) {
  seatsContainer.querySelectorAll(".seat").forEach((seatDiv) => {
    const nameEl = seatDiv.querySelector(".player-name"); // Assume name element indicates player presence
    // A more robust way: check if player object for this seat matches currentPlayerSocketId
    const playerInfo = seatDiv.playerData; // We'd need to store this on the seatDiv

    const playerSocketIdAtSeat = Array.from(seatDiv.classList).find((cls) =>
      cls.startsWith("player-socket-")
    );
    // This is a clumsy way. Better to get player by seat index from handState or roomState.
    // For now, we'll just remove existing highlights.
    seatDiv.classList.remove("current-turn");
    const timerEl = seatDiv.querySelector(".turn-timer");
    if (timerEl) timerEl.remove();
  });

  if (currentPlayerSocketId) {
    const playerSeat = Array.from(seatsContainer.querySelectorAll(".seat.occupied")).find((seat) => {
      // We need a reliable way to map seatDiv to socketId.
      // Let's assume updatePlayersOnTable adds a data attribute or class.
      // For now, this won't work accurately without that mapping stored.
      // A better way is for server to send seatIndex of current player.
      // Or, client has full roomState.players and can find player by socketId then get their seatNumber.
      const playerAtSeat = getCurrentRoomState()?.players.find((p) => p.socketId === currentPlayerSocketId); // Need access to roomState
      return playerAtSeat && parseInt(seatDiv.dataset.seatIndex) === playerAtSeat.seatNumber;
    });

    // Let's find the seat based on the server sending currentTurnSocketId.
    // We need access to the latest `roomState.players` or `handState.players` to map ID to seat.
    // This part needs `myPlayerId` and `handState` to be accessible or passed.
    // For now, let's assume we can find the player in the `handState.players` array
    const latestHandState = getCurrentHandState(); // Needs a getter for latest hand state
    if (latestHandState) {
      const currentPlayer = latestHandState.players.find((p) => p.socketId === currentPlayerSocketId);
      if (currentPlayer) {
        const seatDiv = seatsContainer.querySelector(`.seat[data-seat-index="${currentPlayer.seatNumber}"]`);
        if (seatDiv) {
          seatDiv.classList.add("current-turn");
          const timerDisplay = document.createElement("span");
          timerDisplay.classList.add("turn-timer");
          timerDisplay.textContent = ` (${timeRemaining}s)`;
          seatDiv.querySelector(".seat-info").appendChild(timerDisplay); // Append to name or status
        }
      }
    }
  }
}

// --- Temporary state getters - In a real app, this would be part of a proper state management ---
// These are placeholders and a bit of a hack.
// Ideally, main.js would hold the state and pass it to UI functions.
let _currentHandState = null;
let _currentRoomState = null;
export function setCurrentHandStateForTableUI(state) {
  _currentHandState = state;
}
export function setCurrentRoomStateForTableUI(state) {
  _currentRoomState = state;
}
function getCurrentHandState() {
  return _currentHandState;
}
function getCurrentRoomState() {
  return _currentRoomState;
}
// --- End temporary state getters ---

// No init needed if it's purely rendering based on passed data,
// but if it needs to fetch initial state or set up complex listeners, an init could be useful.
