class TransferManager {
  constructor(app) {
    this.app = app;
    this.config = { chunkSize: 16384, maxFileSize: 2147483648 };
    this.outgoing = new Map();
    this.incoming = new Map();
  }

  configure(config) {
    this.config.chunkSize = Number(config.chunkSize || 16384);
    this.config.maxFileSize = Number(config.maxFileSize || 2147483648);
  }

  async sendFiles(files) {
    if (!this.app.webRTC?.isFileReady()) return this.app.toast('Wait for the peer connection.', 'error');
    for (const file of [...files]) {
      if (file.size > this.config.maxFileSize) { this.app.toast(`${file.name} exceeds the transfer limit.`, 'error'); continue; }
      await this.sendFile(file);
    }
  }

  async sendFile(file) {
    const id = `tr_${crypto.getRandomValues(new Uint32Array(4)).join('_')}`;
    const channel = this.app.webRTC.createFileChannel(id);
    const started = performance.now();
    const record = { id, file, name: file.name, size: file.size, sent: 0, status: 'sending', channel, started, element: null };
    this.outgoing.set(id, record);
    this.app.addTransfer(record, 'out');

    channel.onopen = async () => {
      channel.send(JSON.stringify({ type: 'file-start', transferId: id, name: file.name, size: file.size, mime: file.type || 'application/octet-stream', chunkSize: this.config.chunkSize }));
      await this.streamFile(record);
    };
    channel.onmessage = event => this.handleControlOrJson(event, record);
  }

  async streamFile(record) {
    if (record.status === 'cancelled') return;
    const { file, channel, id } = record;
    let offset = 0;
    while (offset < file.size) {
      if (record.status === 'cancelled') return;
      while (channel.bufferedAmount > channel.bufferedAmountLowThreshold) await new Promise(resolve => channel.onbufferedamountlow = resolve);
      const end = Math.min(offset + this.config.chunkSize, file.size);
      const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      const idBytes = new TextEncoder().encode(id);
      const frame = new ArrayBuffer(4 + idBytes.length + 4 + bytes.length);
      const view = new DataView(frame);
      view.setUint32(0, idBytes.length);
      new Uint8Array(frame, 4, idBytes.length).set(idBytes);
      view.setUint32(4 + idBytes.length, Math.floor(offset / this.config.chunkSize));
      new Uint8Array(frame, 8 + idBytes.length).set(bytes);
      channel.send(frame);
      offset = end;
      record.sent = offset;
      const elapsed = (performance.now() - record.started) / 1000;
      const speed = elapsed ? record.sent / elapsed / 1048576 : 0;
      const percent = record.size ? record.sent / record.size * 100 : 100;
      this.app.updateTransfer(id, percent, speed, record.sent);
    }
    if (channel.readyState === 'open') channel.send(JSON.stringify({ type: 'file-end', transferId: id, size: file.size }));
    record.status = 'sent';
    this.app.updateTransfer(id, 100, 0, record.sent, 'sent');
    this.app.toast(`${file.name} sent.`, 'success');
  }

  setupIncomingChannel(channel) {
    channel.binaryType = 'arraybuffer';
    channel.onmessage = event => {
      if (typeof event.data === 'string') {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'file-start') this.startReceive(channel, message);
        if (message.type === 'file-end') this.finishReceive(message);
        if (message.type === 'file-cancel') this.cancelReceive(message.transferId);
      } else this.receiveFrame(event.data);
    };
  }

  startReceive(channel, meta) {
    const record = { id: meta.transferId, name: meta.name.slice(0, 255), size: meta.size, mime: meta.mime, received: 0, chunks: [], status: 'receiving', channel, started: performance.now() };
    if (record.size > this.config.maxFileSize) { channel.send(JSON.stringify({ type: 'file-cancel', transferId: record.id, reason: 'size-limit' })); return; }
    this.incoming.set(record.id, record);
    this.app.addTransfer(record, 'in');
  }

  receiveFrame(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 8) return;
    const idLength = view.getUint32(0);
    if (buffer.byteLength < 8 + idLength) return;
    const id = new TextDecoder().decode(new Uint8Array(buffer, 4, idLength));
    const payloadOffset = 8 + idLength;
    const record = this.incoming.get(id);
    if (!record || record.status !== 'receiving') return;
    record.chunks.push(new Uint8Array(buffer, payloadOffset));
    record.received += buffer.byteLength - payloadOffset;
    const elapsed = (performance.now() - record.started) / 1000;
    const speed = elapsed ? record.received / elapsed / 1048576 : 0;
    const percent = record.size ? record.received / record.size * 100 : 100;
    this.app.updateTransfer(id, percent, speed, record.received);
  }

  finishReceive(meta) {
    const record = this.incoming.get(meta.transferId);
    if (!record) return;
    const blob = new Blob(record.chunks, { type: record.mime });
    record.blob = blob;
    record.status = 'received';
    this.app.updateTransfer(record.id, 100, 0, record.received, 'received', blob);
    this.app.toast(`${record.name} received.`, 'success');
  }

  cancel(recordId, direction) {
    const record = direction === 'out' ? this.outgoing.get(recordId) : this.incoming.get(recordId);
    if (!record) return;
    record.status = 'cancelled';
    if (record.channel?.readyState === 'open') record.channel.send(JSON.stringify({ type: 'file-cancel', transferId: recordId }));
    this.app.updateTransfer(recordId, 0, 0, 0, 'cancelled');
  }

  cancelReceive(id) {
    const record = this.incoming.get(id);
    if (record) { record.status = 'cancelled'; this.app.updateTransfer(id, 0, 0, 0, 'cancelled'); }
  }

  handleControlOrJson() {}

  clearHistory() {
    document.getElementById('transferList').replaceChildren();
  }
}
