// server/game/Room.js
const Player = require("./Player");
const Deck = require("./Deck"); // Deck is now primarily managed by Hand.js
const { Hand, BETTING_ROUNDS } = require("./Hand"); // Import Hand
const { generateRoomId } = require("../utils/idGenerator");

const DEFAULT_CONFIG = {
  /* ... (keep existing DEFAULT_CONFIG) ... */ smallBlind: 1,
  bigBlind: 2,
  ante: 0,
  minBuyInMultiplier: 20,
  maxBuyInMultiplier: 100,
  turnTimer: 20,
  timeBankPerPlayer: 30,
  tableCapacity: 9,
};

class Room {
  constructor(hostSocketId, customConfig = {}) {
    this.id = generateRoomId();
    this.name = customConfig.name || `Room ${this.id}`;
    this.hostSocketId = hostSocketId;
    this.config = { ...DEFAULT_CONFIG, ...customConfig };
    this.recalculateBuyIns();

    this.players = new Map(); // socketId -> Player instance
    this.seats = Array(this.config.tableCapacity).fill(null); // seatIndex -> socketId or null
    // this.deck = new Deck(); // Deck instance will now be created per Hand

    this.handHistory = []; // For FR-13

    this.gameState = "waiting"; // 'waiting', 'starting_hand', 'playing', 'hand_ended', 'payout', 'session_ended'
    this.currentHand = null; // Instance of Hand.js
    this.dealerButtonPosition = -1; // Seat index of the dealer
    this.actionTimerId = null; // Stores setTimeout ID for turn timer
    this.currentTurnSocketId = null; // Socket ID of player whose turn it is

    this.pendingRebuys = new Map(); // socketId -> requestedAmount (for FR-7 host approval)
    this.initialPlayerBuyIns = new Map(); // socketId -> {initialBuyIn: number, totalRebuys: number } FR-14
  }

  recalculateBuyIns() {
    /* ... (keep existing method) ... */
    this.config.minBuyIn = this.config.smallBlind * this.config.minBuyInMultiplier;
    this.config.maxBuyIn = this.config.smallBlind * this.config.maxBuyInMultiplier;
  }

  addPlayer(socketId, playerName, buyInAmount, preferredSeat = -1) {
    if (this.players.size >= this.config.tableCapacity) {
      return { error: "Table is full." };
    }
    if (this.players.has(socketId)) {
      // Allow rejoining if disconnected, but handle state. For now, assume new player.
      return { error: "Player already in room." };
    }
    if (buyInAmount < this.config.minBuyIn || buyInAmount > this.config.maxBuyIn) {
      return { error: `Buy-in must be between ${this.config.minBuyIn} and ${this.config.maxBuyIn}.` };
    }

    let seatIndex = -1;
    if (
      preferredSeat !== -1 &&
      preferredSeat >= 0 &&
      preferredSeat < this.config.tableCapacity &&
      !this.seats[preferredSeat]
    ) {
      seatIndex = preferredSeat;
    } else {
      seatIndex = this.seats.findIndex((seat) => seat === null);
    }

    if (seatIndex === -1) {
      return { error: "No available seats." };
    }

    const player = new Player(socketId, playerName, buyInAmount, seatIndex);
    player.resetTimeBank(this.config.timeBankPerPlayer);
    this.players.set(socketId, player);
    this.seats[seatIndex] = socketId;
    this.initialPlayerBuyIns.set(socketId, { initialBuyIn: buyInAmount, totalRebuys: 0 }); // FR-14

    // If game is in progress, player waits for next hand. If waiting, check if can start.
    if (this.gameState === "waiting" && this.players.size >= 2) {
      // Can potentially start, or host can start
    }
    return { success: true, player: player.getPublicState(), seatIndex, roomState: this.getRoomState() };
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (player) {
      this.seats[player.seatNumber] = null;
      this.players.delete(socketId);
      this.initialPlayerBuyIns.delete(socketId); // Remove buy-in tracking

      if (this.currentHand) {
        // If player was in current hand, their cards are mucked, chips stay in pot
        player.fold(); // Mark as folded
        // Hand might need to check if game ends due to this
        const handOutcome = this.currentHand.processPlayerAction(socketId, "fold"); // Force fold in hand
        // This might trigger hand end, need to handle that state
      }

      if (this.players.size < 2 && (this.gameState === "playing" || this.gameState === "hand_ended")) {
        this.endCurrentHandForcefully("Not enough players");
        this.gameState = "waiting";
      }
      if (socketId === this.hostSocketId && this.players.size > 0) {
        const nextHostKey = this.players.keys().next().value;
        if (nextHostKey) {
          this.hostSocketId = nextHostKey;
          console.log(`Room ${this.id}: Host left, new host is ${this.players.get(nextHostKey).name}`);
        }
      } else if (this.players.size === 0) {
        // Room should be cleaned up by activeRooms manager if empty
        console.log(`Room ${this.id}: All players left. Room should be closed.`);
        this.gameState = "session_ended"; // Mark for cleanup
      }
      return { success: true, playerName: player.name, newHostId: this.hostSocketId };
    }
    return { error: "Player not found." };
  }

