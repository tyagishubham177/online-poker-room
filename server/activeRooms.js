// server/activeRooms.js

// This will store all active Room instances, keyed by roomId
const activeRooms = new Map();

function addRoom(roomInstance) {
  if (roomInstance && roomInstance.id) {
    activeRooms.set(roomInstance.id, roomInstance);
    return true;
  }
  return false;
}

function getRoom(roomId) {
  return activeRooms.get(roomId);
}

function removeRoom(roomId) {
  return activeRooms.delete(roomId);
}

function getAllRooms() {
  return Array.from(activeRooms.values());
}

module.exports = {
  addRoom,
  getRoom,
  removeRoom,
  getAllRooms,
  // Expose the map directly if needed for advanced iteration, but prefer methods.
  // _activeRoomsMap: activeRooms
};
