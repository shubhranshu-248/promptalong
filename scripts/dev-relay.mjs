#!/usr/bin/env node
// Local relay for development and end-to-end tests. Not for production.
//
// It stands in for the hosted backend with the same rules, kept in memory:
//   * a broadcast channel per room (WebSocket): a text message from one socket goes to every other
//     socket in the same room; only people with a seat in the room may connect
//   * the room functions of supabase/migrations (POST /api/{name}, JSON in, JSON out):
//     create_room, join_room, touch_room, leave_room, set_room_locked, remove_member,
//     transfer_host, delete_room, save_snapshot, load_snapshot
// The caller's browser id (`uid` in the body) stands in for a signed-in user. Everything is
// forgotten when the relay stops.
//
//   node scripts/dev-relay.mjs            (port 8787, or RELAY_PORT)
//   RELAY_RATE_LIMITS=1                   also enforce 5 rooms / 30 join attempts per hour
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.RELAY_PORT ?? 8787);
const RATE_LIMITS = process.env.RELAY_RATE_LIMITS === '1';
const MAX_PAYLOAD = 512 * 1024;
const MAX_BODY = 12 * 1024 * 1024;
const MAX_SNAPSHOT = 8 * 1024 * 1024;
const ACTIVE_MS = 90_000;
const CODE_RE = /^[1-9A-HJKMNP-TV-Z]{6}$/u;
const UID_RE = /^[A-Za-z0-9-]{8,64}$/u;

/**
 * @typedef {{ uid: string, slot: number, displayName: string, lastSeen: number, left: boolean, removed: boolean }} Member
 * @typedef {{ id: string, code: string, name: string, hostUid: string, locked: boolean, members: Map<string, Member>, snapshot: string | null }} Room
 */
/** @type {Map<string, Room>} room id -> room */
const rooms = new Map();
/** @type {Map<string, string>} code -> room id */
const codes = new Map();
/** @type {Map<string, Set<import('ws').WebSocket & { uid?: string }>>} room id -> sockets */
const sockets = new Map();
/** @type {Map<string, number[]>} "uid:kind" -> times */
const hits = new Map();
let messages = 0;

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
const roomJson = (r) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  host_uid: r.hostUid,
  locked: r.locked,
});
const cleanLine = (text, max) =>
  String(text ?? '')
    // eslint-disable-next-line no-control-regex -- control characters are what is being removed
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, max)
    .trim();
const seated = (m) => !m.removed && !m.left;
const active = (m, now) => seated(m) && now - m.lastSeen < ACTIVE_MS;

