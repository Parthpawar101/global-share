class ClipboardManager {
  constructor(app) { this.app = app; }

  sendText() {
    const input = document.getElementById('textInput');
    const text = input.value;
    if (!text.trim()) return this.app.toast('Type a message first.', 'error');
    if (!this.app.webRTC || !this.app.webRTC.isTextReady()) return this.app.toast('Wait for the peer connection.', 'error');
    this.app.webRTC.sendText(text);
    this.app.addMessage(text, 'out');
    input.value = '';
  }

  async paste() {
    if (!navigator.clipboard?.readText) return this.app.toast('Clipboard access is not supported here.', 'error');
    try {
      const text = await navigator.clipboard.readText();
      const input = document.getElementById('textInput');
      input.value = text;
      input.focus();
      this.app.toast('Clipboard pasted. Review before sending.');
    } catch {
      this.app.toast('Clipboard permission was denied.', 'error');
    }
  }
}
