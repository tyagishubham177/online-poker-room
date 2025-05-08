// server/game/constants.js
const SUITS = ["H", "D", "C", "S"]; // Hearts, Diamonds, Clubs, Spades
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]; // T for Ten

// You can also define card objects if you prefer, e.g., { rank: 'A', suit: 'S', value: 14 }
// For now, strings like "AS" (Ace of Spades) will be simple and effective.

module.exports = {
  SUITS,
  RANKS,
};
