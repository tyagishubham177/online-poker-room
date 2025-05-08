// server/socketHandlers/index.js
const { getRoom, addRoom, removeRoom } = require("../activeRooms");
const initializeRoomEventHandlers = require("./roomEvents");
const initializeGamePlayEventHandlers = require("./gamePlayEvents");
const Room = require("../game/Room"); // To create new Room instances

function initializeSocketHandlers(io) {
  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Pass io, socket, and room management functions to handlers
    const context = {
      io,
      socket,
      getRoom,
      addRoom,
      removeRoom,
      Room, // Pass the Room class for creating new rooms
    };

    initializeRoomEventHandlers(context);
    initializeGamePlayEventHandlers(context);

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
      // Clean up player from any room they might be in
      const room = getRoom(socket.roomId); // Assuming socket.roomId is set upon joining
      if (room) {
        const removalResult = room.removePlayer(socket.id);
        console.log(`Player ${socket.id} removed from room ${room.id} on disconnect.`);
        // Broadcast updated room state
        io.to(room.id).emit("roomStateUpdate", room.getRoomState());
        io.to(room.id).emit("playerLeft", {
          playerId: socket.id,
          playerName: removalResult.playerName,
          newHostId: room.hostSocketId,
        });

        if (room.players.size === 0) {
          console.log(`Room ${room.id} is now empty, removing.`);
          removeRoom(room.id);
        } else if (
          room.players.size < 2 &&
          (room.gameState === "playing" || room.gameState === "hand_ended")
        ) {
          // If game was ongoing and drops below 2 players
          room.endCurrentHandForcefully("Player disconnected, not enough players.");
          room.gameState = "waiting";
          io.to(room.id).emit("handEnded", room.getHandStateForClient()); // Send final hand state
          io.to(room.id).emit("roomStateUpdate", room.getRoomState());
          io.to(room.id).emit("gameMessage", {
            text: "Hand ended due to player disconnect. Waiting for more players.",
          });
        }
      }
    });
  });
}

module.exports = initializeSocketHandlers;
