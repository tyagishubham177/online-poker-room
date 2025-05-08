// server/game/Deck.js
const crypto = require("crypto"); // Node.js native crypto module for CSPRNG
const { SUITS, RANKS } = require("./constants");

class Deck {
  constructor() {
    this.cards = [];
    this.initialize();
    this.shuffle(); // Shuffle when a new deck is created
  }

  initialize() {
    this.cards = []; // Clear existing cards if any
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push(rank + suit); // e.g., "AH", "KD", "2C"
      }
    }
  }

  // Fisher-Yates shuffle algorithm using a CSPRNG
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      // Generate a random number j such that 0 <= j <= i
      // crypto.randomBytes(4) gives 4 random bytes (32 bits)
      // .readUInt32BE(0) reads it as an unsigned 32-bit integer
      // % (i + 1) scales it to the desired range
      const j = crypto.randomBytes(4).readUInt32BE(0) % (i + 1);
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]]; // Swap
    }
  }

  dealCard() {
    if (this.cards.length === 0) {
      // Or you could throw an error, or re-initialize and re-shuffle
      console.warn("Deck is empty! Cannot deal card.");
      return null;
    }
    return this.cards.pop(); // Removes and returns the last card (top of the deck)
  }

  deal(numCards) {
    const dealtCards = [];
    for (let i = 0; i < numCards; i++) {
      const card = this.dealCard();
      if (card) {
        dealtCards.push(card);
      } else {
        break; // Stop if deck runs out
      }
    }
    return dealtCards;
  }

  remainingCards() {
    return this.cards.length;
  }
}

module.exports = Deck;
