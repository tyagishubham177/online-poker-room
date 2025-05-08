// server/game/_testDeck.js
const Deck = require("./Deck");

console.log("--- Testing Deck ---");

// Test 1: Create a new deck
const deck1 = new Deck();
console.log("New deck created. Number of cards:", deck1.remainingCards());
// console.log("Initial deck (shuffled):", deck1.cards); // Can be long, uncomment to see

// Test 2: Deal some cards
console.log("\nDealing 5 cards:");
const hand1 = deck1.deal(5);
console.log("Hand 1:", hand1);
console.log("Remaining cards in deck1:", deck1.remainingCards());

// Test 3: Deal more cards
console.log("\nDealing 2 cards for flop:");
const flop = deck1.deal(2); // Mistake in poker, should be 3, but good for testing deal method
console.log("Flop (example):", flop);
console.log("Remaining cards in deck1:", deck1.remainingCards());

// Test 4: Ensure shuffling creates different order
const deck2 = new Deck();
console.log("\nCreated a second deck (deck2).");
console.log("First 5 cards of deck1 (after some deals):", deck1.cards.slice(-5)); // Last 5 are next to be dealt
console.log("First 5 cards of deck2 (newly shuffled):", deck2.cards.slice(-5));
// Note: There's a tiny chance they could be the same, but highly unlikely for 52 cards.

// Test 5: Deal all cards
console.log("\nDealing all remaining cards from deck1:");
let count = 0;
let card;
const dealtFromDeck1 = [];
while ((card = deck1.dealCard()) !== null) {
  dealtFromDeck1.push(card);
  count++;
}
console.log(`Dealt ${count} more cards. Total dealt: ${hand1.length + flop.length + count}`);
console.log("Remaining cards in deck1:", deck1.remainingCards());
console.log("Is deck1 empty now?", deck1.dealCard() === null);

// Test 6: Check uniqueness of cards in a full dealt deck
const allCardsDealtFromDeck2 = deck2.deal(52);
const uniqueCards = new Set(allCardsDealtFromDeck2);
console.log("\nDealt 52 cards from deck2.");
console.log("Number of cards dealt:", allCardsDealtFromDeck2.length);
console.log("Number of unique cards dealt:", uniqueCards.size);
if (allCardsDealtFromDeck2.length === 52 && uniqueCards.size === 52) {
  console.log("Deck integrity check: PASSED (52 unique cards)");
} else {
  console.error("Deck integrity check: FAILED");
}
