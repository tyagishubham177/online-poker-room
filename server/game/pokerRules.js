// server/game/pokerRules.js
const Hand = require("pokersolver").Hand; // Import the Hand class from pokersolver

/**
 * Evaluates a single Texas Hold'em hand (2 hole cards + 5 community cards).
 * @param {string[]} holeCards - Array of 2 cards, e.g., ["As", "Kd"]
 * @param {string[]} communityCards - Array of 3 to 5 cards, e.g., ["2h", "3c", "4d", "5s", "6h"]
 * @returns {object} An object describing the hand.
 *          {
 *              handObj: The pokersolver Hand object,
 *              name: string (e.g., "Straight Flush"),
 *              descr: string (e.g., "Ace High Straight Flush"),
 *              rank: number (internal rank from pokersolver),
 *              toString: function (gives card string like "As, Ks, Qs, Js, Ts")
 *          }
 */
function evaluateHoldemHand(holeCards, communityCards) {
  if (!holeCards || holeCards.length !== 2) {
    throw new Error("Invalid hole cards. Must be an array of 2 cards.");
  }
  if (!communityCards || communityCards.length < 3 || communityCards.length > 5) {
    throw new Error("Invalid community cards. Must be an array of 3 to 5 cards.");
  }

  // pokersolver expects card format like "As", "Th", "2c" (rank followed by lowercase suit).
  // Our Deck.js produces "AH", "TD". So we need to format them.
  const formatCardForSolver = (cardStr) => {
    if (cardStr.length !== 2) return cardStr; // safety
    let rank = cardStr[0];
    if (rank === "T") rank = "T"; // pokersolver uses 'T' for Ten internally, not '10'
    let suit = cardStr[1].toLowerCase();
    return rank + suit;
  };

  const allPlayerCards = holeCards.map(formatCardForSolver);
  const boardCards = communityCards.map(formatCardForSolver);

  const hand = Hand.solve([...allPlayerCards, ...boardCards]);
  return {
    handObj: hand, // The actual pokersolver Hand object
    name: hand.name, // e.g., "Straight Flush", "Pair"
    descr: hand.descr, // e.g., "Ace High Straight Flush", "Pair, phénomène" (can be localized)
    rank: hand.rank, // Internal numeric rank, higher is better
    toString: () => hand.toString(), // Cards in the hand, e.g. "As, Ks, Qs, Js, Ts"
    cards: hand.cards.map((c) => c.toString()), // Array of card strings in the hand
  };
}

/**
 * Compares multiple hands and determines the winner(s) in Texas Hold'em.
 * @param {Array<{id: string, holeCards: string[]}>} playersHandsInput - Array of player objects,
 *        each with an id and their 2 holeCards.
 * @param {string[]} communityCards - Array of 5 community cards.
 * @returns {Array<{id: string, handDetails: object, isWinner: boolean}>}
 *          An array indicating winners and their hand details.
 */
function determineHoldemWinners(playersHandsInput, communityCards) {
  if (!playersHandsInput || playersHandsInput.length === 0) return [];
  if (!communityCards || communityCards.length !== 5) {
    throw new Error("Invalid community cards for winner determination. Must be 5 cards.");
  }

  const formatCardForSolver = (cardStr) => {
    if (cardStr.length !== 2) return cardStr;
    let rank = cardStr[0];
    // pokersolver uses 'T' for Ten. 'J', 'Q', 'K', 'A' are fine.
    let suit = cardStr[1].toLowerCase();
    return rank + suit;
  };

  const boardCards = communityCards.map(formatCardForSolver);

  const evaluatedHands = playersHandsInput.map((player) => {
    const playerCards = player.holeCards.map(formatCardForSolver);
    const fullHand = Hand.solve([...playerCards, ...boardCards]);
    return {
      id: player.id,
      solverHand: fullHand, // Store the pokersolver Hand object
      name: fullHand.name,
      descr: fullHand.descr,
      rank: fullHand.rank,
      cards: fullHand.cards.map((c) => c.toString()), // Array of cards in the best 5-card hand
    };
  });

  if (evaluatedHands.length === 0) return [];

  // Use Hand.winners() to find the best hand(s)
  const winningSolverHands = Hand.winners(evaluatedHands.map((h) => h.solverHand));

  // Map back to our desired output structure
  const results = evaluatedHands.map((evalHand) => {
    // Check if this hand is one of the winning hands
    // Need to compare by the solverHand object's properties or if it's the same instance.
    // `Hand.winners` returns an array of the actual Hand objects that won.
    const isWinner = winningSolverHands.some(
      (winnerHand) =>
        winnerHand.toString() === evalHand.solverHand.toString() && // Compare card strings
        winnerHand.rank === evalHand.solverHand.rank // and rank
    );

    return {
      id: evalHand.id,
      handDetails: {
        name: evalHand.name,
        descr: evalHand.descr,
        rank: evalHand.rank, // You might not need to expose this internal rank
        cards: evalHand.cards, // The actual 5 cards making the hand
      },
      isWinner: isWinner,
    };
  });

  return results;
}

module.exports = {
  evaluateHoldemHand,
  determineHoldemWinners,
  // We will add pot logic (side pots) functions here later
};
