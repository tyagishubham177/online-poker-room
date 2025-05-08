// server/game/Hand.js
const Deck = require("./Deck");
const { determineHoldemWinners } = require("./pokerRules");
const { RANKS, SUITS } = require("./constants"); // For logging or display if needed

const BETTING_ROUNDS = {
  PREFLOP: "PREFLOP",
  FLOP: "FLOP",
  TURN: "TURN",
  RIVER: "RIVER",
  SHOWDOWN: "SHOWDOWN",
};

class Hand {
  constructor(playersInHand, dealerSeatIndex, smallBlindSeatIndex, bigBlindSeatIndex, roomConfig, deck) {
    this.playersInHand = playersInHand; // Array of Player objects participating in this hand
    this.dealerSeatIndex = dealerSeatIndex;
    this.smallBlindSeatIndex = smallBlindSeatIndex;
    this.bigBlindSeatIndex = bigBlindSeatIndex;
    this.config = roomConfig; // Room's blind structure, etc.
    this.deck = deck || new Deck(); // Use provided deck or create new

    this.communityCards = []; // ['Ah', 'Ks', 'Qd', 'Jc', 'Th']
    this.pots = [{ amount: 0, eligiblePlayers: [...this.playersInHand.map((p) => p.socketId)] }]; // Main pot initially
    this.currentBettingRound = null; // PREFLOP, FLOP, TURN, RIVER, SHOWDOWN
    this.currentPlayerIndexInTurnOrder = -1; // Index within `this.turnOrder`
    this.turnOrder = []; // Array of Player objects in order of action for the current round
    this.lastAggressor = null; // Player object who made the last bet/raise in the current round
    this.currentBetToMatch = 0; // The highest bet amount in the current round players need to match
    this.minRaiseAmount = this.config.bigBlind; // Minimum legal raise amount

    this.actionsThisRound = 0; // Count of actions (bet, call, fold, check) in the current betting round
    this.isHandOver = false;
    this.winners = []; // [{playerId, amountWon, handDetails}]
    this.handSummaryForHistory = null; // For FR-13
  }

  // --- Setup & Start ---
  startHand() {
    this.deck.shuffle(); // FR-8
    this._resetPlayerHandStates();
    this._determineTurnOrder(this.smallBlindSeatIndex); // Pre-flop starts with player after BB
    this._postBlinds();
    this._dealHoleCards();
    this.currentBettingRound = BETTING_ROUNDS.PREFLOP;
    this.currentBetToMatch = this.config.bigBlind; // BB is the initial bet to match
    this.minRaiseAmount = this.config.bigBlind * 2; // Minimum first raise is usually to 2xBB
    this.lastAggressor = this.playersInHand.find((p) => p.seatNumber === this.bigBlindSeatIndex); // BB is initial "aggressor"
    this.actionsThisRound = 0; // Reset for preflop

    // Set the first player to act
    const playerAfterBBIndex =
      (this.turnOrder.findIndex((p) => p.seatNumber === this.bigBlindSeatIndex) + 1) % this.turnOrder.length;
    this.currentPlayerIndexInTurnOrder = playerAfterBBIndex;

    return this._getHandState();
  }

  _resetPlayerHandStates() {
    this.playersInHand.forEach((player) => player.resetForNewHand());
  }

  _postBlinds() {
    const sbPlayer = this.playersInHand.find((p) => p.seatNumber === this.smallBlindSeatIndex);
    const bbPlayer = this.playersInHand.find((p) => p.seatNumber === this.bigBlindSeatIndex);

    let sbAmount = 0;
    let bbAmount = 0;

    if (sbPlayer) {
      sbAmount = sbPlayer.postBlind(this.config.smallBlind);
      this._addToPot(sbPlayer.socketId, sbAmount);
    }
    if (bbPlayer) {
      bbAmount = bbPlayer.postBlind(this.config.bigBlind);
      this._addToPot(bbPlayer.socketId, bbAmount);
    }

    if (this.config.ante > 0) {
      this.playersInHand.forEach((player) => {
        const anteAmount = player.postBlind(this.config.ante); // Ante also uses postBlind logic
        this._addToPot(player.socketId, anteAmount);
      });
    }
  }

