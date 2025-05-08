// server/game/Room.js
const Player = require("./Player");
const Deck = require("./Deck");
const { generateRoomId } = require("../utils/idGenerator"); // We'll create this next

// Default configurations
const DEFAULT_CONFIG = {
  smallBlind: 1,
  bigBlind: 2,
  ante: 0,
  minBuyInMultiplier: 20, // e.g., 20 * BB
  maxBuyInMultiplier: 100, // e.g., 100 * BB
  turnTimer: 20, // seconds
  timeBankPerPlayer: 30, // seconds
  tableCapacity: 9, // FR-4
};

class Room {
  constructor(hostSocketId, customConfig = {}) {
    this.id = generateRoomId(); // FR-1 (6-char ID)
    this.name = customConfig.name || `Room ${this.id}`; // FR-1
    this.hostSocketId = hostSocketId;
    this.config = { ...DEFAULT_CONFIG, ...customConfig };
    this.recalculateBuyIns(); // Calculate min/max based on BB

    this.players = new Map(); // socketId -> Player instance
    this.seats = Array(this.config.tableCapacity).fill(null); // seatIndex -> socketId or null
    this.deck = new Deck();
    this.handHistory = []; // For FR-13 (last 5 hands)

    this.gameState = "waiting"; // 'waiting', 'playing', 'hand_ended', 'session_ended'
    this.currentHand = null; // Will be an instance of Hand.js later
    this.dealerButtonPosition = -1; // Seat index of the dealer
    this.actionTimer = null; // Stores setTimeout ID for turn timer
    this.currentTurnSocketId = null;
  }

  recalculateBuyIns() {
    this.config.minBuyIn = this.config.smallBlind * this.config.minBuyInMultiplier;
    this.config.maxBuyIn = this.config.smallBlind * this.config.maxBuyInMultiplier; // Or BB
  }

  // --- Player Management ---
  addPlayer(socketId, playerName, buyInAmount, preferredSeat = -1) {
    if (this.players.size >= this.config.tableCapacity) {
      return { error: "Table is full." };
    }
    if (this.players.has(socketId)) {
      return { error: "Player already in room." };
    }
    if (buyInAmount < this.config.minBuyIn || buyInAmount > this.config.maxBuyIn) {
      return { error: `Buy-in must be between ${this.config.minBuyIn} and ${this.config.maxBuyIn}.` }; // FR-3, FR-6
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
      seatIndex = this.seats.findIndex((seat) => seat === null); // Find first available seat
    }

    if (seatIndex === -1) {
      // Should not happen if tableCapacity check passed, but good for safety
      return { error: "No available seats (internal error)." };
    }

    const player = new Player(socketId, playerName, buyInAmount, seatIndex);
    player.resetTimeBank(this.config.timeBankPerPlayer); // FR-11
    this.players.set(socketId, player);
    this.seats[seatIndex] = socketId;
    this.gameState = "waiting"; // Or re-evaluate if game can start

    return { success: true, player, seatIndex };
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (player) {
      this.seats[player.seatNumber] = null;
      this.players.delete(socketId);
      // If player was in a hand, handle their chips (e.g., fold, forfeit to pot) - for later
      // If only one player left, end game or hand.
      if (this.players.size < 2 && this.gameState === "playing") {
        // this.endHand(); // or similar logic
      }
      if (socketId === this.hostSocketId && this.players.size > 0) {
        // Transfer host role if needed (e.g., to longest present player)
        // For MVP, maybe just end room if host leaves and game not active
        const nextHost = this.players.keys().next().value;
        if (nextHost) {
          this.hostSocketId = nextHost;
          console.log(`Host left, new host is ${this.players.get(nextHost).name}`);
        } else {
          // This would mean no players left, room should be destroyed by caller
        }
      }
      return { success: true, playerName: player.name };
    }
    return { error: "Player not found." };
  }

  getPlayer(socketId) {
    return this.players.get(socketId);
  }

  getPlayersList() {
    return Array.from(this.players.values()).map((p) => p.getPublicState());
  }

  getRoomState() {
    return {
      id: this.id,
      name: this.name,
      hostSocketId: this.hostSocketId,
      config: this.config,
      players: this.getPlayersList(),
      seats: this.seats.map((socketId) => (socketId ? this.players.get(socketId)?.getPublicState() : null)),
      gameState: this.gameState,
      dealerButtonPosition: this.dealerButtonPosition,
      currentTurnSocketId: this.currentTurnSocketId,
      // Pot info will be added later from Hand.js
    };
  }

