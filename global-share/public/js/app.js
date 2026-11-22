class GlobalShareApp {
  constructor() {
    this.transfer = new TransferManager(this);
    this.clipboard = new ClipboardManager(this);
    this.webRTC = null;
    this.room = null;
    this.scanner = null;
    this.bindUI();
    this.initTheme();
    this.initFromUrl();
  }

  bindUI() {
    document.getElementById('themeButton').addEventListener('click', () => this.toggleTheme());
    document.getElementById('brandButton').addEventListener('click', () => location.href = location.pathname);
    document.getElementById('createRoomButton').addEventListener('click', () => this.createRoom());
    document.getElementById('joinRoomButton').addEventListener('click', () => this.joinByCode());
    document.getElementById('joinCodeInput').addEventListener('input', event => event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6));
    document.getElementById('joinCodeInput').addEventListener('keydown', event => { if (event.key === 'Enter') this.joinByCode(); });
    document.getElementById('scanButton').addEventListener('click', () => this.openScanner());
    document.getElementById('closeQrButton').addEventListener('click', () => this.closeScanner());
    document.getElementById('copyLinkButton').addEventListener('click', () => this.copyRoomLink());
    document.getElementById('downloadQrButton').addEventListener('click', () => this.downloadQr());
    document.getElementById('disconnectButton').addEventListener('click', () => this.disconnect());
    document.getElementById('browseButton').addEventListener('click', () => document.getElementById('fileInput').click());
    document.getElementById('fileInput').addEventListener('change', event => { this.transfer.sendFiles(event.target.files); event.target.value = ''; });
    document.getElementById('sendTextButton').addEventListener('click', () => this.clipboard.sendText());
    document.getElementById('textInput').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.clipboard.sendText(); } });
    document.getElementById('pasteButton').addEventListener('click', () => this.clipboard.paste());
    document.getElementById('clearTransfersButton').addEventListener('click', () => this.transfer.clearHistory());

    const drop = document.getElementById('dropZone');
    for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, event => { event.preventEventDefault?.(); event.preventDefault(); drop.classList.add('dragover'); });
    for (const type of ['dragleave', 'drop']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('dragover'); });
    drop.addEventListener('drop', event => this.transfer.sendFiles(event.dataTransfer.files));
  }

  initTheme() {
    const saved = localStorage.getItem('global-share-theme');
    if (saved === 'light') document.body.classList.add('light');
  }

  toggleTheme() {
    document.body.classList.toggle('light');
    localStorage.setItem('global-share-theme', document.body.classList.contains('light') ? 'light' : 'dark');
  }

  async initFromUrl() {
    const params = new URLSearchParams(location.search);
    const code = params.get('room');
    const secret = params.get('secret');
    if (/^\d{6}$/.test(code || '') && secret) await this.startJoining(code, secret);
  }

  async createRoom() {
    try {
      const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (!response.ok) throw new Error('Could not create room.');
      const room = await response.json();
      this.room = room;
      history.replaceState({}, '', `/?room=${room.code}&secret=${room.secret}`);
      this.showRoomLobby(room.code, room.qrDataUrl, room.roomUrl);
      this.startWebRTC(room.roomId, room.secret);
    } catch (error) { this.toast(error.message, 'error'); }
  }

  async joinByCode() {
    const input = document.getElementById('joinCodeInput');
    const code = input.value.trim();
    if (!/^\d{6}$/.test(code)) return this.toast('Enter a valid six-digit room code.', 'error');
    try {
      const response = await fetch(`/api/rooms/${code}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to join room.');
      this.room = { code, roomId: data.roomId, joinToken: data.joinToken };
      this.showRoomLobby(code, null, null);
      this.startWebRTC(data.roomId, null, data.joinToken);
    } catch (error) { this.toast(error.message, 'error'); }
  }

  async startJoining(code, secret) {
    try {
      const response = await fetch(`/api/rooms/${code}?secret=${encodeURIComponent(secret)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to join room.');
      this.room = { code, secret, roomId: data.roomId, roomUrl: location.href };
      this.showRoomLobby(code, null, location.href);
      this.startWebRTC(data.roomId, secret);
    } catch (error) { this.toast(error.message, 'error'); }
  }

  async startWebRTC(roomId, secret, joinToken) {
    this.webRTC = new WebRTCManager(this);
    await this.webRTC.configure();
    this.webRTC.joinRoom(roomId, secret, joinToken);
  }

  showRoomLobby(code, qr, url) {
    document.getElementById('homeView').classList.add('hidden');
    document.getElementById('roomView').classList.remove('hidden');
    document.getElementById('lobbyPanel').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('roomCode').textContent = code;
    if (qr) document.getElementById('qrImage').src = qr;
    else if (url) document.getElementById('qrImage').src = '';
    this.room.roomUrl = url || this.room.roomUrl;
  }

  roomJoined(data) {
    const local = this.getDeviceInfo();
    document.getElementById('localDeviceName').textContent = local.name;
    document.getElementById('localDeviceType').textContent = this.titleCase(local.type);
    if (data.initiator) this.setConnectionStatus('waiting', 'Waiting for peer');
  }

  peerConnected(device) {
    document.getElementById('lobbyPanel').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    document.getElementById('peerDeviceName').textContent = device?.name || 'Peer device';
    document.getElementById('peerDeviceType').textContent = this.titleCase(device?.type || 'desktop');
    document.getElementById('peerBadge').textContent = 'Connected';
    this.toast('Peer connected.', 'success');
  }

  peerDisconnected() {
    document.getElementById('peerBadge').textContent = 'Disconnected';
    document.getElementById('peerBadge').style.color = 'var(--danger)';
    this.setConnectionStatus('error', 'Peer disconnected');
    this.toast('Peer disconnected.', 'error');
  }

  setConnectionStatus(type, text) {
    const dot = document.getElementById('statusDot');
    dot.className = 'status-dot' + (type === 'connected' ? ' connected' : type === 'error' ? ' error' : '');
    document.getElementById('connectionStatus').textContent = text;
  }

  joinError(error) {
    this.toast(error.message, 'error');
  }

  disconnect() {
    this.webRTC?.disconnect();
    history.replaceState({}, '', location.pathname);
    location.reload();
  }

  getDeviceInfo() {
    const ua = navigator.userAgent;
    let type = 'desktop';
    if (/Mobile|Android|iPhone/i.test(ua) && !/iPad/i.test(ua)) type = 'mobile';
    else if (/iPad|Tablet/i.test(ua)) type = 'tablet';
    else if (/Macintosh|Windows|Linux/i.test(ua) && /Laptop|Mobile/i.test(ua) === false) type = 'laptop';
    const name = navigator.platform || (type === 'mobile' ? 'Mobile device' : 'This device');
    return { name: name.slice(0, 80), type };
  }

  titleCase(text) { return String(text).charAt(0).toUpperCase() + String(text).slice(1); }

  async copyRoomLink() {
    if (!this.room?.roomUrl) return this.toast('No shareable link is available.', 'error');
    await navigator.clipboard.writeText(this.room.roomUrl);
    this.toast('Room link copied.', 'success');
  }

  downloadQr() {
    const img = document.getElementById('qrImage');
    if (!img?.src) return;
    const link = document.createElement('a'); link.href = img.src; link.download = `global-share-${this.room.code}.png`; link.click();
  }

  async openScanner() {
    if (!window.Html5Qrcode) return this.toast('QR scanner library unavailable.', 'error');
    document.getElementById('qrModal').classList.remove('hidden');
    this.scanner = new Html5Qrcode('qrReader');
    try {
      await this.scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 250 }, text => this.onQrScan(text));
      document.getElementById('qrStatus').textContent = 'Point the camera at a room QR code.';
    } catch { document.getElementById('qrStatus').textContent = 'Camera permission denied or unavailable.'; }
  }

  async onQrScan(text) {
    await this.closeScanner();
    try {
      const url = new URL(text, location.origin);
      const code = url.searchParams.get('room');
      const secret = url.searchParams.get('secret');
      if (!/^\d{6}$/.test(code || '') || !secret) throw new Error('This is not a valid Global Share room QR code.');
      await this.startJoining(code, secret);
    } catch (error) { this.toast(error.message, 'error'); }
  }

  async closeScanner() {
    document.getElementById('qrModal').classList.add('hidden');
    if (this.scanner) { try { await this.scanner.stop(); } catch {} await this.scanner.clear(); this.scanner = null; }
  }

  addMessage(text, direction) {
    const list = document.getElementById('messageList');
    const empty = list.querySelector('.empty-state'); if (empty) empty.remove();
    const message = document.createElement('div');
    message.className = `message ${direction}`;
    message.textContent = text;
    const time = document.createElement('time'); time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    message.appendChild(time);
    if (direction === 'in') {
      message.title = 'Click to copy';
      message.style.cursor = 'copy';
      message.addEventListener('click', async () => { await navigator.clipboard.writeText(text); this.toast('Received text copied.', 'success'); });
    }
    list.appendChild(message); list.scrollTop = list.scrollHeight;
  }

  addTransfer(record, direction) {
    const list = document.getElementById('transferList');
    const item = document.createElement('div'); item.className = 'transfer-item'; item.dataset.transferId = record.id;
    const size = this.formatSize(record.size); const icon = this.fileIcon(record.name);
    item.innerHTML = `<div class="transfer-top"><div class="file-icon"><i data-lucide="${icon}"></i></div><div class="file-meta"><strong></strong><small>${direction === 'out' ? 'Sending' : 'Receiving'} · ${size}</small></div><button class="cancel-transfer" title="Cancel"><i data-lucide="x"></i></button></div><div class="progress-track"><span></span></div>`;
    item.querySelector('strong').textContent = record.name;
    item.querySelector('.cancel-transfer').addEventListener('click', () => this.transfer.cancel(record.id, direction));
    list.prepend(item); if (window.lucide) lucide.createIcons();
  }

  updateTransfer(id, percent, speed, received, status, blob) {
    const item = [...document.querySelectorAll('.transfer-item')].find(el => el.dataset.transferId === id);
    if (!item) return;
    item.querySelector('.progress-track span').style.width = `${Math.min(100, percent)}%`;
    const small = item.querySelector('.file-meta small');
    if (status === 'sent') small.textContent = `Sent · ${this.formatSize(received)}`;
    else if (status === 'received') {
      small.innerHTML = `Received · ${this.formatSize(received)} · <button class="download-inline">Download</button>`;
      small.querySelector('.download-inline').addEventListener('click', () => this.downloadBlob(blob, item.querySelector('strong').textContent));
    } else if (status === 'cancelled') small.textContent = 'Transfer cancelled';
    else {
      const elapsed = percent > 0 ? (100 - percent) / Math.max(percent, 1) : 0;
      small.textContent = `${this.formatSize(received)} · ${speed.toFixed(1)} MB/s · ${percent.toFixed(0)}%`;
    }
  }

  downloadBlob(blob, name) {
    if (!blob) return;
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  formatSize(bytes) { if (!bytes) return '0 B'; const units = ['B','KB','MB','GB']; const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3); return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`; }
  fileIcon(name) { const ext = name.split('.').pop().toLower(); if (/^(png|jpg|jpeg|gif|webp)$/.test(ext)) return 'image'; if (/^(mp4|mov|webm)$/.test(ext)) return 'video'; if (ext === 'pdf') return 'file-text'; if (/^(zip|rar|7z)$/.test(ext)) return 'archive'; if (/^(mp3|wav|m4a|ogg)$/.test(ext)) return 'music'; return 'file'; }

  toast(message, type = '') {
    const container = document.getElementById('toastContainer'); const toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = message; if (type === 'error') toast.style.borderColor = 'rgba(251,113,133,.45)'; container.appendChild(toast); setTimeout(() => toast.remove(), 4000);
  }
}

window.addEventListener('DOMContentLoaded', () => { window.app = new GlobalShareApp(); if (window.lucide) lucide.createIcons(); });