  _dealHoleCards() {
    this.playersInHand.forEach((player) => {
      if (!player.isSittingOut) {
        // Only deal to active players
        player.assignHoleCards(this.deck.deal(2));
      }
    });
  }

  _determineTurnOrder(startingSeatIndex, forShowdown = false) {
    this.turnOrder = [];
    const activePlayers = this.playersInHand.filter(
      (p) => !p.hasFolded && !p.isSittingOut && (forShowdown || p.stack > 0 || p.isAllIn)
    );
    if (activePlayers.length === 0) return;

    // Sort by seat index, starting from the player after the dealer (or SB for preflop)
    activePlayers.sort((a, b) => a.seatNumber - b.seatNumber);

    let startIndex = activePlayers.findIndex((p) => p.seatNumber === startingSeatIndex);
    if (startIndex === -1 && activePlayers.length > 0) {
      // Fallback if starting seat isn't active
      startIndex = 0; // Or find first active player after dealer
    }

    if (activePlayers.length > 0) {
      // Create turn order by seat, starting from specified player
      for (let i = 0; i < activePlayers.length; i++) {
        this.turnOrder.push(activePlayers[(startIndex + i) % activePlayers.length]);
      }
    }
    this.currentPlayerIndexInTurnOrder = 0; // First player in the established order
  }

  // --- Player Actions ---
  processPlayerAction(socketId, action, amount = 0) {
    const player = this.playersInHand.find((p) => p.socketId === socketId);
    if (!player || player.socketId !== this.getCurrentPlayerToAct()?.socketId) {
      return { error: "Not your turn or player not found." };
    }
    if (player.hasFolded || (player.isAllIn && action !== "show_cards")) {
      // All-in players can't act further unless it's showdown
      return { error: "Player cannot act." };
    }

    let chipsToPot = 0;

    switch (action) {
      case "fold":
        player.fold();
        break;
      case "check":
        if (player.currentBetInRound < this.currentBetToMatch) {
          return { error: "Cannot check, there is a bet to you." };
        }
        player.check();
        break;
      case "call":
        if (player.currentBetInRound >= this.currentBetToMatch && this.currentBetToMatch > 0) {
          // This handles cases where player is already all-in for less than current bet
          // or if they've already put in enough (e.g. SB calling BB pre-raise)
          // If they are all-in for less, their action is effectively a call of their remaining stack
          if (!player.isAllIn) {
            return { error: "Cannot call, already matched current bet or no bet to call." };
          }
        }
        chipsToPot = player.call(this.currentBetToMatch);
        this._addToPot(player.socketId, chipsToPot);
        break;
      case "bet": // Player opens betting in a round
        if (this.currentBetToMatch > 0) {
          return { error: "Cannot bet, must call or raise." };
        }
        if (amount < this.minRaiseAmount && player.stack > amount) {
          // Allow all-in for less
          return { error: `Bet must be at least ${this.minRaiseAmount}.` };
        }
        chipsToPot = player.betOrRaise(amount);
        this._addToPot(player.socketId, chipsToPot);
        this.currentBetToMatch = player.currentBetInRound;
        this.minRaiseAmount = player.currentBetInRound * 2; // Next min raise is current total bet
        this.lastAggressor = player;
        break;
      case "raise":
        const totalBetSize = amount; // Amount here is the TOTAL bet player wants to make
        // Raise must be at least the size of the previous bet/raise.
        // The amount of the raise itself must be >= previous bet/raise amount.
        // Example: Blinds 1/2. P1 bets 6 (raise of 4). P2 wants to re-raise.
        // Min re-raise is another 4, so total bet of 6+4=10.
        const previousRaiseAmount = this.lastAggressor
          ? this.currentBetToMatch -
            (this.pots.reduce((sum, pot) => sum + pot.amount, 0) > this.config.bigBlind
              ? this.lastAggressor.currentBetInRound - this.currentBetToMatch
              : this.config.bigBlind)
          : this.config.bigBlind;
        const minTotalBetAfterRaise =
          this.currentBetToMatch + Math.max(previousRaiseAmount, this.config.bigBlind);

        if (totalBetSize < minTotalBetAfterRaise && player.stack > totalBetSize) {
          return { error: `Raise must be to at least ${minTotalBetAfterRaise}.` };
        }
        if (totalBetSize <= this.currentBetToMatch && player.stack > totalBetSize) {
          return { error: "Raise amount must be greater than current bet." };
        }

        chipsToPot = player.betOrRaise(totalBetSize);
        this._addToPot(player.socketId, chipsToPot);
        this.currentBetToMatch = player.currentBetInRound;
        // The new minRaiseAmount is based on the size of THIS raise
        this.minRaiseAmount =
          player.currentBetInRound +
          (player.currentBetInRound - (this.lastAggressor ? this.lastAggressor.currentBetInRound : 0));
        this.lastAggressor = player;
        break;
      default:
        return { error: "Invalid action." };
    }
    this.actionsThisRound++;

    // Check if betting round is over or hand is over
    if (this._checkForHandEnd()) {
      this.isHandOver = true;
    } else if (this._isBettingRoundOver()) {
      this._advanceToNextRound();
    } else {
      this._moveToNextPlayer();
    }

    return this._getHandState(player.socketId); // Return updated state
  }

