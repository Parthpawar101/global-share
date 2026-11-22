const crypto = require('crypto');

function validateSocketPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return true;
}

function safeText(value, max = 100000) {
  if (typeof value !== 'string') return null;
  if (!value || value.length > max) return null;
  return value;
}

function isValidRoomId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{20,40}$/.test(value); }
function isValidSecret(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{32,60}$/.test(value); }
function randomId(prefix = 'tr') { return `${prefix}_${crypto.randomBytes(12).toString('hex')}`; }

module.exports = { validateSocketPayload, safeText, isValidRoomId, isValidSecret, randomId };
