const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Creăm serverul HTTP și atașăm Socket.io la el
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Permitem oricui să se conecteze (jocul tău Tauri)
    methods: ["GET", "POST"]
  }
});

// Aici stă logica de comunicare
io.on('connection', (socket) => {
  console.log(`Un jucător s-a conectat! ID-ul lui: ${socket.id}`);

  // Când un jucător trimite o mutare, o dăm mai departe la toți ceilalți
  socket.on('makeMove', (data) => {
    console.log('Am primit o mutare:', data);
    // Trimitem mutarea la TOȚI în afară de cel care a trimis-o
    socket.broadcast.emit('updateBoard', data); 
  });

  socket.on('disconnect', () => {
    console.log(`Jucătorul ${socket.id} s-a deconectat.`);
  });
});

// Pornim serverul pe portul 3001
const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Arbitrul (Serverul) a pornit pe portul ${PORT} `);
});