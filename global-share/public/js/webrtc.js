class WebRTCManager {
  constructor(app) {
    this.app = app;
    this.socket = io();
    this.pc = null;
    this.textChannel = null;
    this.initiator = false;
    this.peerSocketId = null;
    this.negotiating = false;
    this.iceRecoveryTimer = null;
    this.config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    this.bindSocket();
  }

  async configure() {
    const response = await fetch('/api/config');
    if (response.ok) {
      const config = await response.json();
      this.app.transfer.configure(config);
      const servers = [{ urls: config.stunUrl }];
      // Static TURN credentials are server-side only. A production TURN REST endpoint must supply short-lived credentials.
      if (config.turnUrl) servers.push({ urls: config.turnUrl });
      this.config.iceServers = servers;
    }
  }

  joinRoom(roomId, secret, joinToken) {
    const device = this.app.getDeviceInfo();
    this.socket.emit('join-room', { roomId, secret, joinToken, device });
  }

  bindSocket() {
    this.socket.on('room-joined', data => {
      this.initiator = data.initiator;
      this.app.roomJoined(data);
      const peer = data.participants.find(p => p.socketId !== this.socket.id);
      if (peer) this.peerSocketId = peer.socketId;
    });
    this.socket.on('join-error', error => this.app.joinError(error));
    this.socket.on('peer-connected', event => {
      this.peerSocketId = event.participant.socketId;
      this.app.peerConnected(event.participant.device);
      this.ensurePeerConnection();
      if (this.initiator) this.createOffer();
    });
    this.socket.on('signal', async event => {
      if (!this.pc) this.ensurePeerConnection();
      const { data } = event;
      try {
        if (data.description) {
          await this.pc.setRemoteDescription(data.description);
          if (data.description.type === 'offer') {
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.sendSignal({ description: this.pc.localDescription });
          }
        } else if (data.candidate) {
          await this.pc.addIceCandidate(data.candidate);
        }
      } catch (error) { this.app.setConnectionStatus('error', 'Connection negotiation failed'); }
    });
    this.socket.on('peer-disconnected', () => this.app.peerDisconnected());
    this.socket.on('disconnect', reason => {
      if (reason !== 'io client disconnect') this.app.setConnectionStatus('error', 'Signaling reconnecting…');
    });
    this.socket.on('connect', () => {
      if (this.app.room?.roomId) {
        this.joinRoom(this.app.room.roomId, this.app.room.secret, this.app.room.joinToken);
        this.app.toast('Signaling reconnected.', 'success');
      }
    });
  }

  ensurePeerConnection() {
    if (this.pc) return;
    this.pc = new RTCPeerConnection(this.config);
    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      if (state === 'connected' || state === 'completed') {
        if (this.iceRecoveryTimer) clearTimeout(this.iceRecoveryTimer);
        this.iceRecoveryTimer = null;
        this.app.setConnectionStatus('connected', 'P2P connected');
      } else if (state === 'disconnected') {
        this.app.setConnectionStatus('waiting', 'Peer connection interrupted — recovering…');
        if (!this.iceRecoveryTimer) {
          this.iceRecoveryTimer = setTimeout(() => {
            if (this.pc?.iceConnectionState === 'disconnected') {
              try { this.pc.restartIce(); } catch {}
              if (this.initiator) this.createOffer();
            }
          }, 5000);
        }
      } else if (state === 'failed') {
        if (this.iceRecoveryTimer) clearTimeout(this.iceRecoveryTimer);
        this.app.setConnectionStatus('error', 'Connection failed — a TURN server may be required');
      }
    };
    this.pc.onicecandidate = event => {
      if (event.candidate) this.sendSignal({ candidate: event.candidate });
    };
    this.pc.ondatachannel = event => {
      const channel = event.channel;
      if (channel.label === 'global-share-text') this.setupTextChannel(channel);
      else if (channel.label.startsWith('global-share-file-')) this.app.transfer.setupIncomingChannel(channel);
    };
  }

  async createOffer() {
    if (!this.pc || this.negotiating) return;
    this.negotiating = true;
    try {
      if (!this.textChannel || this.textChannel.readyState !== 'open') this.createTextChannel();
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sendSignal({ description: this.pc.localDescription });
    } catch (error) { this.app.setConnectionStatus('error', 'Could not create connection'); }
    finally { this.negotiating = false; }
  }

  createTextChannel() {
    this.textChannel = this.pc.createDataChannel('global-share-text', { ordered: true });
    this.setupTextChannel(this.textChannel);
  }

  setupTextChannel(channel) {
    this.textChannel = channel;
    channel.onopen = () => this.app.setConnectionStatus('connected', 'P2P connected');
    channel.onclose = () => this.app.setConnectionStatus('waiting', 'Text channel closed');
    channel.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'text') this.app.addMessage(String(message.text).slice(0, 100000), 'in');
      } catch {}
    };
  }

  createFileChannel(id) {
    if (!this.pc) return null;
    const channel = this.pc.createDataChannel(`global-share-file-${id}`, { ordered: true, maxPacketLifeTime: 30000 });
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 32 * 1024;
    return channel;
  }

  sendSignal(data) {
    if (this.peerSocketId) this.socket.emit('signal', { target: this.peerSocketId, data });
  }

  sendText(text) {
    if (this.textChannel?.readyState === 'open') this.textChannel.send(JSON.stringify({ type: 'text', text }));
  }

  isTextReady() { return this.textChannel?.readyState === 'open'; }
  isFileReady() { return this.pc?.connectionState === 'connected' || ['connected', 'completed'].includes(this.pc?.iceConnectionState); }

  disconnect() {
    this.socket.emit('leave-room');
    this.textChannel?.close();
    this.pc?.close();
    this.textChannel = null;
    this.pc = null;
  }
}