  // --- Pot Management (FR-12 Side Pots) ---
  _addToPot(socketId, amount) {
    if (amount <= 0) return;

    // This is a simplified version. True side pot logic is complex.
    // It needs to handle multiple all-ins at different stages.
    // For MVP, let's focus on one main pot. Side pots are a stretch goal if time is tight.
    // If we implement side pots:
    // 1. Iterate through existing pots.
    // 2. If player is eligible and pot isn't capped by them, add their portion.
    // 3. If player's bet exceeds what some in a pot can cover, split pot and create new side pot.

    // Basic main pot logic:
    this.pots[0].amount += amount;
    // Ensure player is eligible for main pot (they always are if contributing)
    if (!this.pots[0].eligiblePlayers.includes(socketId)) {
      // This shouldn't happen with the initial setup, but for robustness
      this.pots[0].eligiblePlayers.push(socketId);
    }
    // FR-12 Side-pot logic: This is a placeholder for the complex logic.
    // For now, all bets go to the main pot.
    // A full implementation would involve recalculating pots every time someone goes all-in.
    this._recalculatePots();
  }

  _recalculatePots() {
    // FR-12 - This is where the core side-pot logic goes.
    // This is complex. Here's a conceptual outline:
    // 1. Get all players involved in the hand (not folded).
    // 2. Sort them by their total_bet_in_hand.
    // 3. Create pots based on these bet levels.
    //    - The first pot (main pot) is capped by the smallest all-in or total bet of a player who reaches showdown.
    //    - Subsequent side pots are created for bets exceeding the previous pot's cap.
    // 4. Determine eligible players for each pot.

    // Simplified for now, assuming we'll expand:
    const contributingPlayers = this.playersInHand.filter((p) => p.totalBetInHand > 0 && !p.hasFolded);
    if (contributingPlayers.length === 0) {
      this.pots = [{ amount: 0, eligiblePlayers: [] }];
      return;
    }

    // Collect all unique bet amounts players have put in for the hand
    const betLevels = [...new Set(contributingPlayers.map((p) => p.totalBetInHand).sort((a, b) => a - b))];
    const newPots = [];
    let lastPotLevel = 0;

    for (const level of betLevels) {
      const potAmountForThisLevel = level - lastPotLevel;
      if (potAmountForThisLevel <= 0) continue;

      let currentPotValue = 0;
      const eligibleForThisPot = [];

      contributingPlayers.forEach((player) => {
        // How much this player contributes to *this specific pot slice*
        const contributionToThisSlice = Math.min(
          potAmountForThisLevel,
          Math.max(0, player.totalBetInHand - lastPotLevel)
        );
        if (contributionToThisSlice > 0) {
          currentPotValue += contributionToThisSlice;
          eligibleForThisPot.push(player.socketId);
        }
      });

      if (currentPotValue > 0) {
        newPots.push({
          amount: currentPotValue,
          eligiblePlayers: [...new Set(eligibleForThisPot)], // Unique players
        });
      }
      lastPotLevel = level;
    }
    this.pots = newPots.length > 0 ? newPots : [{ amount: 0, eligiblePlayers: [] }];
  }

