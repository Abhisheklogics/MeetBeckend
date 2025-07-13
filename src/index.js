import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express().use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: 'https://conexus-iota.vercel.app/', credentials: true } });

/* roomId -> { teacherId, students: Set<socketId> } */
const rooms = new Map();

io.on('connection', socket => {
  socket.on('join-room', ({ roomId, role, name }) => {
    socket.data = { roomId, role, name };
    if (!rooms.has(roomId))
      rooms.set(roomId, { teacherId: null, students: new Set() });

    const room = rooms.get(roomId);

    if (role === 'teacher') {
      if (room.teacherId) return socket.emit('error', 'Teacher already present');
      room.teacherId = socket.id;
      console.log(`👩‍🏫 Teacher ${name} (${socket.id}) joined ${roomId}`);
    } else {
      room.students.add(socket.id);
      console.log(`🎓 Student ${name} (${socket.id}) joined ${roomId}`);

      // inform teacher that a new student needs SDP offer
      if (room.teacherId) io.to(room.teacherId).emit('student-joined', { studentId: socket.id, name });
    }
  });

  /* relay SDP + ICE */
  socket.on('offer', payload => io.to(payload.to).emit('offer', { ...payload, from: socket.id }));
  socket.on('answer', payload => io.to(payload.to).emit('answer', { ...payload, from: socket.id }));
  socket.on('ice', payload => io.to(payload.to).emit('ice', { ...payload, from: socket.id }));

  socket.on('disconnect', () => {
    const { roomId, role } = socket.data || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    if (role === 'teacher') {
      // drop entire room
      io.to(roomId).emit('room-closed');
      room.students.forEach(id => io.sockets.sockets.get(id)?.leave(roomId));
      rooms.delete(roomId);
      console.log(`Teacher left. Room ${roomId} closed.`);
    } else {
      room.students.delete(socket.id);
      if (room.teacherId) io.to(room.teacherId).emit('student-left', { studentId: socket.id });
      console.log(`Student ${socket.id} left room ${roomId}`);
    }
  });
});

server.listen(4000, () => console.log('🚀 Signaling server @4000'));
