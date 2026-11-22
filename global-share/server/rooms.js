const crypto = require('crypto');

class RoomManager {
  constructor(ttlMs = 6 * 60 * 60 * 1000) {
    this.rooms = new Map();
    this.codeIndex = new Map();
    this.codeJoinTokens = new Map();
    this.ttlMs = ttlMs;
  }

  create() {
    this.cleanup();
    let code;
    do { code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); } while (this.codeIndex.has(code));
    const id = crypto.randomBytes(18).toString('base64url');
    const secret = crypto.randomBytes(32).toString('base64url');
    const room = { id, code, secret, participants: new Map(), createdAt: Date.now(), expiresAt: Date.now() + this.ttlMs };
    this.rooms.set(id, room);
    this.codeIndex.set(code, id);
    return room;
  }

  find(code, secret) {
    this.cleanup();
    if (!/^\d{6}$/.test(String(code || ''))) return { status: 'invalid' };
    const id = this.codeIndex.get(code);
    if (!id) return { status: 'not_found' };
    const room = this.rooms.get(id);
    if (!room) return { status: 'expired' };
    if (room.secret !== secret) return { status: 'unauthorized' };
    if (room.participants.size >= 2) return { status: 'full', room };
    return { status: 'ok', room };
  }

  getById(id) { this.cleanup(); return this.rooms.get(id); }

  addParticipant(roomId, socketId, device) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.participants.has(socketId)) return room.participants.get(socketId);
    if (room.participants.size >= 2) return null;
    const participant = { socketId, device: this.safeDevice(device), joinedAt: Date.now() };
    room.participants.set(socketId, participant);
    return participant;
  }

  removeParticipant(roomId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.participants.delete(socketId);
  }

  safeDevice(device) {
    const allowed = ['mobile', 'tablet', 'laptop', 'desktop'];
    return {
      name: String(device?.name || 'Anonymous device').slice(0, 80),
      type: allowed.includes(device?.type) ? device.type : 'desktop'
    };
  }

  cleanup() {
    const now = Date.now();
    for (const [token, entry] of this.codeJoinTokens) {
      if (entry.expiresAt <= now) this.codeJoinTokens.delete(token);
    }
    for (const [id, room] of this.rooms) {
      if (room.expiresAt <= now) {
        this.codeIndex.delete(room.code);
        this.rooms.delete(id);
      }
    }
  }

  issueCodeJoin(code) {
    this.cleanup();
    if (!/^\d{6}$/.test(String(code || ''))) return { status: 'invalid' };
    const id = this.codeIndex.get(code);
    if (!id) return { status: 'not_found' };
    const room = this.rooms.get(id);
    if (!room) return { status: 'expired' };
    if (room.participants.size >= 2) return { status: 'full', room };
    const token = crypto.randomBytes(24).toString('base64url');
    this.codeJoinTokens.set(token, { roomId: room.id, expiresAt: Date.now() + 2 * 60 * 1000 });
    return { status: 'ok', roomId: room.id, token };
  }

  consumeCodeJoin(token) {
    this.cleanup();
    const entry = this.codeJoinTokens.get(token);
    if (!entry) return null;
    this.codeJoinTokens.delete(token);
    if (entry.expiresAt < Date.now()) return null;
    return this.rooms.get(entry.roomId);
  }
}

module.exports = RoomManager;