  // --- Game Flow Methods ---
  startGameRequest(requestingSocketId) {
    if (requestingSocketId !== this.hostSocketId) {
      return { error: "Only the host can start the game." };
    }
    if (this.players.size < 2) {
      return { error: "Need at least 2 players to start." };
    }
    if (this.gameState === "playing" || this.gameState === "starting_hand") {
      return { error: "Game is already in progress." };
    }
    this.gameState = "starting_hand"; // Transition state
    this.dealerButtonPosition = this._determineInitialDealer();
    this.startNewHand();
    return { success: true, message: "Game starting...", roomState: this.getRoomState() };
  }

  _determineInitialDealer() {
    // First player to join, or random, or lowest seat number.
    // For simplicity, pick the player in the lowest available seat index.
    for (let i = 0; i < this.config.tableCapacity; i++) {
      if (this.seats[i] !== null) {
        return i;
      }
    }
    return -1; // Should not happen if players.size >=1
  }

  _advanceDealerButton() {
    if (this.players.size === 0) return -1;
    let nextDealerPos = this.dealerButtonPosition;
    do {
      nextDealerPos = (nextDealerPos + 1) % this.config.tableCapacity;
    } while (!this.seats[nextDealerPos]); // Find next occupied seat
    return nextDealerPos;
  }

  startNewHand() {
    if (this.players.size < 2) {
      this.gameState = "waiting";
      // console.log(`Room ${this.id}: Not enough players to start new hand.`);
      return { error: "Not enough players to start a new hand." };
    }

    this.clearTurnTimer();
    this.gameState = "playing";
    this.dealerButtonPosition = this._advanceDealerButton();

    const activePlayersForHand = Array.from(this.players.values()).filter(
      (p) => !p.isSittingOut && p.stack > 0
    );
    if (activePlayersForHand.length < 2) {
      this.gameState = "waiting"; // Not enough active players with chips
      return { error: "Not enough active players with chips to start a new hand." };
    }

    // Determine SB and BB positions (handle heads-up case)
    let sbPos = this.dealerButtonPosition;
    let bbPos = this.dealerButtonPosition;

    if (activePlayersForHand.length === 2) {
      // Heads-up: dealer is SB
      sbPos = this.dealerButtonPosition;
      do {
        bbPos = (bbPos + 1) % this.config.tableCapacity;
      } while (!this.seats[bbPos] || !activePlayersForHand.find((p) => p.seatNumber === bbPos));
    } else {
      // 3+ players
      do {
        sbPos = (sbPos + 1) % this.config.tableCapacity;
      } while (!this.seats[sbPos] || !activePlayersForHand.find((p) => p.seatNumber === sbPos));
      bbPos = sbPos;
      do {
        bbPos = (bbPos + 1) % this.config.tableCapacity;
      } while (!this.seats[bbPos] || !activePlayersForHand.find((p) => p.seatNumber === bbPos));
    }

    this.currentHand = new Hand(
      activePlayersForHand,
      this.dealerButtonPosition,
      sbPos,
      bbPos,
      this.config,
      new Deck() // Give each hand a fresh deck
    );

    const handInitialState = this.currentHand.startHand();
    this.currentTurnSocketId = handInitialState.currentPlayerSocketIdToAct;
    this._startTurnTimer();

    return { success: true, handState: this.getHandStateForClient(), roomState: this.getRoomState() };
  }