  // --- Game Flow ---
  _moveToNextPlayer() {
    if (this.turnOrder.length === 0) {
      // Should not happen if hand not over
      this.isHandOver = true; // Or error
      return;
    }
    do {
      this.currentPlayerIndexInTurnOrder = (this.currentPlayerIndexInTurnOrder + 1) % this.turnOrder.length;
    } while (
      this.turnOrder[this.currentPlayerIndexInTurnOrder].hasFolded ||
      this.turnOrder[this.currentPlayerIndexInTurnOrder].isAllIn // All-in players don't get another turn to act
    );
  }

  _isBettingRoundOver() {
    const activePlayersInRound = this.turnOrder.filter((p) => !p.hasFolded && !p.isAllIn);
    if (activePlayersInRound.length <= 1) {
      return true; // All but one folded or are all-in
    }

    // Betting is over if:
    // 1. All active (not folded, not all-in) players have had a turn since the last aggression (bet/raise).
    // 2. All active players have the same amount bet in the current round OR are all-in.
    const firstActor = this.turnOrder[0]; // The one who started the round or was first after last aggressor
    const allMatchedOrAllIn = activePlayersInRound.every(
      (p) => p.currentBetInRound === this.currentBetToMatch || p.isAllIn
    );
    const enoughActions = this.actionsThisRound >= activePlayersInRound.length;

    // The player who made the last bet/raise cannot act again unless someone re-raises.
    // The round ends when the action gets back to the last aggressor and they have no further action
    // (i.e., everyone else has called their bet or folded).
    // Or, if everyone checks around.
    const currentActingPlayer = this.turnOrder[this.currentPlayerIndexInTurnOrder];

    // Condition: if lastAggressor is null (everyone checked), and action is back to first player, round is over.
    if (
      !this.lastAggressor &&
      currentActingPlayer === firstActor &&
      this.actionsThisRound > 0 &&
      activePlayersInRound.every((p) => p.lastAction === "check")
    ) {
      return true;
    }

    // Condition: if there was aggression, action comes back to aggressor AND everyone has matched.
    if (
      this.lastAggressor &&
      currentActingPlayer === this.lastAggressor &&
      allMatchedOrAllIn &&
      enoughActions
    ) {
      return true;
    }

    // Condition: everyone checked around (pre-flop, BB can still act)
    if (
      this.currentBettingRound === BETTING_ROUNDS.PREFLOP &&
      this.lastAggressor &&
      this.lastAggressor.seatNumber === this.bigBlindSeatIndex && // BB was last 'aggressor' by posting
      this.currentBetToMatch === this.config.bigBlind && // No raise yet
      currentActingPlayer === this.lastAggressor && // Action back to BB
      activePlayersInRound.every(
        (p) => p.currentBetInRound === this.config.bigBlind || p.hasFolded || p.isAllIn
      ) &&
      enoughActions
    ) {
      return true; // BB option check/raise
    }

    // Simpler check: Is everyone who is not folded and not all-in having the same currentBetInRound?
    // And has everyone had a chance to act on the current bet?
    if (allMatchedOrAllIn && enoughActions && this.lastAggressor) {
      // Ensure there was at least one bet/raise unless all check
      // If it's the player to the right of the last aggressor who just acted (called or folded)
      // then the round is over.
      const lastAggressorIndex = this.turnOrder.findIndex((p) => p === this.lastAggressor);
      // The player who just acted is `this.currentPlayerIndexInTurnOrder` (before _moveToNextPlayer is called for the *next* turn)
      // The round ends when action completes on the player immediately to the aggressor's left.
      // If player who just acted is to the "left" of the aggressor in turn order, and all have matched/folded.
      let previousPlayerIndex = this.currentPlayerIndexInTurnOrder - 1;
      if (previousPlayerIndex < 0) previousPlayerIndex = this.turnOrder.length - 1;

      // Check if all players (who are not folded/allin) have currentBetInRound equal to currentBetToMatch
      const allActivePlayersHaveMatched = activePlayersInRound.every(
        (p) => p.currentBetInRound === this.currentBetToMatch
      );

      if (allActivePlayersHaveMatched && this.actionsThisRound >= activePlayersInRound.length) {
        return true;
      }
    }

    return false;
  }

