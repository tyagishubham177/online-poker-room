// server/socketHandlers/roomEvents.js

module.exports = function initializeRoomEventHandlers(context) {
  const { io, socket, getRoom, addRoom, removeRoom, Room } = context;

  // FR-1, FR-2, FR-3
  socket.on("createRoom", (data = {}) => {
    console.log(`SERVER: Received 'createRoom' event from ${socket.id} with data:`, data); // <<< ADD THIS
    try {
      const roomConfig = {
        name: data.name, // FR-1
        smallBlind: data.smallBlind, // FR-2
        bigBlind: data.bigBlind, // FR-2
        ante: data.ante || 0, // FR-2
        minBuyInMultiplier: data.minBuyInMultiplier, // FR-3
        maxBuyInMultiplier: data.maxBuyInMultiplier, // FR-3
        turnTimer: data.turnTimer, // FR-10
        // tableCapacity is fixed (FR-4)
      };
      // Filter out undefined values to use defaults in Room constructor
      const filteredConfig = Object.fromEntries(
        Object.entries(roomConfig).filter(([_, v]) => v !== undefined)
      );

      const room = new Room(socket.id, filteredConfig);
      addRoom(room);
      socket.join(room.id);
      socket.roomId = room.id; // Store roomId on socket for easy access

      console.log(`Player ${socket.id} created room ${room.id} (${room.name})`);
      socket.emit("roomCreated", {
        roomId: room.id,
        roomName: room.name,
        hostId: room.hostSocketId,
        initialRoomState: room.getRoomState(),
      });
    } catch (error) {
      console.error("SERVER: Error in 'createRoom' handler:", error); // <<< ADD THIS (if not already there)
      socket.emit("errorCreatingRoom", { message: error.message || "Could not create room." });
    }
  });

  // FR-5, FR-6
  socket.on("joinRoom", (data) => {
    try {
      const { roomId, playerName, buyInAmount, seatIndex } = data;
      const room = getRoom(roomId);

      if (!room) {
        socket.emit("roomNotFound", { roomId });
        return;
      }
      if (room.gameState === "session_ended" || room.gameState === "session_ended_flushed") {
        socket.emit("errorJoiningRoom", { message: "This session has ended." });
        return;
      }

      const result = room.addPlayer(socket.id, playerName, buyInAmount, seatIndex);

      if (result.error) {
        socket.emit("errorJoiningRoom", { message: result.error });
        return;
      }

      socket.join(roomId);
      socket.roomId = roomId; // Store roomId on socket

      console.log(
        `Player ${socket.id} (${result.player.name}) joined room ${roomId}, seat ${result.seatIndex}`
      );
      socket.emit("joinedRoom", { roomId, player: result.player, roomState: room.getRoomState() });
      // Broadcast to other players in the room
      socket.to(roomId).emit("playerJoined", { player: result.player, roomState: room.getRoomState() });
      socket.to(roomId).emit("gameMessage", { text: `${result.player.name} has joined the table.` });
    } catch (error) {
      console.error(`Error joining room ${data.roomId}:`, error);
      socket.emit("errorJoiningRoom", { message: "An unexpected error occurred." });
    }
  });

  socket.on("leaveRoom", () => {
    try {
      if (!socket.roomId) return;
      const room = getRoom(socket.roomId);
      if (room) {
        const removalResult = room.removePlayer(socket.id);
        console.log(`Player ${socket.id} left room ${room.id}`);
        socket.leave(room.id);

        // Notify remaining players
        io.to(room.id).emit("playerLeft", {
          playerId: socket.id,
          playerName: removalResult.playerName,
          newHostId: room.hostSocketId,
          roomState: room.getRoomState(),
        });
        io.to(room.id).emit("gameMessage", {
          text: `${removalResult.playerName || "A player"} has left the table.`,
        });

        if (room.players.size === 0) {
          console.log(`Room ${room.id} is now empty after player left, removing.`);
          removeRoom(room.id);
        } else if (
          room.players.size < 2 &&
          (room.gameState === "playing" || room.gameState === "hand_ended")
        ) {
          room.endCurrentHandForcefully("Player left, not enough players.");
          room.gameState = "waiting";
          io.to(room.id).emit("handEnded", room.getHandStateForClient());
          io.to(room.id).emit("roomStateUpdate", room.getRoomState());
          io.to(room.id).emit("gameMessage", {
            text: "Hand ended due to player leaving. Waiting for more players.",
          });
        }
      }
      socket.roomId = null; // Clear stored roomId
      socket.emit("leftRoom", { success: true });
    } catch (error) {
      console.error(`Error leaving room ${socket.roomId}:`, error);
      socket.emit("errorLeavingRoom", { message: "An unexpected error occurred." });
    }
  });

  // FR-2, FR-3 (update config)
  socket.on("updateRoomConfig", (newConfig) => {
    try {
      if (!socket.roomId) return;
      const room = getRoom(socket.roomId);
      if (!room) return;

      const result = room.updateConfig(newConfig, socket.id); // Pass socket.id for host check
      if (result.error) {
        socket.emit("configUpdateFailed", { message: result.error });
        return;
      }
      io.to(room.id).emit("roomConfigUpdated", {
        newConfig: result.newConfig,
        roomState: room.getRoomState(),
      });
      io.to(room.id).emit("gameMessage", { text: `Room settings updated by host.` });
    } catch (error) {
      console.error(`Error updating config for room ${socket.roomId}:`, error);
      socket.emit("configUpdateFailed", { message: "An unexpected error occurred." });
    }
  });

  // FR-14, FR-15 (End Session - Payout)
  socket.on("requestPayoutSheet", () => {
    try {
      if (!socket.roomId) return;
      const room = getRoom(socket.roomId);
      if (!room) return;

      // Only host can initiate the end-of-session process that changes game state
      // However, any player might request to view it if already generated.
      // For MVP, let's assume only host triggers this action which also generates it.
      if (socket.id !== room.hostSocketId) {
        socket.emit("payoutError", { message: "Only the host can end the session and generate payouts." });
        return;
      }

      const result = room.generatePayoutLedger(socket.id);
      if (result.error) {
        socket.emit("payoutError", { message: result.error });
        return;
      }
      // Send to all players in the room
      io.to(room.id).emit("payoutSheetGenerated", {
        ledgerText: result.ledgerText,
        ledgerCSV: result.ledgerCSV,
      });
      io.to(room.id).emit("gameMessage", { text: `Session ended by host. Payout sheet generated.` });
      io.to(room.id).emit("roomStateUpdate", room.getRoomState()); // gameState is now 'session_ended'
    } catch (error) {
      console.error(`Error generating payout for room ${socket.roomId}:`, error);
      socket.emit("payoutError", { message: "An unexpected error occurred." });
    }
  });

  socket.on("confirmEndSessionAndFlush", () => {
    try {
      if (!socket.roomId) return;
      const room = getRoom(socket.roomId);
      if (!room) return;

      if (socket.id !== room.hostSocketId) {
        socket.emit("flushError", { message: "Only host can finalize session end." });
        return;
      }
      if (room.gameState !== "session_ended") {
        socket.emit("flushError", {
          message: "Payout sheet must be generated first or session not ready to flush.",
        });
        return;
      }

      room.endSessionAndFlush(socket.id);
      // Notify all players room is closing, then they should be disconnected or moved by client
      io.to(room.id).emit("sessionFlushed", { message: "Session has ended. This room will now close." });

      // Clean up: remove room, disconnect sockets (or let client handle disconnect)
      // Sockets in the room will be disconnected, or client can navigate away
      const socketsInRoom = io.sockets.adapter.rooms.get(room.id);
      if (socketsInRoom) {
        socketsInRoom.forEach((socketIdInRoom) => {
          const clientSocket = io.sockets.sockets.get(socketIdInRoom);
          if (clientSocket) {
            // clientSocket.leave(room.id); // Client should handle this upon 'sessionFlushed'
            // clientSocket.disconnect(true); // Force disconnect
          }
        });
      }
      removeRoom(room.id);
      console.log(`Room ${room.id} flushed and removed.`);
    } catch (error) {
      console.error(`Error flushing session for room ${socket.roomId}:`, error);
      socket.emit("flushError", { message: "An unexpected error occurred during flushing." });
    }
  });

  socket.on("fetchLastHands", () => {
    // FR-13
    try {
      if (!socket.roomId) return;
      const room = getRoom(socket.roomId);
      if (!room) return;

      const history = room.getLast5HandsForPlayer(socket.id);
      socket.emit("lastHandsHistory", { history });
    } catch (error) {
      console.error(`Error fetching hand history for room ${socket.roomId}:`, error);
      socket.emit("historyError", { message: "Could not fetch hand history." });
    }
  });
};
