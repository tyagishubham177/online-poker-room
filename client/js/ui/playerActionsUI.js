// client/js/ui/playerActionsUI.js

let Sockets; // To be initialized

const playerActionsArea = document.getElementById("player-actions-area");
const betAmountInput = document.getElementById("betAmountInput");
const actionButtons = playerActionsArea.querySelectorAll("button[data-action]");

// Rebuy Area
const rebuyArea = document.getElementById("rebuy-area");
const rebuyAmountInput = document.getElementById("rebuyAmountInput");
const requestRebuyButton = document.getElementById("requestRebuyButton");

// Host Rebuy Approval Area
const hostRebuyApprovalArea = document.getElementById("host-rebuy-approval-area");
const rebuyRequestsList = document.getElementById("rebuy-requests-list");

export function init(socketsModule) {
  Sockets = socketsModule;

  actionButtons.forEach((button) => {
    button.addEventListener("click", (e) => {
      const action = e.target.dataset.action;
      let amount = 0;
      if (action === "bet" || action === "raise") {
        amount = parseInt(betAmountInput.value);
        if (isNaN(amount) || amount <= 0) {
          Sockets.uiUpdaters.displayMessage?.({ type: "error", text: "Invalid bet/raise amount." });
          return;
        }
      }
      Sockets.playerAction(action, amount);
    });
  });

  requestRebuyButton.addEventListener("click", () => {
    const amount = parseInt(rebuyAmountInput.value);
    if (isNaN(amount) || amount <= 0) {
      Sockets.uiUpdaters.displayMessage?.({ type: "error", text: "Invalid rebuy amount." });
      return;
    }
    Sockets.requestRebuy(amount);
  });

  // Event delegation for approve/deny rebuy buttons (since they are dynamically added)
  rebuyRequestsList.addEventListener("click", (e) => {
    if (e.target.matches("button.approve-rebuy")) {
      const playerId = e.target.dataset.playerId;
      Sockets.approveRebuy(playerId);
    } else if (e.target.matches("button.deny-rebuy")) {
      const playerId = e.target.dataset.playerId;
      Sockets.denyRebuy(playerId);
    }
  });
}

/**
 * Updates visibility and enabled state of action buttons based on current hand state and player.
 * @param {object} handState - Current hand state.
 * @param {string} myPlayerId - Current client's player ID.
 * @param {boolean} isMyTurn - Explicitly passed if it's this player's turn.
 */
export function updateActionButtons(handState, myPlayerId, isMyTurnOverride = false) {
  if (!handState || !myPlayerId) {
    hideActionButtons();
    return;
  }

  const me = handState.players.find((p) => p.socketId === myPlayerId);
  const isMyActualTurn = handState.currentPlayerSocketIdToAct === myPlayerId;

  if (!me || me.hasFolded || me.isAllIn || !(isMyActualTurn || isMyTurnOverride)) {
    hideActionButtons();
    return;
  }

  playerActionsArea.style.display = "block";
  betAmountInput.style.display = "none"; // Hide by default

  const canCheck = me.currentBetInRound >= handState.currentBetToMatch;
  const canBet = handState.currentBetToMatch === 0; // No bet yet in this round

  actionButtons.forEach((button) => {
    const action = button.dataset.action;
    button.disabled = false; // Enable by default, then disable specific ones

    switch (action) {
      case "fold":
        button.style.display = "inline-block";
        break;
      case "check":
        button.style.display = canCheck ? "inline-block" : "none";
        break;
      case "call":
        button.style.display = !canCheck && handState.currentBetToMatch > 0 ? "inline-block" : "none";
        // Update call button text to show amount if needed
        if (!canCheck && handState.currentBetToMatch > 0) {
          const amountToCall = Math.min(handState.currentBetToMatch - me.currentBetInRound, me.stack);
          button.textContent = `Call ${amountToCall > 0 ? amountToCall : ""}`;
          if (amountToCall === 0 && me.stack > 0)
            button.style.display = "none"; // Already matched, can only check or raise
          else if (amountToCall === 0 && me.stack === 0) button.style.display = "none"; // All-in, cannot act
        }
        break;
      case "bet":
        button.style.display = canBet ? "inline-block" : "none";
        if (canBet) betAmountInput.style.display = "inline-block";
        break;
      case "raise":
        button.style.display = !canBet && handState.currentBetToMatch > 0 ? "inline-block" : "none";
        if (!canBet && handState.currentBetToMatch > 0) betAmountInput.style.display = "inline-block";
        break;
      default:
        button.style.display = "none";
    }
    // If player stack is 0 and not all-in (should not happen often, but defensive)
    if (me.stack === 0 && !me.isAllIn) {
      button.disabled = true;
    }
  });
  // Set bet input min/max/step based on handState.minRaiseAmount, me.stack, etc.
  if (betAmountInput.style.display !== "none") {
    const minBetOrRaise = handState.minRaiseAmount || handState.config?.bigBlind || 1;
    betAmountInput.min = Math.min(minBetOrRaise, me.stack);
    betAmountInput.max = me.stack;
    betAmountInput.placeholder = `Min: ${betAmountInput.min}`;
    betAmountInput.value = betAmountInput.min; // Default to min
  }
}

export function hideActionButtons() {
  playerActionsArea.style.display = "none";
  betAmountInput.style.display = "none";
}

export function hideAllActionAreas() {
  hideActionButtons();
  hideRebuyArea();
  hideHostRebuyApprovalArea();
}

// --- Rebuy UI ---
export function checkAndShowRebuy(playerState, roomConfig) {
  if (playerState && playerState.stack === 0) {
    rebuyArea.style.display = "block";
    if (roomConfig) {
      rebuyAmountInput.min = roomConfig.minBuyIn;
      rebuyAmountInput.max = roomConfig.maxBuyIn;
      rebuyAmountInput.value = roomConfig.minBuyIn; // Default to min buy-in
      rebuyAmountInput.placeholder = `Min ${roomConfig.minBuyIn}, Max ${roomConfig.maxBuyIn}`;
    }
  } else {
    rebuyArea.style.display = "none";
  }
}
export function hideRebuyArea() {
  rebuyArea.style.display = "none";
}

export function addRebuyRequestToHostList(playerId, playerName, requestedAmount) {
  hostRebuyApprovalArea.style.display = "block";
  const listItem = document.createElement("li");
  listItem.id = `rebuy-req-${playerId}`;
  listItem.innerHTML = `
        ${playerName} (ID: ${playerId.substring(0, 5)}) requests rebuy of ${requestedAmount}.
        <button class="approve-rebuy" data-player-id="${playerId}">Approve</button>
        <button class="deny-rebuy" data-player-id="${playerId}">Deny</button>
    `;
  rebuyRequestsList.appendChild(listItem);
}

export function updateRebuyApprovalList(approvedOrDeniedPlayerId, isHost) {
  if (!isHost) {
    hostRebuyApprovalArea.style.display = "none";
    rebuyRequestsList.innerHTML = ""; // Clear list if no longer host
    return;
  }
  if (approvedOrDeniedPlayerId) {
    const itemToRemove = document.getElementById(`rebuy-req-${approvedOrDeniedPlayerId}`);
    if (itemToRemove) itemToRemove.remove();
  }
  if (rebuyRequestsList.children.length === 0) {
    hostRebuyApprovalArea.style.display = "none";
  } else {
    hostRebuyApprovalArea.style.display = "block";
  }
}
export function hideHostRebuyApprovalArea() {
  hostRebuyApprovalArea.style.display = "none";
}
