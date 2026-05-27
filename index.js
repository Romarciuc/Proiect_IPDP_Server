require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// --- BAZA DE DATE MONGODB ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Conectat cu succes la baza de date MongoDB! "))
  .catch((err) => console.error("Eroare la conectare MongoDB:", err));

const utilizatorSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  victorii: { type: Number, default: 0 }
});
const Utilizator = mongoose.model('Utilizator', utilizatorSchema);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket']
});

// logica pentru gestionarea culorilor si a starii
const allColors = ['red', 'blue', 'green', 'yellow'];
const roomColors = {}; 
const roomAssignments = {}; 
const roomNames = {}; 
const roomActivePlayers = {}; 
const roomTurnIndex = {}; 

// noile memorii pentru reconectare
const roomBoardState = {}; 
const roomPlayerIdentities = {}; 

// setari lobby
const roomMaxPlayers = {}; 
const roomGameStarted = {}; 

const ensureRoomState = (roomCode) => {
  if (!roomColors[roomCode]) roomColors[roomCode] = [];
  if (!roomAssignments[roomCode]) roomAssignments[roomCode] = {};
  if (!roomNames[roomCode]) roomNames[roomCode] = {};
  if (!roomActivePlayers[roomCode]) roomActivePlayers[roomCode] = [];
  if (roomTurnIndex[roomCode] === undefined) roomTurnIndex[roomCode] = 0;
  
  // initializam memoriile si lobby-ul
  if (!roomBoardState[roomCode]) roomBoardState[roomCode] = null;
  if (!roomPlayerIdentities[roomCode]) roomPlayerIdentities[roomCode] = {};
  if (!roomMaxPlayers[roomCode]) roomMaxPlayers[roomCode] = 4;
  if (!roomGameStarted[roomCode]) roomGameStarted[roomCode] = false;
};

const cleanupRoomState = (roomCode) => {
  const hasPlayers = roomActivePlayers[roomCode] && roomActivePlayers[roomCode].length > 0;

  if (!hasPlayers) {
    delete roomColors[roomCode];
    delete roomAssignments[roomCode];
    delete roomNames[roomCode];
    delete roomActivePlayers[roomCode];
    delete roomTurnIndex[roomCode];
    delete roomBoardState[roomCode];
    delete roomPlayerIdentities[roomCode];
    delete roomMaxPlayers[roomCode];
    delete roomGameStarted[roomCode];
  }
};

const buildActivePlayersList = (roomCode) => {
  const socketIds = roomActivePlayers[roomCode] || [];
  
  return socketIds.map((id) => {
    const color = roomAssignments[roomCode][id];
    const name = roomNames[roomCode][id] || 'anonim';
    if (!color) return null;
    return { color: color, name: name };
  }).filter(Boolean);
};

// --- RUTE API ---
app.post('/api/inregistrare', async (req, res) => {
  try {
    const { username, password } = req.body;
    const utilizatorExistent = await Utilizator.findOne({ username });

    if (utilizatorExistent) {
      return res.status(400).json({ eroare: "Acest nume este deja folosit!" });
    }

    await Utilizator.create({ username, password });
    res.json({ succes: true, mesaj: "Cont creat cu succes!" });
  } catch (err) {
    res.status(500).json({ eroare: "Eroare la server." });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const utilizator = await Utilizator.findOne({ username, password });

    if (!utilizator) {
      return res.status(401).json({ eroare: "Nume sau parolă incorectă!" });
    }

    res.json({ succes: true, username: utilizator.username });
  } catch (err) {
    res.status(500).json({ eroare: "Eroare la server." });
  }
});

