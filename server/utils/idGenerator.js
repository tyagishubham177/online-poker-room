// server/utils/idGenerator.js
const crypto = require("crypto");

function generateRoomId() {
  // Generates a 6-character alphanumeric ID
  // FR-1: 6-char ID
  return crypto.randomBytes(3).toString("hex").toUpperCase(); // 3 bytes = 6 hex characters
}

function generatePlayerId() {
  // Could be simpler for internal use, or more robust if needed
  return crypto.randomBytes(8).toString("hex");
}

module.exports = {
  generateRoomId,
  generatePlayerId,
};