  handlePlayerAction(socketId, action, amount) {
    if (!this.currentHand || this.gameState !== "playing") {
      return { error: "No active hand or game not in play." };
    }
    if (socketId !== this.currentTurnSocketId) {
      return { error: "Not your turn." };
    }

    this.clearTurnTimer();
    const actionResult = this.currentHand.processPlayerAction(socketId, action, amount);

    if (actionResult.error) {
      this._startTurnTimer(); // Restart timer for same player if action was invalid
      return actionResult;
    }

    this.currentTurnSocketId = actionResult.currentPlayerSocketIdToAct;

    if (this.currentHand.isHandOver) {
      this._concludeHand();
    } else {
      this._startTurnTimer();
    }
    return { success: true, handState: this.getHandStateForClient(), roomState: this.getRoomState() };
  }

  _concludeHand() {
    this.gameState = "hand_ended";
    this.currentTurnSocketId = null;
    this.clearTurnTimer();

    if (this.currentHand && this.currentHand.handSummaryForHistory) {
      this.addHandToHistory(this.currentHand.handSummaryForHistory);
    }

    // Kick out busted players who don't rebuy (or mark as sitting out)
    this.players.forEach((player) => {
      if (player.stack === 0 && !this.pendingRebuys.has(player.socketId)) {
        // For MVP, let's make them sit out. Rebuy logic will handle bringing them back.
        player.isSittingOut = true;
        console.log(`Player ${player.name} busted and is sitting out.`);
      }
    });

    // Optionally, auto-start next hand after a delay, or wait for host/players
    // For now, we wait. A client/host action will trigger `startNewHand`.
  }

  endCurrentHandForcefully(reason = "Hand ended by host") {
    if (this.currentHand) {
      // Award pot to remaining players or refund bets based on rules (complex)
      // For MVP, just nullify the hand, return bets if possible, or abandon pot.
      console.log(`Room ${this.id}: Hand forcefully ended. Reason: ${reason}`);
      this.currentHand.isHandOver = true; // Mark it
      // Add a simplified summary to history
      this.addHandToHistory({
        board: this.currentHand.communityCards,
        pots: this.currentHand.pots.map((p) => ({ amount: p.amount, eligiblePlayers: p.eligiblePlayers })),
        winners: [{ name: "Hand Cancelled", amountWon: 0 }],
        holeCardsShown: [],
      });
      this.currentHand = null;
    }
    this.clearTurnTimer();
    this.currentTurnSocketId = null;
    this.gameState = "hand_ended"; // Or 'waiting'
  }

  // --- Timers (FR-10, FR-11) ---
  _startTurnTimer() {
    this.clearTurnTimer(); // Clear any existing timer
    const currentPlayer = this.players.get(this.currentTurnSocketId);
    if (!currentPlayer || !this.currentHand || this.currentHand.isHandOver) return;

    const timeForTurn = this.config.turnTimer; // Base time

    this.actionTimerId = setTimeout(() => {
      console.log(`Room ${this.id}: Player ${currentPlayer.name} timed out.`);
      // Attempt to use time bank
      if (currentPlayer.timeBank > 0) {
        const timeBankToUse = Math.min(currentPlayer.timeBank, 15); // Use up to 15s of timebank
        currentPlayer.deductFromTimeBank(timeBankToUse);
        console.log(
          `Room ${this.id}: Player ${currentPlayer.name} used ${timeBankToUse}s from time bank. Remaining: ${currentPlayer.timeBank}s.`
        );
        // Re-start a shorter timer with the time bank bonus
        // For simplicity in MVP, we can just auto-fold/check without complex timebank timer restart
        // OR we simply extend their current turn timer and show timebank deducting
        // For now, let's assume basic timeout leads to auto-action.
      }
      // Auto-action: Fold, or Check if possible
      const canCheck = currentPlayer.currentBetInRound >= this.currentHand.currentBetToMatch;
      const autoAction = canCheck ? "check" : "fold";
      this.handlePlayerAction(this.currentTurnSocketId, autoAction, 0);
      // TODO: Emit a message that player timed out and action was taken
    }, timeForTurn * 1000);
  }

