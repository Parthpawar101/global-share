# Global Share

Global Share is a real, account-free peer-to-peer file and text sharing app. It uses Socket.IO only for signaling and WebRTC DataChannels for all file and clipboard text transfers.

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`. Create a room on one device, then open the generated link or enter the six-digit code on the second device.

## TURN and network support

STUN helps peers discover their public addresses. It cannot relay traffic when restrictive NAT, carrier-grade NAT, or firewalls block direct WebRTC connections. For reliable worldwide operation, configure a TURN service (coturn or a managed provider) and set `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` on the server.

Do not put static TURN credentials in frontend JavaScript or source control. In production, use coturn REST API credentials (a short-lived username and credential derived from a shared secret) through a server-side credential endpoint. The environment variables document configuration, while frontend configuration deliberately never receives credentials.

Example coturn values:

```text
TURN_URL=turn:turn.example.com:3478?transport=udp
TURN_USERNAME=<short-lived-rest-username>
TURN_CREDENTIAL=<short-lived-rest-credential>
```

## Deployment

1. Deploy to a Node.js host that supports WebSockets and Socket.IO sticky sessions.
2. Set `PUBLIC_URL` to the exact public HTTPS origin, for example `https://share.example.com`.
3. Set `PORT` from the host or leave it at `3000`.
4. Add the STUN URL and production TURN settings.
5. Enable HTTPS/WSS. WebRTC works locally over HTTP, but production camera access and secure deployment require HTTPS.
6. Use sticky sessions or a shared Socket.IO adapter for multiple server instances.

## Security model

Rooms expire after six hours by default. A room has an unpredictable room ID and an unguessable secret embedded in private links. The six-digit code alone cannot authorize entry. WebRTC media and DataChannels are encrypted by DTLS/SCTP. Files never pass through the Express server during normal transfer. Uploaded file contents are held only in browser memory, and the server stores no file or message data.

## Testing checklist

- Create a room and verify the code, link, and QR code.
- Join by code, URL, and camera QR scan.
- Test text sharing in both directions.
- Send multiple files, large files, ZIP, PDF, image, and video files.
- Send files simultaneously from both devices.
- Cancel an outgoing or incoming transfer.
- Test invalid, expired, and full rooms.
- Disconnect a peer and verify cleanup/rejoin behavior.
- Test direct and TURN relayed connections on separate networks.