  _advanceToNextRound() {
    this.playersInHand.forEach((p) => (p.currentBetInRound = 0)); // Reset for next round
    this.currentBetToMatch = 0;
    this.lastAggressor = null;
    this.actionsThisRound = 0;
    this.minRaiseAmount = this.config.bigBlind; // Reset min raise for new round

    // Determine turn order starting with first active player left of dealer
    let firstToActSeat = this.dealerSeatIndex;
    let found = false;
    for (let i = 1; i <= this.playersInHand.length; i++) {
      const nextSeat = (this.dealerSeatIndex + i) % this.config.tableCapacity;
      const playerAtSeat = this.playersInHand.find(
        (p) => p.seatNumber === nextSeat && !p.hasFolded && !p.isAllIn
      );
      if (playerAtSeat) {
        firstToActSeat = nextSeat;
        found = true;
        break;
      }
    }
    if (!found && this.playersInHand.filter((p) => !p.hasFolded && !p.isAllIn).length > 0) {
      // Fallback if dealer logic fails, pick first non-folded, non-all-in player in seat order
      firstToActSeat = this.playersInHand.find((p) => !p.hasFolded && !p.isAllIn)?.seatNumber ?? 0;
    }

    this._determineTurnOrder(firstToActSeat);
    this.currentPlayerIndexInTurnOrder = 0; // First player in new order

    if (
      this.turnOrder.filter((p) => !p.isAllIn).length < 2 &&
      this.currentBettingRound !== BETTING_ROUNDS.RIVER
    ) {
      // If less than 2 players can bet, fast-forward through remaining streets
      while (this.currentBettingRound !== BETTING_ROUNDS.RIVER) {
        if (this.currentBettingRound === BETTING_ROUNDS.PREFLOP) {
          this.currentBettingRound = BETTING_ROUNDS.FLOP;
          this.communityCards.push(...this.deck.deal(3));
        } else if (this.currentBettingRound === BETTING_ROUNDS.FLOP) {
          this.currentBettingRound = BETTING_ROUNDS.TURN;
          this.communityCards.push(this.deck.dealCard());
        } else if (this.currentBettingRound === BETTING_ROUNDS.TURN) {
          this.currentBettingRound = BETTING_ROUNDS.RIVER;
          this.communityCards.push(this.deck.dealCard());
        }
      }
      this.currentBettingRound = BETTING_ROUNDS.SHOWDOWN;
      this._processShowdown();
      return;
    }

    switch (this.currentBettingRound) {
      case BETTING_ROUNDS.PREFLOP:
        this.currentBettingRound = BETTING_ROUNDS.FLOP;
        this.communityCards.push(...this.deck.deal(3));
        break;
      case BETTING_ROUNDS.FLOP:
        this.currentBettingRound = BETTING_ROUNDS.TURN;
        this.communityCards.push(this.deck.dealCard());
        break;
      case BETTING_ROUNDS.TURN:
        this.currentBettingRound = BETTING_ROUNDS.RIVER;
        this.communityCards.push(this.deck.dealCard());
        break;
      case BETTING_ROUNDS.RIVER:
        this.currentBettingRound = BETTING_ROUNDS.SHOWDOWN;
        this._processShowdown();
        break;
      default: // Should not happen
        this.isHandOver = true;
    }

    // If after advancing round, all remaining players are all-in, go straight to showdown
    const activeBettingPlayers = this.turnOrder.filter((p) => !p.hasFolded && !p.isAllIn);
    if (activeBettingPlayers.length < 2 && this.currentBettingRound !== BETTING_ROUNDS.SHOWDOWN) {
      this._fastForwardToShowdown();
    }
  }

  _fastForwardToShowdown() {
    // Deal remaining community cards if not all dealt
    while (this.communityCards.length < 5) {
      if (this.currentBettingRound === BETTING_ROUNDS.PREFLOP && this.communityCards.length === 0) {
        this.communityCards.push(...this.deck.deal(3));
      } else if (this.communityCards.length < 5) {
        this.communityCards.push(this.deck.dealCard());
      }
    }
    this.currentBettingRound = BETTING_ROUNDS.SHOWDOWN;
    this._processShowdown();
  }