  clearTurnTimer() {
    if (this.actionTimerId) {
      clearTimeout(this.actionTimerId);
      this.actionTimerId = null;
    }
  }

  // --- Rebuy (FR-7) ---
  requestRebuy(socketId, amount) {
    // Player requests
    const player = this.getPlayer(socketId);
    if (!player) return { error: "Player not found." };
    if (player.stack > 0) return { error: "Player is not busted." }; // MVP: only rebuy if busted

    // Validate requested amount against room buy-in limits
    const rebuyAmount = Math.min(Math.max(amount, this.config.minBuyIn), this.config.maxBuyIn);

    this.pendingRebuys.set(socketId, rebuyAmount);
    // Notify host (this will be done via socket emission from socketHandlers)
    return {
      success: true,
      playerId: socketId,
      playerName: player.name,
      requestedAmount: rebuyAmount,
      hostId: this.hostSocketId,
    };
  }

  approveRebuy(approvingHostId, targetPlayerId) {
    // Host approves
    if (approvingHostId !== this.hostSocketId) {
      return { error: "Only the host can approve rebuys." };
    }
    const player = this.getPlayer(targetPlayerId);
    const rebuyAmount = this.pendingRebuys.get(targetPlayerId);

    if (!player) return { error: "Player not found." };
    if (rebuyAmount === undefined) return { error: "No pending rebuy for this player." };

    if (player.performRebuy(rebuyAmount, this.config.minBuyIn, this.config.maxBuyIn)) {
      player.isSittingOut = false;
      this.pendingRebuys.delete(targetPlayerId);
      // Update total invested for payout sheet FR-14
      const buyInData = this.initialPlayerBuyIns.get(targetPlayerId);
      if (buyInData) {
        buyInData.totalRebuys += rebuyAmount;
      } else {
        // Should not happen if player was in room
        this.initialPlayerBuyIns.set(targetPlayerId, { initialBuyIn: 0, totalRebuys: rebuyAmount });
      }
      return { success: true, player: player.getPublicState(), roomState: this.getRoomState() };
    }
    return { error: "Rebuy failed." };
  }

  denyRebuy(approvingHostId, targetPlayerId) {
    if (approvingHostId !== this.hostSocketId) {
      return { error: "Only the host can deny rebuys." };
    }
    if (this.pendingRebuys.has(targetPlayerId)) {
      this.pendingRebuys.delete(targetPlayerId);
      // Player remains busted / sitting out
      return { success: true, message: "Rebuy denied.", playerId: targetPlayerId };
    }
    return { error: "No pending rebuy to deny." };
  }

  // --- Getters for state ---
  getRoomState() {
    /* ... (keep existing but add currentHandId if useful) ... */
    return {
      id: this.id,
      name: this.name,
      hostSocketId: this.hostSocketId,
      config: this.config,
      players: this.getPlayersList(), // Public state of players
      seats: this.seats.map((socketId) => (socketId ? this.players.get(socketId)?.getPublicState() : null)),
      gameState: this.gameState,
      dealerButtonPosition: this.dealerButtonPosition,
      currentTurnSocketId: this.currentTurnSocketId,
      handHistoryCount: this.handHistory.length, // So client knows if it can fetch
      // Pot info from currentHand will be part of getHandStateForClient
    };
  }

  getHandStateForClient(perspectiveSocketId = null) {
    if (!this.currentHand) {
      return null;
    }
    // Pass the perspectiveSocketId to hand's state getter to show/hide hole cards
    return this.currentHand._getHandState(perspectiveSocketId || this.currentTurnSocketId);
  }

