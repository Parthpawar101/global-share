require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const RoomManager = require('./server/rooms');
const setupSignaling = require('./server/signaling');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(',') : true, methods: ['GET', 'POST'] }, pingTimeout: 20000, pingInterval: 25000 });
const rooms = new RoomManager(Number(process.env.ROOM_TTL_MS || 21600000));

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

app.get('/api/config', (_req, res) => {
  res.json({
    stunUrl: process.env.STUN_URL || 'stun:stun.l.google.com:19302',
    turnUrl: process.env.TURN_URL || '',
    turnConfigured: Boolean(process.env.TURN_URL),
    chunkSize: Number(process.env.FILE_CHUNK_SIZE || 16384),
    maxFileSize: Number(process.env.MAX_FILE_SIZE || 2147483648)
  });
});

app.post('/api/rooms', async (req, res) => {
  const room = rooms.create();
  const publicUrl = (process.env.PUBLIC_URL || `http://${req.headers.host}`).replace(/\/$/, '');
  const roomUrl = `${publicUrl}/?room=${room.code}&secret=${room.secret}`;
  try {
    const qrDataUrl = await QRCode.toDataURL(roomUrl, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
    res.status(201).json({ roomId: room.id, code: room.code, secret: room.secret, roomUrl, qrDataUrl, expiresAt: room.expiresAt });
  } catch (error) {
    res.status(500).json({ error: 'Could not generate room QR code.' });
  }
});

app.get('/api/rooms/:code', (req, res) => {
  const { code } = req.params;
  const secret = String(req.query.secret || '');
  if (!secret) {
    const issued = rooms.issueCodeJoin(code);
    if (issued.status !== 'ok') {
      const status = issued.status === 'full' ? 409 : 404;
      const messages = { invalid: 'Invalid room code.', not_found: 'Room not found.', expired: 'This room has expired.', full: 'This room is already full.' };
      return res.status(status).json({ error: messages[issued.status] || 'Unable to join room.', status: issued.status });
    }
    return res.json({ roomId: issued.roomId, joinToken: issued.token, code });
  }
  const result = rooms.find(code, secret);
  if (result.status !== 'ok') {
    const status = result.status === 'full' ? 409 : result.status === 'unauthorized' ? 403 : 404;
    const messages = { invalid: 'Invalid room code.', not_found: 'Room not found.', expired: 'This room has expired.', unauthorized: 'This room link is invalid.', full: 'This room is already full.' };
    return res.status(status).json({ error: messages[result.status] || 'Unable to join room.', status: result.status });
  }
  res.json({ roomId: result.room.id, code: result.room.code, expiresAt: result.room.expiresAt, participantCount: result.room.participants.size });
});

setupSignaling(io, rooms);

setInterval(() => rooms.cleanup(), 60 * 1000).unref();

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`Global Share listening on http://localhost:${port}`));