  // --- Configuration (FR-2, FR-3) ---
  updateConfig(newConfig) {
    // Only allow host to update, and only if game is not 'playing'
    if (this.gameState === "playing") {
      return { error: "Cannot change settings while a hand is in progress." };
    }
    // Add validation for newConfig values (e.g., blinds > 0)
    this.config = { ...this.config, ...newConfig };
    this.recalculateBuyIns();
    // If tableCapacity changes, need to handle existing players (more complex) - for MVP, capacity is fixed. FR-4
    return { success: true, newConfig: this.config };
  }

  // --- Rebuy (FR-7) ---
  requestRebuy(socketId, amount) {
    const player = this.getPlayer(socketId);
    if (!player) return { error: "Player not found." };
    if (player.stack > 0) return { error: "Player is not busted." }; // Or allow top-up if below min, rule dependent

    // For now, assume host approval happens outside.
    // Actual rebuy action would be called after approval.
    return { success: true, playerId: socketId, playerName: player.name, requestedAmount: amount };
  }

  approveRebuy(socketId, rebuyAmount) {
    const player = this.getPlayer(socketId);
    if (!player) return { error: "Player not found." };
    // FR-6 (re-buy adheres to buy-in limits, or specific re-buy rules)
    // For MVP, let's assume rebuyAmount is valid (e.g., up to initial maxBuyIn)
    const effectiveRebuyAmount = Math.min(rebuyAmount, this.config.maxBuyIn); // Example cap

    if (player.performRebuy(effectiveRebuyAmount, this.config.minBuyIn, this.config.maxBuyIn)) {
      player.isSittingOut = false; // Player is back in play for next hand
      return { success: true, player: player.getPublicState() };
    }
    return { error: "Rebuy failed." };
  }

  // --- Hand History (FR-13) ---
  addHandToHistory(handSummary) {
    // handSummary: { board: [], pots: [], winners: [{id, name, hand, amountWon}], holeCards: [{playerId, cards}] }
    this.handHistory.unshift(handSummary); // Add to the beginning
    if (this.handHistory.length > 5) {
      this.handHistory.pop(); // Keep only the last 5
    }
  }

  getLast5HandsForPlayer(socketId) {
    // Filter/transform history to only show relevant hole cards
    return this.handHistory.map((hand) => {
      const playerSpecificHoleCards =
        hand.holeCardsShown?.find((hc) => hc.playerId === socketId)?.cards || [];
      return {
        ...hand,
        holeCards: playerSpecificHoleCards, // Only this player's cards
        // Be careful about showing everyone's cards from history unless they went to showdown.
      };
    });
  }

  // --- Payout (FR-14, FR-15) ---
  generatePayoutLedger() {
    // This is a simplified version. Real settlement can be complex.
    // Assumes all players started with their initial buy-in (or track total buy-ins + rebuys)
    const ledger = [];
    const initialBuyIns = new Map(); // socketId -> total buy-in amount for session

    // This needs to be tracked from the beginning of the session.
    // For simplicity, let's assume `player.initialStack` was their *only* buy-in.
    // A more robust way is to sum up all buy-ins and re-buys for each player.
    // We need to store original buy-in amounts when players join/rebuy.
    // Let's assume `Player` class gets a `totalInvested` property that's updated.
    // For MVP, we'll do: currentStack - initialStack (needs initialStack to be stored properly).

    this.players.forEach((player) => {
      // This is a placeholder. Proper tracking of total invested is needed.
      // For now, this calculation is illustrative and likely incorrect without full tracking.
      // Let's assume Player object has `initialBuyIn` and `totalRebuys` properties.
      // const net = player.stack - (player.initialBuyIn + player.totalRebuys);
      // For the PRD, it's "who owes whom".
      // This requires knowing each player's starting stack for the session.
      // We need to store `initialBuyInAmount` when player joins and sum rebuys.
    });

    // For FR-14: "who owes whom and how much."
    // This needs players' net results (final_stack - total_chips_put_in)
    // This logic will be refined once player buy-in/rebuy tracking is solid.
    // For now, just list final stacks vs a hypothetical initial buy-in.

    const results = [];
    this.players.forEach((player) => {
      // Placeholder: Assume player object has a 'totalInvestedThisSession' property
      const totalInvested = player.initialStack; // This is wrong, needs real tracking
      results.push({
        name: player.name,
        finalStack: player.stack,
        net: player.stack - totalInvested, // This is the key value
      });
    });

    // Simple ledger: just list final stacks for now. True "who owes whom" is more complex.
    const payoutSheet = results
      .map((r) => `${r.name}: Final Stack ${r.finalStack} (Net: ${r.net})`)
      .join("\n");
    this.gameState = "session_ended";
    return payoutSheet; // Plaintext for FR-15
  }

  // More methods for starting hand, progressing rounds, etc., will come,
  // likely delegating much of it to a `Hand` class instance.
}

module.exports = Room;