  getPlayer(socketId) {
    /* ... (keep existing method) ... */
    return this.players.get(socketId);
  }
  getPlayersList() {
    /* ... (keep existing method) ... */
    return Array.from(this.players.values()).map((p) => p.getPublicState());
  }
  updateConfig(newConfig, requestingSocketId) {
    /* ... (add host check) ... */
    if (requestingSocketId !== this.hostSocketId) {
      return { error: "Only the host can change settings." };
    }
    if (this.gameState === "playing") {
      return { error: "Cannot change settings while a hand is in progress." };
    }
    this.config = { ...this.config, ...newConfig };
    this.recalculateBuyIns();
    return { success: true, newConfig: this.config };
  }
  addHandToHistory(handSummary) {
    /* ... (keep existing method) ... */
    this.handHistory.unshift(handSummary);
    if (this.handHistory.length > 5) {
      // FR-13: store last 5 hands
      this.handHistory.pop();
    }
  }
  getLast5HandsForPlayer(socketId) {
    /* ... (keep existing method, ensure card privacy) ... */
    // Ensure hole cards are only shown for the requesting player or if revealed at showdown
    return this.handHistory.map((summary) => {
      let viewableHoleCards = [];
      const playerHoleCardsEntry = summary.holeCardsShown?.find((hcs) => hcs.playerId === socketId);
      if (playerHoleCardsEntry) {
        viewableHoleCards = playerHoleCardsEntry.cards;
      }

      // If the summary is for a showdown, all shown cards are public for that hand
      const showdownCards = summary.holeCardsShown || [];

      return {
        board: summary.board,
        pots: summary.pots,
        winners: summary.winners,
        // Client needs to be smart about displaying this, or server filters more strictly
        holeCardsForThisPlayer: viewableHoleCards, // Specifically for the requesting player
        allShownHoleCards: showdownCards, // All cards shown during that hand (e.g. at showdown)
      };
    });
  }

  // --- Payout (FR-14, FR-15) ---
  generatePayoutLedger(requestingSocketId) {
    if (requestingSocketId !== this.hostSocketId && this.gameState !== "session_ended") {
      // Allow anyone to view if session already ended, but only host to trigger end.
      // This logic might need refinement based on exact flow for ending.
    }
    if (this.gameState === "playing") {
      return { error: "Cannot generate payout while game is in progress." };
    }
    this.gameState = "session_ended"; // Mark session as ended
    this.clearTurnTimer();
    this.currentHand = null; // Clear current hand if any

    const results = [];
    this.players.forEach((player, socketId) => {
      const buyInData = this.initialPlayerBuyIns.get(socketId) || { initialBuyIn: 0, totalRebuys: 0 };
      const totalInvested = buyInData.initialBuyIn + buyInData.totalRebuys;
      results.push({
        name: player.name,
        finalStack: player.stack,
        totalInvested: totalInvested,
        net: player.stack - totalInvested,
      });
    });

    // Sort by net winnings (most won to most lost)
    results.sort((a, b) => b.net - a.net);

    let payoutText = "Payout Ledger:\n";
    payoutText += "Name | Final Stack | Invested | Net\n";
    payoutText += "-------------------------------------\n";
    results.forEach((r) => {
      payoutText += `${r.name} | ${r.finalStack} | ${r.totalInvested} | ${r.net > 0 ? "+" : ""}${r.net}\n`;
    });

    // Basic "who owes whom" (very simplified - not perfect for multi-way debt)
    // For MVP, the list of net results is often sufficient for friends.
    // A true "who owes whom" needs a settlement algorithm.
    // For now, we'll just provide the raw net results.
    // TODO: A more sophisticated settlement if needed.

    return { success: true, ledgerText: payoutText, ledgerCSV: this._generateLedgerCSV(results) };
  }

  _generateLedgerCSV(results) {
    let csv = "Name,Final Stack,Total Invested,Net\n";
    results.forEach((r) => {
      csv += `"${r.name}",${r.finalStack},${r.totalInvested},${r.net}\n`;
    });
    return csv;
  }

  // End Session - called by host, flushes data after ledger is acknowledged
  endSessionAndFlush(requestingSocketId) {
    if (requestingSocketId !== this.hostSocketId) {
      return { error: "Only host can end the session fully." };
    }
    // Data is flushed when the room is removed from activeRooms map
    // This method primarily signals it's okay to destroy.
    console.log(`Room ${this.id} session ended by host. Ready for flushing.`);
    this.gameState = "session_ended_flushed"; // Final state before removal
    return { success: true, message: "Session ended and data will be flushed." };
  }
}

module.exports = Room;
