// server/socketHandlers/gamePlayEvents.js

module.exports = function initializeGamePlayEventHandlers(context) {
  const { io, socket, getRoom } = context;

  socket.on("startGame", () => {
    try {
      if (!socket.roomId) return;
      const room = getRoom(socket.roomId);
      if (!room) return;

      const result = room.startGameRequest(socket.id); // Host check is inside
      if (result.error) {
        socket.emit("gameStartFailed", { message: result.error });
        return;
      }
      // startGameRequest/startNewHand now returns initial hand state and room state
      io.to(room.id).emit("gameStarted", {
        handState: room.getHandStateForClient(),
        roomState: result.roomState,
      });
      io.to(room.id).emit("gameMessage", { text: "New hand started!" });
      // Send private hole cards to each player individually
      room.players.forEach((player) => {
        const playerSocket = io.sockets.sockets.get(player.socketId);
        if (playerSocket && room.currentHand) {
          playerSocket.emit("dealHoleCards", {
            holeCards: player.holeCards, // Player object has its hole cards
            handNumber: room.handHistory.length + 1, // Or some hand ID
          });
        }
      });
      io.to(room.id).emit("nextTurn", {
        currentPlayerSocketId: room.currentTurnSocketId,
        timeRemaining: room.config.turnTimer, // Send initial turn time
      });
    } catch (error) {
      console.error(`Error starting game in room ${socket.roomId}:`, error);
      socket.emit("gameStartFailed", { message: "An unexpected error occurred." });
    }
  });

  socket.on("playerAction", (data) => {
    try {
      const { action, amount } = data;
      if (!socket.roomId) return;
      const room = getRoom(socket.roomId);
      if (!room || !room.currentHand) return;

      const result = room.handlePlayerAction(socket.id, action, amount);
      if (result.error) {
        socket.emit("actionFailed", { message: result.error });
        // Re-emit nextTurn for the same player if action failed, so their timer UI might reset/continue
        if (room.currentTurnSocketId === socket.id) {
          socket.emit("nextTurn", {
            currentPlayerSocketId: room.currentTurnSocketId,
            timeRemaining: room.config.turnTimer, // Or remaining time if timer was paused
          });
        }
        return;
      }

      io.to(room.id).emit("gameStateUpdate", { handState: result.handState, roomState: result.roomState });
      const actingPlayer = room.players.get(socket.id);
      io.to(room.id).emit("gameMessage", {
        text: `${actingPlayer?.name || "Player"} ${action}s ${
          action === "bet" || action === "raise" ? amount || "" : ""
        }.`,
      });

      if (room.currentHand.isHandOver) {
        io.to(room.id).emit("handEnded", { handState: result.handState, roomState: result.roomState });
        // Optionally auto-start next hand after a delay
        if (room.players.size >= 2) {
          // Only if enough players
          setTimeout(() => {
            const roomStillExists = getRoom(room.id); // Check if room wasn't closed
            if (roomStillExists && roomStillExists.gameState === "hand_ended") {
              // Ensure it's still in this state
              const startResult = roomStillExists.startNewHand();
              if (startResult && !startResult.error) {
                io.to(room.id).emit("gameStarted", {
                  handState: roomStillExists.getHandStateForClient(),
                  roomState: roomStillExists.getRoomState(),
                });
                io.to(room.id).emit("gameMessage", { text: "New hand started!" });
                roomStillExists.players.forEach((p) => {
                  const pSocket = io.sockets.sockets.get(p.socketId);
                  if (pSocket && roomStillExists.currentHand)
                    pSocket.emit("dealHoleCards", { holeCards: p.holeCards });
                });
                io.to(room.id).emit("nextTurn", {
                  currentPlayerSocketId: roomStillExists.currentTurnSocketId,
                  timeRemaining: roomStillExists.config.turnTimer,
                });
              } else if (startResult && startResult.error) {
                io.to(room.id).emit("gameMessage", {
                  text: `Could not start next hand: ${startResult.error}`,
                });
                roomStillExists.gameState = "waiting"; // Set to waiting
                io.to(room.id).emit("roomStateUpdate", roomStillExists.getRoomState());
              }
            }
          }, 5000); // 5 second delay before next hand
        } else {
          room.gameState = "waiting"; // Not enough players, go to waiting
          io.to(room.id).emit("roomStateUpdate", room.getRoomState());
          io.to(room.id).emit("gameMessage", { text: "Not enough players to start a new hand. Waiting..." });
        }
      } else {
        io.to(room.id).emit("nextTurn", {
          currentPlayerSocketId: room.currentTurnSocketId,
          timeRemaining: room.config.turnTimer, // Send initial turn time
        });
      }
    } catch (error) {
      console.error(`Error processing player action in room ${socket.roomId}:`, error);
      socket.emit("actionFailed", { message: "An unexpected error occurred." });
    }
  });

  // FR-7 (Rebuy)
  socket.on("requestRebuy", (data) => {
    // Player requests
    try {
      const { amount } = data;
      if (!socket.roomId) return;
      const room = getRoom(socket.roomId);
      if (!room) return;

      const result = room.requestRebuy(socket.id, amount);
      if (result.error) {
        socket.emit("rebuyResult", { success: false, message: result.error });
        return;
      }
      // Notify host
      const hostSocket = io.sockets.sockets.get(result.hostId);
      if (hostSocket) {
        hostSocket.emit("rebuyRequestedForApproval", {
          playerId: result.playerId,
          playerName: result.playerName,
          requestedAmount: result.requestedAmount,
        });
      }
      socket.emit("rebuyResult", { success: true, message: "Rebuy request sent to host." });
    } catch (error) {
      console.error(`Error requesting rebuy in room ${socket.roomId}:`, error);
      socket.emit("rebuyResult", { success: false, message: "Error requesting rebuy." });
    }
  });

  socket.on("approveRebuy", (data) => {
    // Host approves
    try {
      const { targetPlayerId } = data;
      if (!socket.roomId) return;
      const room = getRoom(socket.roomId);
      if (!room) return;

      const result = room.approveRebuy(socket.id, targetPlayerId);
      if (result.error) {
        socket.emit("rebuyApprovalResult", {
          success: false,
          message: result.error,
          playerId: targetPlayerId,
        });
        return;
      }
      io.to(room.id).emit("playerRebought", { player: result.player, roomState: result.roomState });
      io.to(room.id).emit("gameMessage", { text: `${result.player.name} has re-bought.` });
      const targetSocket = io.sockets.sockets.get(targetPlayerId);
      if (targetSocket) targetSocket.emit("rebuyApproved", { newStack: result.player.stack });
    } catch (error) {
      console.error(`Error approving rebuy in room ${socket.roomId}:`, error);
      socket.emit("rebuyApprovalResult", { success: false, message: "Error approving rebuy." });
    }
  });

  socket.on("denyRebuy", (data) => {
    // Host denies
    try {
      const { targetPlayerId } = data;
      if (!socket.roomId) return;
      const room = getRoom(socket.roomId);
      if (!room) return;

      const result = room.denyRebuy(socket.id, targetPlayerId);
      if (result.error) {
        socket.emit("rebuyDenialResult", { success: false, message: result.error, playerId: targetPlayerId });
        return;
      }
      io.to(room.id).emit("gameMessage", { text: `Rebuy for player was denied by host.` });
      const targetSocket = io.sockets.sockets.get(targetPlayerId);
      if (targetSocket)
        targetSocket.emit("rebuyDenied", { message: "Your rebuy request was denied by the host." });
      socket.emit("rebuyDenialResult", { success: true, message: "Rebuy denied." });
    } catch (error) {
      console.error(`Error denying rebuy in room ${socket.roomId}:`, error);
      socket.emit("rebuyDenialResult", { success: false, message: "Error denying rebuy." });
    }
  });
};
