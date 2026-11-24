#!/usr/bin/env node
// Local broadcast relay for development and end-to-end tests. It behaves like a realtime broadcast
// channel: a text message from one socket goes to every other socket in the same room. It keeps no
// state. Not for production.
//
//   node scripts/dev-relay.mjs            (port 8787, or RELAY_PORT)
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.RELAY_PORT ?? 8787);
const MAX_PAYLOAD = 512 * 1024;
const ROOM_RE = /^[A-Za-z0-9-]{1,32}$/u;

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const rooms = new Map();
let messages = 0;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify({ ok: true, rooms: rooms.size, messages }));
});

const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const room = url.searchParams.get('room') ?? '';
  if (!ROOM_RE.test(room)) {
    socket.close(1008, 'bad room');
    return;
  }
  let members = rooms.get(room);
  if (!members) {
    members = new Set();
    rooms.set(room, members);
  }
  members.add(socket);

  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    messages += 1;
    const text = data.toString();
    for (const peer of members) {
      if (peer !== socket && peer.readyState === peer.OPEN) peer.send(text);
    }
  });

  socket.on('close', () => {
    members.delete(socket);
    if (members.size === 0) rooms.delete(room);
  });
});

server.listen(PORT, () => {
  console.log(`relay listening on ws://localhost:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    wss.close();
    server.close(() => process.exit(0));
  });
}
