const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket']
});

// --- LOGICA PENTRU GESTIONAREA CULORILOR (PE CAMERE) ---
const allColors = ['red', 'blue', 'green', 'yellow'];
const roomColors = {}; // { roomCode: ['red', 'blue'] }
const roomAssignments = {}; // { roomCode: { socketId: 'red' } }
const roomActivePlayers = {}; // { roomCode: [socketId1, socketId2] }
const roomTurnIndex = {}; // { roomCode: 0 }

const ensureRoomState = (roomCode) => {
  if (!roomColors[roomCode]) {
    roomColors[roomCode] = [];
  }
  if (!roomAssignments[roomCode]) {
    roomAssignments[roomCode] = {};
  }
  if (!roomActivePlayers[roomCode]) {
    roomActivePlayers[roomCode] = [];
  }
  if (roomTurnIndex[roomCode] === undefined) {
    roomTurnIndex[roomCode] = 0;
  }
};

const cleanupRoomState = (roomCode) => {
  const hasPlayers = roomActivePlayers[roomCode] && roomActivePlayers[roomCode].length > 0;
  const hasAssignments = roomAssignments[roomCode] && Object.keys(roomAssignments[roomCode]).length > 0;

  if (!hasPlayers && !hasAssignments) {
    delete roomColors[roomCode];
    delete roomAssignments[roomCode];
    delete roomActivePlayers[roomCode];
    delete roomTurnIndex[roomCode];
  }
};

io.on('connection', (socket) => {
  console.log(`Jucător conectat: ${socket.id}`);

  // 0. INTRARE IN CAMERA: Jucătorul se alătură unei camere
  socket.on('joinRoom', (roomCode) => {
    if (!roomCode) {
      return;
    }

    socket.join(roomCode);
    ensureRoomState(roomCode);
    console.log(`Un jucător a intrat în camera: ${roomCode}`);

    io.to(roomCode).emit('playerConnected', { roomCode, socketId: socket.id });
  });

  // 1. ASIGNARE CULOARE: Așteptăm ca jucătorul să ceară culoarea
  socket.on('requestColor', (data) => {
    const roomCode = data && data.roomCode;
    if (!roomCode) {
      return;
    }

    ensureRoomState(roomCode);

    if (roomAssignments[roomCode][socket.id]) {
      socket.emit('playerAssigned', { roomCode, color: roomAssignments[roomCode][socket.id] });
      return;
    }

    const availableColors = allColors.filter((color) => !roomColors[roomCode].includes(color));

    if (availableColors.length > 0) {
      const assignedColor = availableColors[0];
      roomAssignments[roomCode][socket.id] = assignedColor;
      roomColors[roomCode].push(assignedColor);

      roomActivePlayers[roomCode].push(socket.id);

      if (roomActivePlayers[roomCode].length === 1) {
        roomTurnIndex[roomCode] = 0;
        io.to(roomCode).emit('turnUpdate', { roomCode, color: assignedColor });
      }

      socket.emit('playerAssigned', { roomCode, color: assignedColor });

      const activeColorsList = Object.values(roomAssignments[roomCode]);
      io.to(roomCode).emit('activePlayersUpdate', { roomCode, colors: activeColorsList });

      console.log(`Jucătorul ${socket.id} a cerut și a primit: ${assignedColor} (camera ${roomCode})`);
    } else {
      socket.emit('error', { roomCode, message: 'Jocul este plin!' });
    }
  });

  // 2. LOGICA DE MUTARE: Verificăm dacă jucătorul mută culoarea LUI
  socket.on('makeMove', (data) => {
    const roomCode = data && data.roomCode;
    if (!roomCode) {
      return;
    }

    const myAssignedColor = roomAssignments[roomCode] && roomAssignments[roomCode][socket.id];

    // Validare simplă: serverul permite mutarea doar dacă e culoarea atribuită
    if (myAssignedColor === data.color) {
      console.log(`Mutare validă (${myAssignedColor}):`, data);
      socket.to(roomCode).emit('updateBoard', data);
    } else {
      console.log(`Tentativă invalidă! ${socket.id} (care e ${myAssignedColor}) a vrut să mute ${data.color}`);
    }
  });

  // Când cineva a terminat mutarea, serverul decide următorul jucător activ
  socket.on('moveFinished', (data) => {
    const roomCode = data && data.roomCode;
    if (!roomCode || !roomActivePlayers[roomCode] || roomActivePlayers[roomCode].length === 0) {
      return;
    }

    const activePlayers = roomActivePlayers[roomCode];

    const currentPlayerId = activePlayers[roomTurnIndex[roomCode]];
    if (socket.id !== currentPlayerId) {
      return;
    }

    roomTurnIndex[roomCode] = (roomTurnIndex[roomCode] + 1) % activePlayers.length;
    const nextPlayerId = activePlayers[roomTurnIndex[roomCode]];
    const nextColor = roomAssignments[roomCode] && roomAssignments[roomCode][nextPlayerId];

    if (nextColor) {
      io.to(roomCode).emit('turnUpdate', { roomCode, color: nextColor });
    }
  });

  // 3. DECONECTARE: Punem culoarea înapoi în listă pentru altcineva
  socket.on('disconnect', () => {
    const joinedRooms = Array.from(socket.rooms).filter((room) => room !== socket.id);

    joinedRooms.forEach((roomCode) => {
      const activePlayers = roomActivePlayers[roomCode];
      if (activePlayers) {
        const activeIndex = activePlayers.indexOf(socket.id);
        if (activeIndex !== -1) {
          activePlayers.splice(activeIndex, 1);

          if (activePlayers.length === 0) {
            roomTurnIndex[roomCode] = 0;
          } else if (activeIndex < roomTurnIndex[roomCode]) {
            roomTurnIndex[roomCode] -= 1;
          } else if (activeIndex === roomTurnIndex[roomCode]) {
            if (roomTurnIndex[roomCode] >= activePlayers.length) {
              roomTurnIndex[roomCode] = 0;
            }

            const nextPlayerId = activePlayers[roomTurnIndex[roomCode]];
            const nextColor = roomAssignments[roomCode] && roomAssignments[roomCode][nextPlayerId];
            if (nextColor) {
              io.to(roomCode).emit('turnUpdate', { roomCode, color: nextColor });
            }
          }
        }
      }

      const colorToFree = roomAssignments[roomCode] && roomAssignments[roomCode][socket.id];
      if (colorToFree) {
        const colorIndex = roomColors[roomCode] ? roomColors[roomCode].indexOf(colorToFree) : -1;
        if (colorIndex !== -1) {
          roomColors[roomCode].splice(colorIndex, 1);
        }

        delete roomAssignments[roomCode][socket.id];
        const activeColorsList = Object.values(roomAssignments[roomCode]);
        io.to(roomCode).emit('activePlayersUpdate', { roomCode, colors: activeColorsList });
        console.log(`Jucătorul ${colorToFree} a plecat din camera ${roomCode}. Culoarea e din nou liberă.`);
      }

      cleanupRoomState(roomCode);
    });
  });
});

const PORT = 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Serverul ascultă pe toate IP-urile la portul ${PORT}`);
});