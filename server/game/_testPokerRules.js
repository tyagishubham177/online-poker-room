// server/game/_testPokerRules.js
const { evaluateHoldemHand, determineHoldemWinners } = require("./pokerRules");

console.log("--- Testing Poker Rules (with pokersolver) ---");

// Test 1: Evaluate a single hand - Straight Flush
let holeCards1 = ["AH", "KH"]; // Ace-King of Hearts
let communityCards1 = ["QH", "JH", "TH", "2S", "3D"]; // QJTH on board
let result1 = evaluateHoldemHand(holeCards1, communityCards1);
console.log("\nHand 1 (Royal Flush - part of Straight Flush family):", holeCards1, "+", communityCards1);
console.log("Evaluation Name:", result1.name); // e.g., "Straight Flush"
console.log("Evaluation Descr:", result1.descr); // e.g., "Ace High Straight Flush" or "Royal Flush"
console.log("Evaluation Cards:", result1.cards); // e.g., [ 'Ah', 'Kh', 'Qh', 'Jh', 'Th' ]
// pokersolver might call it "Royal Flush" or "Straight Flush, Ace High"

// Test 2: Evaluate a single hand - Four of a Kind
let holeCards2 = ["AS", "AD"]; // Pair of Aces
let communityCards2 = ["AC", "AH", "5S", "6H", "7D"]; // Two more Aces on board
let result2 = evaluateHoldemHand(holeCards2, communityCards2);
console.log("\nHand 2 (Four of a Kind):", holeCards2, "+", communityCards2);
console.log("Evaluation Name:", result2.name); // "Four of a Kind"
console.log("Evaluation Descr:", result2.descr); // "Four of a Kind, Aces"
console.log("Evaluation Cards:", result2.cards);

// Test 3: Evaluate a single hand - Full House
let holeCards3 = ["KS", "KD"]; // Pair of Kings
let communityCards3 = ["KC", "QH", "QS", "2D", "3C"]; // One King, Pair of Queens
let result3 = evaluateHoldemHand(holeCards3, communityCards3);
console.log("\nHand 3 (Full House):", holeCards3, "+", communityCards3);
console.log("Evaluation Name:", result3.name); // "Full House"
console.log("Evaluation Descr:", result3.descr); // "Full House, Kings over Queens"
console.log("Evaluation Cards:", result3.cards);

// Test 4: Evaluate a single hand - Flush (Ace high)
let holeCards4 = ["AH", "2H"];
let communityCards4 = ["KH", "QH", "7H", "5S", "6D"];
let result4 = evaluateHoldemHand(holeCards4, communityCards4);
console.log("\nHand 4 (Flush):", holeCards4, "+", communityCards4);
console.log("Evaluation Name:", result4.name); // "Flush"
console.log("Evaluation Descr:", result4.descr); // "Flush, Ace High"
console.log("Evaluation Cards:", result4.cards);

// Test 5: Evaluate a single hand - Straight (Ace high)
let holeCards5 = ["AH", "KS"];
let communityCards5 = ["QC", "JD", "TH", "2H", "3D"]; // A, K, Q, J, T
let result5 = evaluateHoldemHand(holeCards5, communityCards5);
console.log("\nHand 5 (Straight):", holeCards5, "+", communityCards5);
console.log("Evaluation Name:", result5.name); // "Straight"
console.log("Evaluation Descr:", result5.descr); // "Straight, Ace High"
console.log("Evaluation Cards:", result5.cards);

console.log("\n--- Testing Winner Determination (with pokersolver) ---");
// Test 6: Determine Winners - Simple case
const playersForTest1 = [
  { id: "player1", holeCards: ["AH", "KH"] }, // Royal Flush
  { id: "player2", holeCards: ["AS", "AD"] }, // Pair of Aces (will be 2 pair with board)
];
const communityForTest1 = ["QH", "JH", "TH", "2C", "2D"]; // Board for Royal Flush, and a pair for player2
const winners1 = determineHoldemWinners(playersForTest1, communityForTest1);
console.log("\nWinner Test 1:", JSON.stringify(winners1, null, 2));
// Expected: player1 isWinner: true

// Test 7: Determine Winners - Split pot (identical best hands from board)
const playersForTest2 = [
  { id: "playerA", holeCards: ["2H", "3S"] }, // Uses board straight
  { id: "playerB", holeCards: ["2D", "4C"] }, // Uses board straight
];
const communityForTest2 = ["AS", "KS", "QS", "JS", "TS"]; // Board is a Royal Flush
const winners2 = determineHoldemWinners(playersForTest2, communityForTest2);
console.log("\nWinner Test 2 (Split Pot - Board Plays):", JSON.stringify(winners2, null, 2));
// Expected: playerA and playerB both isWinner: true (both play the board)

// Test 8: Determine Winners - Kicker plays
const playersForTest3 = [
  { id: "playerX", holeCards: ["AH", "QS"] }, // AQ
  { id: "playerY", holeCards: ["AD", "JC"] }, // AJ
];
// Board: A K T D (no pairs on board that help make a better hand than one pair of Aces)
const communityForTest3 = ["AC", "KD", "TD", "7H", "6S"];
const winners3 = determineHoldemWinners(playersForTest3, communityForTest3);
console.log("\nWinner Test 3 (Kicker):", JSON.stringify(winners3, null, 2));
// Expected: playerX isWinner: true (Aces with Q kicker beats Aces with J kicker)

// Test 9: More complex scenario
const playersForTest4 = [
  { id: "Alice", holeCards: ["6S", "7S"] }, // Straight flush 6-T
  { id: "Bob", holeCards: ["AS", "KS"] }, // Nut flush
  { id: "Charlie", holeCards: ["8H", "8D"] }, // Set of 8s
];
const communityForTest4 = ["8S", "9S", "TS", "2H", "3C"]; // Board makes straight flush for Alice
const winners4 = determineHoldemWinners(playersForTest4, communityForTest4);
console.log("\nWinner Test 4 (Complex):", JSON.stringify(winners4, null, 2));
// Expected: Alice isWinner: true

// Test 10: Two players with flushes, one higher
const playersForTest5 = [
  { id: "Dave", holeCards: ["AS", "JS"] }, // Ace-Jack Flush
  { id: "Eve", holeCards: ["KS", "QS"] }, // King-Queen Flush
];
const communityForTest5 = ["TS", "7S", "2S", "4H", "5D"]; // Board has 3 spades
const winners5 = determineHoldemWinners(playersForTest5, communityForTest5);
console.log("\nWinner Test 5 (Higher Flush):", JSON.stringify(winners5, null, 2));
// Expected: Dave isWinner: true
