const { validateSocketPayload, isValidRoomId, isValidSecret } = require('./security');

function setupSignaling(io, rooms) {
  io.on('connection', socket => {
    socket.on('join-room', (payload = {}) => {
      if (!validateSocketPayload(payload) || !isValidRoomId(payload.roomId)) {
        return socket.emit('join-error', { code: 'INVALID_REQUEST', message: 'Invalid room credentials.' });
      }
      let room = rooms.getById(payload.roomId);
      if (!room) return socket.emit('join-error', { code: 'ROOM_EXPIRED', message: 'This room is no longer available.' });
      if (payload.joinToken) {
        const tokenRoom = rooms.consumeCodeJoin(payload.joinToken);
        if (!tokenRoom || tokenRoom.id !== payload.roomId) return socket.emit('join-error', { code: 'UNAUTHORIZED', message: 'The room code authorization expired.' });
        room = tokenRoom;
      } else {
        if (!isValidSecret(payload.secret) || room.secret !== payload.secret) return socket.emit('join-error', { code: 'UNAUTHORIZED', message: 'This room link is invalid.' });
      }
      if (!room.participants.has(socket.id) && room.participants.size >= 2) {
        return socket.emit('join-error', { code: 'ROOM_FULL', message: 'This room already has two participants.' });
      }

      const participant = rooms.addParticipant(room.id, socket.id, payload.device);
      if (!participant) return socket.emit('join-error', { code: 'ROOM_FULL', message: 'This room already has two participants.' });
      socket.join(room.id);
      socket.data.roomId = room.id;
      socket.data.socketIndex = room.participants.size - 1;

      const peers = [...room.participants.entries()].filter(([id]) => id !== socket.id).map(([, p]) => p);
      socket.emit('room-joined', {
        roomId: room.id,
        code: room.code,
        initiator: peers.length === 0,
        participants: [...room.participants.values()].map(p => ({ socketId: p.socketId, device: p.device, joinedAt: p.joinedAt }))
      });
      if (peers.length) {
        socket.to(room.id).emit('peer-connected', { participant });
        socket.emit('peer-connected', { participant: peers[0] });
      }
    });

    socket.on('signal', (payload = {}) => {
      if (!validateSocketPayload(payload) || typeof payload.target !== 'string') return;
      const roomId = socket.data.roomId;
      const room = roomId && rooms.getById(roomId);
      if (!room || !room.participants.has(socket.id) || !room.participants.has(payload.target)) return;
      if (!payload.data || typeof payload.data !== 'object') return;
      io.to(payload.target).emit('signal', { from: socket.id, data: payload.data });
    });

    socket.on('disconnect', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = rooms.getById(roomId);
      if (!room) return;
      rooms.removeParticipant(roomId, socket.id);
      socket.to(roomId).emit('peer-disconnected', { socketId: socket.id });
    });

    socket.on('leave-room', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = rooms.getById(roomId);
      rooms.removeParticipant(roomId, socket.id);
      socket.leave(roomId);
      socket.to(roomId).emit('peer-disconnected', { socketId: socket.id });
      socket.data.roomId = null;
    });
  });
}

module.exports = setupSignaling;