  _checkForHandEnd() {
    const activePlayers = this.playersInHand.filter((p) => !p.hasFolded);
    if (activePlayers.length === 1) {
      this._awardPotToSingleWinner(activePlayers[0]);
      this.isHandOver = true;
      return true;
    }
    // Further checks if all but one are all-in and betting is complete
    const nonAllInActivePlayers = activePlayers.filter((p) => !p.isAllIn);
    if (nonAllInActivePlayers.length <= 1 && this._isBettingRoundOverIfOneCanAct()) {
      // If only one player can still bet, or all are all-in and current round's betting is done
      if (this.currentBettingRound === BETTING_ROUNDS.RIVER) {
        this.currentBettingRound = BETTING_ROUNDS.SHOWDOWN; // Ensure it is set for showdown
        this._processShowdown();
      } else {
        // Fast forward community cards if not all players are all-in but no more betting can occur
        this._fastForwardToShowdown();
      }
      this.isHandOver = true;
      return true;
    }

    return false;
  }

  _isBettingRoundOverIfOneCanAct() {
    // Simplified check: if only one player isn't all-in and folded, and they've matched the bet or are the aggressor
    const activePlayers = this.turnOrder.filter((p) => !p.hasFolded);
    const nonAllInPlayers = activePlayers.filter((p) => !p.isAllIn);

    if (nonAllInPlayers.length > 1) return false; // More than one player can still bet

    // If 0 or 1 player can bet, round ends if all bets are settled
    return activePlayers.every(
      (p) => p.isAllIn || p.hasFolded || p.currentBetInRound === this.currentBetToMatch
    );
  }

  _awardPotToSingleWinner(winnerPlayer) {
    let totalPot = 0;
    this.pots.forEach((pot) => (totalPot += pot.amount));
    winnerPlayer.collectWinnings(totalPot);
    this.winners = [
      {
        playerId: winnerPlayer.socketId,
        name: winnerPlayer.name,
        amountWon: totalPot,
        handDetails: { name: "Undisputed", cards: winnerPlayer.holeCards }, // Cards shown if desired
        potIndex: 0, // Main pot
      },
    ];
    this.pots = [{ amount: 0, eligiblePlayers: [] }]; // Clear pots
    this.isHandOver = true;
    this.currentBettingRound = BETTING_ROUNDS.SHOWDOWN; // Mark as showdown for state
    this._generateHandSummary(true); // Generate summary, winner known
  }

  _processShowdown() {
    this.isHandOver = true;
    this.currentBettingRound = BETTING_ROUNDS.SHOWDOWN;
    this._recalculatePots(); // Final pot calculation

    // Determine who needs to show cards (generally, players involved in the last contested pot)
    // For MVP, all players still in the hand at showdown will show.
    const playersForShowdown = this.playersInHand.filter((p) => !p.hasFolded && p.totalBetInHand > 0); // Must have contributed to pot

    if (playersForShowdown.length === 0) {
      // Should not happen if pots exist
      this.winners = [];
      this._generateHandSummary();
      return;
    }
    if (playersForShowdown.length === 1) {
      // Edge case if others folded on river after betting
      this._awardPotToSingleWinner(playersForShowdown[0]);
      return;
    }

    this.winners = []; // Reset winners before distributing new pots

    // Iterate through each pot, starting from the last side pot to the main pot
    for (let potIndex = this.pots.length - 1; potIndex >= 0; potIndex--) {
      const pot = this.pots[potIndex];
      if (pot.amount === 0) continue;

      const eligibleShowdownPlayersForPot = playersForShowdown.filter((p) =>
        pot.eligiblePlayers.includes(p.socketId)
      );

      if (eligibleShowdownPlayersForPot.length === 0) continue; // No one eligible for this pot

      if (eligibleShowdownPlayersForPot.length === 1) {
        // Single eligible player wins this pot
        const winner = eligibleShowdownPlayersForPot[0];
        winner.collectWinnings(pot.amount);
        this.winners.push({
          playerId: winner.socketId,
          name: winner.name,
          amountWon: pot.amount,
          handDetails: determineHoldemWinners(
            [{ id: winner.socketId, holeCards: winner.holeCards }],
            this.communityCards
          )[0]?.handDetails || { name: "Unknown", cards: [] },
          potIndex: potIndex,
        });
      } else {
        // Multiple players, evaluate hands for this pot
        const playerHandInputs = eligibleShowdownPlayersForPot.map((p) => ({
          id: p.socketId,
          holeCards: p.holeCards,
        }));

        const potWinnerResults = determineHoldemWinners(playerHandInputs, this.communityCards);
        const winningPlayersForPot = potWinnerResults.filter((r) => r.isWinner);

        if (winningPlayersForPot.length > 0) {
          const winAmountPerPlayer = pot.amount / winningPlayersForPot.length; // Handle chop
          winningPlayersForPot.forEach((winnerResult) => {
            const playerObj = this.playersInHand.find((p) => p.socketId === winnerResult.id);
            if (playerObj) {
              playerObj.collectWinnings(winAmountPerPlayer);
              this.winners.push({
                playerId: playerObj.socketId,
                name: playerObj.name,
                amountWon: winAmountPerPlayer,
                handDetails: winnerResult.handDetails,
                potIndex: potIndex,
              });
            }
          });
        }
      }
      pot.amount = 0; // Mark pot as distributed
    }
    this._generateHandSummary();
  }