io.on('connection', (socket) => {
  console.log(`jucator conectat: ${socket.id}`);

  // intrare in camera
  socket.on('joinRoom', (roomCode) => {
    if (!roomCode) return;
    socket.join(roomCode);
    ensureRoomState(roomCode);
    io.to(roomCode).emit('playerConnected', { roomCode, socketId: socket.id });
  });

  // cerere culoare
  socket.on('requestColor', (data) => {
    const { roomCode, playerName } = data;
    if (!roomCode) return;

    ensureRoomState(roomCode);

    // verificam daca este o reconectare (ca sa nu blocam un jucator care a dat refresh din greseala)
    const isReconnecting = playerName && roomPlayerIdentities[roomCode] && roomPlayerIdentities[roomCode][playerName];

    // respingem daca e plin sau a inceput meciul, iar el e un jucator complet nou
    if (!isReconnecting) {
      if (roomGameStarted[roomCode]) {
        socket.emit('roomError', { message: 'Meciul a început deja în această cameră!' });
        return;
      }
      if (roomActivePlayers[roomCode].length >= roomMaxPlayers[roomCode]) {
        socket.emit('roomError', { message: 'Această cameră este deja plină!' });
        return;
      }
    }

    roomNames[roomCode][socket.id] = playerName || 'anonim';

    let myColor;

    if (isReconnecting) {
      myColor = roomPlayerIdentities[roomCode][playerName];
      console.log(`[reconectare] ${playerName} a revenit cu culoarea ${myColor}`);
    } else {
      // alocam culoare noua
      const availableColors = allColors.filter(c => !roomColors[roomCode].includes(c));
      if (availableColors.length > 0) {
        myColor = availableColors[0];
        roomPlayerIdentities[roomCode][playerName] = myColor;
        roomColors[roomCode].push(myColor);
      }
    }

    if (myColor) {
      roomAssignments[roomCode][socket.id] = myColor;
      if (!roomActivePlayers[roomCode].includes(socket.id)) {
        roomActivePlayers[roomCode].push(socket.id);
      }
      
      socket.emit('playerAssigned', { roomCode, color: myColor });

      socket.emit('lobbyUpdate', { maxPlayers: roomMaxPlayers[roomCode] });
      if (roomGameStarted[roomCode]) {
        socket.emit('gameStarted');
      }

      if (roomBoardState[roomCode]) {
        socket.emit('updateBoard', roomBoardState[roomCode]);
      } else if (roomActivePlayers[roomCode].length === 1) {
        io.to(roomCode).emit('turnUpdate', { roomCode, color: myColor });
      }
    }

    const list = buildActivePlayersList(roomCode);
    io.to(roomCode).emit('activePlayersUpdate', list);
  });

  // hostul schimba setarile lobby-ului
  socket.on('updateMaxPlayers', (data) => {
    const roomCode = data && data.roomCode;
    if (!roomCode) return;
    roomMaxPlayers[roomCode] = data.maxPlayers;
    io.to(roomCode).emit('lobbyUpdate', { maxPlayers: data.maxPlayers });
  });

  // hostul da start la joc
  socket.on('startGame', (data) => {
    const roomCode = data && data.roomCode;
    if (!roomCode) return;
    roomGameStarted[roomCode] = true;
    io.to(roomCode).emit('gameStarted');
  });

  // logica mutare
  socket.on('makeMove', (data) => {
    const roomCode = data && data.roomCode;
    if (!roomCode) return;

    const myAssignedColor = roomAssignments[roomCode] && roomAssignments[roomCode][socket.id];

    if (myAssignedColor === data.color) {
      if (!roomBoardState[roomCode]) roomBoardState[roomCode] = {};
      
      if (data.pawns) roomBoardState[roomCode].pawns = data.pawns;
      if (data.turn) roomBoardState[roomCode].turn = data.turn;
      if (data.diceValue !== undefined) roomBoardState[roomCode].diceValue = data.diceValue;
      if (data.actionPhase) roomBoardState[roomCode].actionPhase = data.actionPhase;
      if (data.extraRollActive !== undefined) roomBoardState[roomCode].extraRollActive = data.extraRollActive;
      if (data.winner) roomBoardState[roomCode].winner = data.winner;

      io.to(roomCode).emit('updateBoard', data);
    }
  });

  // chat
  socket.on('sendMessage', (data) => {
    const roomCode = data && data.roomCode;
    if (!roomCode) return;
    io.to(roomCode).emit('receiveMessage', data);
  });

  // deconectare
  socket.on('disconnect', () => {
    const roomsToClean = [];
    for (const roomCode in roomActivePlayers) {
      if (roomActivePlayers[roomCode].includes(socket.id)) {
        roomsToClean.push(roomCode);
      }
    }

    roomsToClean.forEach((roomCode) => {
      const activePlayers = roomActivePlayers[roomCode];
      
      if (activePlayers) {
        const activeIndex = activePlayers.indexOf(socket.id);
        if (activeIndex !== -1) {
          
          const isHisTurn = (activeIndex === roomTurnIndex[roomCode]);
          activePlayers.splice(activeIndex, 1);

          if (activePlayers.length === 0) {
            roomTurnIndex[roomCode] = 0;
          } else {
            if (activeIndex < roomTurnIndex[roomCode]) {
              roomTurnIndex[roomCode] -= 1;
            } else if (roomTurnIndex[roomCode] >= activePlayers.length) {
              roomTurnIndex[roomCode] = 0;
            }
            
            if (isHisTurn) {
              const nextPlayerId = activePlayers[roomTurnIndex[roomCode]];
              const nextColor = roomAssignments[roomCode] && roomAssignments[roomCode][nextPlayerId];
              if (nextColor) {
                io.to(roomCode).emit('turnUpdate', { roomCode, color: nextColor });
              }
            }
          }
        }
      }

      if (roomNames[roomCode]) {
        delete roomNames[roomCode][socket.id];
      }

      if (roomAssignments[roomCode]) {
        delete roomAssignments[roomCode][socket.id];
      }
      
      const activePlayersList = buildActivePlayersList(roomCode);
      io.to(roomCode).emit('activePlayersUpdate', activePlayersList);
      
      cleanupRoomState(roomCode);
    });
  });
});

const PORT = 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`serverul asculta pe toate ip-urile la portul ${PORT}`);
});