function rateLimited(uid, kind, max) {
  if (!RATE_LIMITS) return false;
  const key = `${uid}:${kind}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= max) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

function kick(roomId, uid) {
  for (const socket of sockets.get(roomId) ?? []) {
    if (uid === null || socket.uid === uid) socket.close(1008, 'no seat');
  }
}

const api = {
  create_room({ uid, code, name, displayName }) {
    const display = cleanLine(displayName, 24);
    if (typeof code !== 'string' || !CODE_RE.test(code) || !display) return fail('invalid');
    const existing = rooms.get(codes.get(code) ?? '');
    if (existing) {
      // asking twice for the same new room (a double click, a re-run effect) is not an error
      if (existing.hostUid !== uid) return fail('code_taken');
      return { ok: true, room: roomJson(existing), slot: 1, uid };
    }
    if (rateLimited(uid, 'create', 5)) return fail('rate_limited');
    /** @type {Room} */
    const room = {
      id: randomUUID(),
      code,
      name: cleanLine(name, 60) || 'Untitled room',
      hostUid: uid,
      locked: false,
      members: new Map(),
      snapshot: null,
    };
    room.members.set(uid, {
      uid,
      slot: 1,
      displayName: display,
      lastSeen: Date.now(),
      left: false,
      removed: false,
    });
    rooms.set(room.id, room);
    codes.set(code, room.id);
    return { ok: true, room: roomJson(room), slot: 1, uid };
  },

  join_room({ uid, code, displayName }) {
    const display = cleanLine(displayName, 24);
    if (typeof code !== 'string' || !CODE_RE.test(code) || !display) return fail('invalid');
    const room = rooms.get(codes.get(code) ?? '');
    if (!room) return rateLimited(uid, 'join', 30) ? fail('rate_limited') : fail('not_found');
    const member = room.members.get(uid);
    if (member?.removed) return fail('removed', { name: room.name });
    const now = Date.now();
    const others = [...room.members.values()].filter((m) => m.uid !== uid && active(m, now));
    if (!member) {
      if (rateLimited(uid, 'join', 30)) return fail('rate_limited');
      if (room.locked) return fail('locked', { name: room.name });
    }
    if (others.length >= 8) return fail('full', { name: room.name });
    const taken = new Set(others.map((m) => m.slot));
    let slot = member && !taken.has(member.slot) ? member.slot : 0;
    for (let s = 1; s <= 8 && slot === 0; s++) if (!taken.has(s)) slot = s;
    room.members.set(uid, {
      uid,
      slot,
      displayName: display,
      lastSeen: now,
      left: false,
      removed: false,
    });
    return { ok: true, room: roomJson(room), slot, uid };
  },

  touch_room({ uid, room: id }) {
    const room = rooms.get(id);
    const member = room?.members.get(uid);
    if (!room || !member) return fail('not_member');
    if (member.removed) return fail('removed');
    member.lastSeen = Date.now();
    member.left = false;
    return { ok: true, room: roomJson(room) };
  },

  leave_room({ uid, room: id }) {
    const member = rooms.get(id)?.members.get(uid);
    if (member && !member.removed) member.left = true;
    return { ok: true };
  },

  set_room_locked({ uid, room: id, locked }) {
    const room = rooms.get(id);
    if (room?.hostUid !== uid) return fail('not_host');
    room.locked = locked === true;
    return { ok: true, locked: room.locked };
  },

  remove_member({ uid, room: id, target }) {
    const room = rooms.get(id);
    if (room?.hostUid !== uid) return fail('not_host');
    if (target === uid) return fail('invalid');
    const member = room.members.get(target);
    if (!member || member.removed) return fail('not_member');
    member.removed = true;
    kick(id, target);
    return { ok: true };
  },

  transfer_host({ uid, room: id, target }) {
    const room = rooms.get(id);
    if (room?.hostUid !== uid) return fail('not_host');
    const member = room.members.get(target);
    if (!member || !seated(member)) return fail('not_member');
    room.hostUid = target;
    return { ok: true, host_uid: target };
  },

  delete_room({ uid, room: id }) {
    const room = rooms.get(id);
    if (room?.hostUid !== uid) return fail('not_host');
    rooms.delete(id);
    codes.delete(room.code);
    kick(id, null);
    return { ok: true };
  },

  save_snapshot({ uid, room: id, state }) {
    const room = rooms.get(id);
    const member = room?.members.get(uid);
    if (!room || !member || !seated(member)) return fail('not_member');
    if (typeof state !== 'string' || state.length === 0 || !/^[A-Za-z0-9+/]+=*$/u.test(state)) {
      return fail('invalid');
    }
    if (Math.floor((state.length * 3) / 4) > MAX_SNAPSHOT) return fail('too_large');
    room.snapshot = state;
    return { ok: true };
  },

  load_snapshot({ uid, room: id }) {
    const room = rooms.get(id);
    const member = room?.members.get(uid);
    if (!room || !member || !seated(member)) return fail('not_member');
    return { ok: true, state: room.snapshot };
  },
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
};

const server = createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', ...CORS });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  const name = /^\/api\/([a-z_]+)$/u.exec(url.pathname)?.[1];
  if (req.method !== 'POST' || !name || !Object.hasOwn(api, name)) {
    send(200, { ok: true, rooms: rooms.size, messages });
    return;
  }
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) req.destroy();
    else chunks.push(chunk);
  });
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      send(400, fail('invalid'));
      return;
    }
    if (typeof body !== 'object' || body === null || !UID_RE.test(String(body.uid))) {
      send(200, fail('not_signed_in'));
      return;
    }
    send(200, api[name](body));
  });
});

const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const roomId = url.searchParams.get('room') ?? '';
  const uid = url.searchParams.get('uid') ?? '';
  const member = rooms.get(roomId)?.members.get(uid);
  // like a private channel: only people with a seat in the room get in
  if (!member || !seated(member)) {
    socket.close(1008, 'no seat');
    return;
  }
  socket.uid = uid;
  let members = sockets.get(roomId);
  if (!members) {
    members = new Set();
    sockets.set(roomId, members);
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
    if (members.size === 0) sockets.delete(roomId);
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
