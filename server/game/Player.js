// server/game/Player.js

class Player {
  constructor(socketId, name, initialStack, seatNumber) {
    this.socketId = socketId; // Unique ID from Socket.IO
    this.name = name || `Player_${socketId.substring(0, 5)}`; // Default name if not provided
    this.stack = initialStack; // Current chip stack
    this.seatNumber = seatNumber; // Their seat at the table (0-8)

    // In-hand state (reset per hand)
    this.holeCards = []; // Array of 2 cards, e.g., ["AH", "KD"]
    this.currentBetInRound = 0; // Chips bet in the current betting round
    this.totalBetInHand = 0; // Total chips bet in the current hand (across all rounds)
    this.hasFolded = false;
    this.isAllIn = false;
    this.lastAction = null; // e.g., 'fold', 'check', 'call', 'bet', 'raise'

    // Session state
    this.timeBank = 30; // FR-11: Personal reserve time-bank (example value)
    this.isSittingOut = false; // For players who are connected but not actively in the next hand
  }

  // --- Getters ---
  getPublicState() {
    // Information safe to send to all players
    return {
      socketId: this.socketId, // Or a sanitized player ID if socketId is too revealing
      name: this.name,
      stack: this.stack,
      seatNumber: this.seatNumber,
      currentBetInRound: this.currentBetInRound, // Useful for UI
      totalBetInHand: this.totalBetInHand, // Useful for pot calculations
      hasFolded: this.hasFolded,
      isAllIn: this.isAllIn,
      lastAction: this.lastAction,
      isSittingOut: this.isSittingOut,
    };
  }

  getPrivateState() {
    // Includes hole cards, only for this player
    return {
      ...this.getPublicState(),
      holeCards: [...this.holeCards], // Send a copy
      timeBank: this.timeBank,
    };
  }

  // --- Hand Lifecycle Methods ---
  resetForNewHand() {
    this.holeCards = [];
    this.currentBetInRound = 0;
    this.totalBetInHand = 0;
    this.hasFolded = false;
    this.isAllIn = false;
    this.lastAction = null;
    // isSittingOut and timeBank persist across hands until changed
  }

  assignHoleCards(cards) {
    if (cards && cards.length === 2) {
      this.holeCards = cards;
    } else {
      console.error(`Invalid hole cards for player ${this.name}:`, cards);
      this.holeCards = [];
    }
  }

  // --- Betting Actions ---
  /**
   * Posts a blind or ante.
   * @param {number} amount - The amount to post.
   * @returns {number} The actual amount posted (could be less if player is all-in).
   */
  postBlind(amount) {
    const betAmount = Math.min(amount, this.stack);
    this.stack -= betAmount;
    this.currentBetInRound += betAmount;
    this.totalBetInHand += betAmount;
    if (this.stack === 0) {
      this.isAllIn = true;
    }
    this.lastAction = "blind";
    return betAmount;
  }

  /**
   * Player folds their hand.
   */
  fold() {
    this.hasFolded = true;
    this.lastAction = "fold";
  }

  /**
   * Player checks.
   */
  check() {
    this.lastAction = "check";
  }

  /**
   * Player calls the current bet.
   * @param {number} amountToCall - The amount required to call.
   * @returns {number} The actual amount called.
   */
  call(amountToCall) {
    const callAmount = Math.min(amountToCall - this.currentBetInRound, this.stack);
    const effectiveCall = this.currentBetInRound + callAmount;

    this.stack -= callAmount;
    this.currentBetInRound = effectiveCall; // Now matches the amountToCall or player is all-in
    this.totalBetInHand += callAmount;

    if (this.stack === 0) {
      this.isAllIn = true;
    }
    this.lastAction = "call";
    return callAmount; // The chips added to the pot by this action
  }

  /**
   * Player bets or raises.
   * @param {number} betSize - The total size of the bet/raise for this round.
   * @returns {number} The actual amount added to the pot by this action.
   */
  betOrRaise(betSize) {
    const amountAlreadyBetThisRound = this.currentBetInRound;
    const additionalBetAmount = Math.min(betSize - amountAlreadyBetThisRound, this.stack);

    this.stack -= additionalBetAmount;
    this.currentBetInRound += additionalBetAmount;
    this.totalBetInHand += additionalBetAmount;

    if (this.stack === 0) {
      this.isAllIn = true;
    }
    this.lastAction = amountAlreadyBetThisRound === 0 ? "bet" : "raise";
    return additionalBetAmount; // The chips added to the pot by this action
  }

  // --- Stack Management ---
  collectWinnings(amount) {
    this.stack += amount;
  }

  canRebuy(minBuyIn, maxBuyIn) {
    // Typically, re-buy is allowed if stack is 0 or below minBuyIn
    // For MVP, let's say only if busted (stack === 0)
    return this.stack === 0;
  }

  performRebuy(amount, minBuyIn, maxBuyIn) {
    // FR-7: Host approves re-buy. Amount logic might be here or in Room.
    // For now, assume 'amount' is the approved re-buy amount.
    if (amount > 0) {
      // Ensure rebuy doesn't exceed maxBuyIn if that's a rule,
      // or that it meets a minimum rebuy amount.
      // For MVP, just add the amount.
      this.stack += amount;
      this.isAllIn = false; // Player is no longer all-in after rebuying
      this.hasFolded = false; // Player is back in for next hand
      return true;
    }
    return false;
  }

  // --- Time Bank ---
  useTimeBank(seconds) {
    if (this.timeBank >= seconds) {
      this.timeBank -= seconds;
      return true;
    }
    return false;
  }

  deductFromTimeBank(seconds) {
    this.timeBank = Math.max(0, this.timeBank - seconds);
  }

  resetTimeBank(defaultTimeBank) {
    this.timeBank = defaultTimeBank;
  }
}

module.exports = Player;