  _generateHandSummary(isFoldWin = false) {
    const disclosedHoleCards = [];
    if (this.currentBettingRound === BETTING_ROUNDS.SHOWDOWN && !isFoldWin) {
      this.playersInHand.forEach((p) => {
        if (!p.hasFolded && p.totalBetInHand > 0) {
          // Only show cards of players who went to showdown and bet
          disclosedHoleCards.push({ playerId: p.socketId, name: p.name, cards: p.holeCards });
        }
      });
    } else if (isFoldWin && this.winners.length > 0) {
      // Optionally show winner's cards if they won by folds
      const winnerPlayer = this.playersInHand.find((p) => p.socketId === this.winners[0].playerId);
      if (winnerPlayer) {
        // Rule dependent: Do you show cards if everyone folds? For casual, maybe yes.
        // disclosedHoleCards.push({playerId: winnerPlayer.socketId, name: winnerPlayer.name, cards: winnerPlayer.holeCards});
      }
    }

    this.handSummaryForHistory = {
      board: [...this.communityCards],
      pots: this.pots.map((p) => ({ amount: p.amount, eligiblePlayers: p.eligiblePlayers })), // Store final pot states before distribution
      winners: [...this.winners], // Store who won what
      holeCardsShown: disclosedHoleCards, // Cards that were revealed
    };
  }

  // --- Getters ---
  getCurrentPlayerToAct() {
    if (this.isHandOver || this.turnOrder.length === 0 || this.currentPlayerIndexInTurnOrder === -1) {
      return null;
    }
    return this.turnOrder[this.currentPlayerIndexInTurnOrder];
  }

  _getHandState(perspectiveSocketId = null) {
    // FR-13: For hand history, needs player hole cards. This state is for active hand.
    return {
      isHandOver: this.isHandOver,
      communityCards: [...this.communityCards],
      pots: this.pots.map((p) => ({ amount: p.amount, eligiblePlayers: p.eligiblePlayers })),
      currentBettingRound: this.currentBettingRound,
      currentPlayerSocketIdToAct: this.getCurrentPlayerToAct()?.socketId || null,
      lastAggressorSocketId: this.lastAggressor?.socketId || null,
      currentBetToMatch: this.currentBetToMatch,
      minRaiseAmount: this.minRaiseAmount, // Useful for UI bet slider
      dealerSeatIndex: this.dealerSeatIndex,
      winners: this.isHandOver ? [...this.winners] : [],
      players: this.playersInHand.map((p) => {
        const publicState = p.getPublicState();
        if (
          perspectiveSocketId === p.socketId ||
          (this.isHandOver && this.winners.some((w) => w.playerId === p.socketId && w.amountWon > 0))
        ) {
          // Show hole cards to player themselves, or if they won and hand is over (showdown)
          return { ...publicState, holeCards: [...p.holeCards] };
        } else if (
          this.isHandOver &&
          this.handSummaryForHistory?.holeCardsShown?.find((hc) => hc.playerId === p.socketId)
        ) {
          // Show cards if they were part of showdown reveal
          return { ...publicState, holeCards: [...p.holeCards] };
        }
        return publicState; // Others don't see hole cards unless revealed
      }),
      turnOrderIds: this.turnOrder.map((p) => p.socketId), // For UI highlighting or sequencing
    };
  }
}

module.exports = { Hand, BETTING_ROUNDS };
