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

// --- LOGICA PENTRU GESTIONAREA CULORILOR ---
let availableColors = ['red', 'blue', 'green', 'yellow'];
const playerAssignments = {}; // Aici memorăm cine are ce culoare { "socketId": "red" }
let activePlayers = []; // Lista ordonata a socket-urilor conectate (jucatori activi)
let currentTurnIndex = 0;

io.on('connection', (socket) => {
  console.log(`Jucător conectat: ${socket.id}`);

  // 1. ASIGNARE CULOARE: Așteptăm ca jucătorul să ceară culoarea
  socket.on('requestColor', () => {
    if (playerAssignments[socket.id]) {
      socket.emit('playerAssigned', { color: playerAssignments[socket.id] });
      return;
    }

    if (availableColors.length > 0) {
      const assignedColor = availableColors.shift();
      playerAssignments[socket.id] = assignedColor;

      activePlayers.push(socket.id);

      if (activePlayers.length === 1) {
        currentTurnIndex = 0;
        io.emit('turnUpdate', assignedColor);
      }

      socket.emit('playerAssigned', { color: assignedColor });

      const activeColorsList = Object.values(playerAssignments);
      io.emit('activePlayersUpdate', activeColorsList);

      console.log(`Jucătorul ${socket.id} a cerut și a primit: ${assignedColor}`);
    } else {
      socket.emit('error', 'Jocul este plin!');
    }
  });

  // 2. LOGICA DE MUTARE: Verificăm dacă jucătorul mută culoarea LUI
  socket.on('makeMove', (data) => {
    const myAssignedColor = playerAssignments[socket.id];

    // Validare simplă: serverul permite mutarea doar dacă e culoarea atribuită
    if (myAssignedColor === data.color) {
      console.log(`Mutare validă (${myAssignedColor}):`, data);
      socket.broadcast.emit('updateBoard', data); 
    } else {
      console.log(`Tentativă invalidă! ${socket.id} (care e ${myAssignedColor}) a vrut să mute ${data.color}`);
    }
  });

  // Când cineva a terminat mutarea, serverul decide următorul jucător activ
  socket.on('moveFinished', () => {
    if (activePlayers.length === 0) {
      return;
    }

    const currentPlayerId = activePlayers[currentTurnIndex];
    if (socket.id !== currentPlayerId) {
      return;
    }

    currentTurnIndex = (currentTurnIndex + 1) % activePlayers.length;
    const nextPlayerId = activePlayers[currentTurnIndex];
    const nextColor = playerAssignments[nextPlayerId];

    if (nextColor) {
      io.emit('turnUpdate', nextColor);
    }
  });

  // 3. DECONECTARE: Punem culoarea înapoi în listă pentru altcineva
  socket.on('disconnect', () => {
    const activeIndex = activePlayers.indexOf(socket.id);
    if (activeIndex !== -1) {
      activePlayers.splice(activeIndex, 1);

      if (activePlayers.length === 0) {
        currentTurnIndex = 0;
      } else if (activeIndex < currentTurnIndex) {
        currentTurnIndex -= 1;
      } else if (activeIndex === currentTurnIndex) {
        if (currentTurnIndex >= activePlayers.length) {
          currentTurnIndex = 0;
        }

        const nextPlayerId = activePlayers[currentTurnIndex];
        const nextColor = playerAssignments[nextPlayerId];
        if (nextColor) {
          io.emit('turnUpdate', nextColor);
        }
      }
    }

    const colorToFree = playerAssignments[socket.id];
    if (colorToFree) {
      availableColors.push(colorToFree); // Culoarea revine în stoc
      delete playerAssignments[socket.id];
      const activeColorsList = Object.values(playerAssignments);
      io.emit('activePlayersUpdate', activeColorsList);
      console.log(`Jucătorul ${colorToFree} a plecat. Culoarea e din nou liberă.`);
    }
  });
});

const PORT = 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Serverul ascultă pe toate IP-urile la portul ${PORT}`);
});