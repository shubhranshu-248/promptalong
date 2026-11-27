import { MemoryHub, type Transport } from '@promptalong/core';
import type {
  ActionResult,
  JoinResult,
  RoomBackend,
  RoomInfo,
  SessionInfo,
  SessionResult,
  SessionsResult,
  TouchResult,
} from './types';

export const ROOM_SIZE = 16;
/** people listed in one session (at most ROOM_SIZE of them are in the room at once) */
export const SESSION_SIZE = 64;
export const SESSIONS_PER_ROOM = 24;

interface StoredSession {
  info: SessionInfo;
  snapshot: Uint8Array | null;
  saves: { by: string; bytes: number }[];
}

interface Seat {
  slot: number;
  removed: boolean;
}

interface StoredRoom {
  info: RoomInfo;
  seats: Map<string, Seat>;
  snapshot: Uint8Array | null;
  saves: { by: string; bytes: number }[];
  sessions: Map<string, StoredSession>;
}

/** One in-memory "server" shared by several people's backends (tests only). */
export class MemoryServer {
  readonly rooms = new Map<string, StoredRoom>();
  online = true;
  private next = 1;
  /** one in-page channel per session (the room's own channel is `hub`) */
  private readonly sessionHubs = new Map<string, MemoryHub>();

  constructor(readonly hub: MemoryHub) {}

  sessionHub(id: string): MemoryHub {
    let hub = this.sessionHubs.get(id);
    if (!hub) {
      hub = new MemoryHub();
      this.sessionHubs.set(id, hub);
    }
    return hub;
  }

  sessionById(id: string): { room: StoredRoom; session: StoredSession } | null {
    for (const room of this.rooms.values()) {
      const session = room.sessions.get(id);
      if (session) return { room, session };
    }
    return null;
  }

  backendFor(uid: string): MemoryBackend {
    return new MemoryBackend(this, uid);
  }

  byCode(code: string): StoredRoom | undefined {
    return [...this.rooms.values()].find((r) => r.info.code === code);
  }

  newId(): string {
    return `room-${String(this.next++)}`;
  }
}

/** The room rules of the database, in memory, for unit tests of the app's side. */
export class MemoryBackend implements RoomBackend {
  readonly server = true;
  touches = 0;

  constructor(
    private readonly world: MemoryServer,
    private readonly me: string,
  ) {}

  uid(): Promise<string | null> {
    return Promise.resolve(this.world.online ? this.me : null);
  }

  createRoom(input: { code: string; name: string }): Promise<JoinResult> {
    if (!this.world.online) return Promise.resolve({ ok: false, reason: 'offline' });
    const existing = this.world.byCode(input.code);
    if (existing) {
      return Promise.resolve(
        existing.info.hostUid === this.me
          ? { ok: true, room: { ...existing.info }, uid: this.me, slot: 1 }
          : { ok: false, reason: 'code-taken' },
      );
    }
    const info: RoomInfo = {
      id: this.world.newId(),
      code: input.code,
      name: input.name,
      hostUid: this.me,
      locked: false,
      sessionsRev: 0,
    };
    const general: SessionInfo = {
      id: `${info.id}-general`,
      roomId: info.id,
      name: 'General',
      isDefault: true,
      members: [this.me],
      createdAt: new Date().toISOString(),
    };
    this.world.rooms.set(info.id, {
      info,
      seats: new Map([[this.me, { slot: 1, removed: false }]]),
      snapshot: null,
      saves: [],
      sessions: new Map([[general.id, { info: general, snapshot: null, saves: [] }]]),
    });
    return Promise.resolve({ ok: true, room: { ...info }, uid: this.me, slot: 1 });
  }

  joinRoom(code: string): Promise<JoinResult> {
    if (!this.world.online) return Promise.resolve({ ok: false, reason: 'offline' });
    const room = this.world.byCode(code);
    if (!room) return Promise.resolve({ ok: false, reason: 'not-found' });
    const seat = room.seats.get(this.me);
    if (seat?.removed)
      return Promise.resolve({ ok: false, reason: 'removed', name: room.info.name });
    if (!seat && room.info.locked) {
      return Promise.resolve({ ok: false, reason: 'locked', name: room.info.name });
    }
    if (!seat && room.seats.size >= ROOM_SIZE) {
      return Promise.resolve({ ok: false, reason: 'full', name: room.info.name });
    }
    const slot = seat?.slot ?? room.seats.size + 1;
    room.seats.set(this.me, { slot, removed: false });
    if (!seat) {
      // a first visit: a place in the room's first session while it has room
      const general = [...room.sessions.values()].find((s) => s.info.isDefault);
      if (general && general.info.members.length < SESSION_SIZE) {
        general.info.members = [...general.info.members, this.me];
        room.info.sessionsRev += 1;
      }
    }
    return Promise.resolve({ ok: true, room: { ...room.info }, uid: this.me, slot });
  }

  touch(roomId: string): Promise<TouchResult> {
    this.touches += 1;
    if (!this.world.online) return Promise.resolve({ ok: false, reason: 'offline' });
    const room = this.world.rooms.get(roomId);
    const seat = room?.seats.get(this.me);
    if (!room || !seat) return Promise.resolve({ ok: false, reason: 'not-member' });
    if (seat.removed) return Promise.resolve({ ok: false, reason: 'removed' });
    return Promise.resolve({ ok: true, room: { ...room.info } });
  }

  leave(roomId: string, state?: Uint8Array): void {
    // seats are kept: a person who left may come back
    if (state) void this.saveSnapshot(roomId, state);
  }

  setLocked(roomId: string, locked: boolean): Promise<ActionResult> {
    return this.asHost(roomId, (room) => {
      room.info.locked = locked;
    });
  }

  removeMember(roomId: string, uid: string): Promise<ActionResult> {
    return this.asHost(roomId, (room) => {
      const seat = room.seats.get(uid);
      if (seat) seat.removed = true;
      for (const s of room.sessions.values()) {
        s.info.members = s.info.members.filter((m) => m !== uid);
      }
      room.info.sessionsRev += 1;
    });
  }

  transferHost(roomId: string, uid: string): Promise<ActionResult> {
    return this.asHost(roomId, (room) => {
      room.info.hostUid = uid;
      room.info.sessionsRev += 1;
    });
  }

  deleteRoom(roomId: string): Promise<ActionResult> {
    return this.asHost(roomId, () => {
      this.world.rooms.delete(roomId);
    });
  }

  loadSnapshot(roomId: string): Promise<Uint8Array | null> {
    const room = this.world.rooms.get(roomId);
    return Promise.resolve(room?.seats.has(this.me) ? room.snapshot : null);
  }

  saveSnapshot(roomId: string, state: Uint8Array): Promise<ActionResult> {
    if (!this.world.online) return Promise.resolve({ ok: false, reason: 'offline' });
    const room = this.world.rooms.get(roomId);
    const seat = room?.seats.get(this.me);
    if (!room || !seat || seat.removed) return Promise.resolve({ ok: false, reason: 'not-member' });
    room.snapshot = state;
    room.saves.push({ by: this.me, bytes: state.length });
    return Promise.resolve({ ok: true });
  }

  transport(): Transport {
    return this.world.hub.createTransport();
  }

  // --- sessions -------------------------------------------------------------------------------

  private canSee(room: StoredRoom, session: StoredSession): boolean {
    const seat = room.seats.get(this.me);
    if (!seat || seat.removed) return false;
    return room.info.hostUid === this.me || session.info.members.includes(this.me);
  }

  private validMembers(room: StoredRoom, members: string[]): boolean {
    const unique = new Set(members);
    if (unique.size !== members.length || unique.size < 1 || unique.size > SESSION_SIZE) {
      return false;
    }
    return members.every((m) => {
      const seat = room.seats.get(m);
      return seat !== undefined && !seat.removed;
    });
  }

  listSessions(roomId: string): Promise<SessionsResult> {
    if (!this.world.online) return Promise.resolve({ ok: false, reason: 'offline' });
    const room = this.world.rooms.get(roomId);
    const seat = room?.seats.get(this.me);
    if (!room || !seat) return Promise.resolve({ ok: false, reason: 'not-member' });
    if (seat.removed) return Promise.resolve({ ok: false, reason: 'removed' });
    const sessions = [...room.sessions.values()]
      .filter((s) => this.canSee(room, s))
      .map((s) => ({ ...s.info, members: [...s.info.members] }));
    return Promise.resolve({ ok: true, rev: room.info.sessionsRev, sessions });
  }

  createSession(roomId: string, name: string, members: string[]): Promise<SessionResult> {
    if (!this.world.online) return Promise.resolve({ ok: false, reason: 'offline' });
    const room = this.world.rooms.get(roomId);
    if (room?.info.hostUid !== this.me) return Promise.resolve({ ok: false, reason: 'not-host' });
    if (room.sessions.size >= SESSIONS_PER_ROOM) {
      return Promise.resolve({ ok: false, reason: 'too-many' });
    }
    const clean = name.trim().slice(0, 40);
    if (!clean || !this.validMembers(room, members)) {
      return Promise.resolve({ ok: false, reason: 'invalid' });
    }
    const info: SessionInfo = {
      id: `${roomId}-${this.world.newId()}`,
      roomId,
      name: clean,
      isDefault: false,
      members: [...members],
      createdAt: new Date().toISOString(),
    };
    room.sessions.set(info.id, { info, snapshot: null, saves: [] });
    room.info.sessionsRev += 1;
    return Promise.resolve({ ok: true, session: { ...info, members: [...members] } });
  }

  updateSession(
    sessionId: string,
    patch: { name?: string; members?: string[] },
  ): Promise<SessionResult> {
    if (!this.world.online) return Promise.resolve({ ok: false, reason: 'offline' });
    const found = this.world.sessionById(sessionId);
    if (found?.room.info.hostUid !== this.me) {
      return Promise.resolve({ ok: false, reason: 'not-host' });
    }
    const { room, session } = found;
    const name = patch.name === undefined ? session.info.name : patch.name.trim().slice(0, 40);
    if (!name || (patch.members && !this.validMembers(room, patch.members))) {
      return Promise.resolve({ ok: false, reason: 'invalid' });
    }
    session.info.name = name;
    if (patch.members) session.info.members = [...patch.members];
    room.info.sessionsRev += 1;
    return Promise.resolve({
      ok: true,
      session: { ...session.info, members: [...session.info.members] },
    });
  }

  deleteSession(sessionId: string): Promise<ActionResult> {
    if (!this.world.online) return Promise.resolve({ ok: false, reason: 'offline' });
    const found = this.world.sessionById(sessionId);
    if (found?.room.info.hostUid !== this.me) {
      return Promise.resolve({ ok: false, reason: 'not-host' });
    }
    if (found.session.info.isDefault) return Promise.resolve({ ok: false, reason: 'invalid' });
    found.room.sessions.delete(sessionId);
    found.room.info.sessionsRev += 1;
    return Promise.resolve({ ok: true });
  }

  loadSessionSnapshot(sessionId: string): Promise<Uint8Array | null> {
    const found = this.world.sessionById(sessionId);
    return Promise.resolve(
      found && this.canSee(found.room, found.session) ? found.session.snapshot : null,
    );
  }

  saveSessionSnapshot(sessionId: string, state: Uint8Array): Promise<ActionResult> {
    if (!this.world.online) return Promise.resolve({ ok: false, reason: 'offline' });
    const found = this.world.sessionById(sessionId);
    if (!found || !this.canSee(found.room, found.session)) {
      return Promise.resolve({ ok: false, reason: 'not-member' });
    }
    found.session.snapshot = state;
    found.session.saves.push({ by: this.me, bytes: state.length });
    return Promise.resolve({ ok: true });
  }

  saveSessionOnLeave(sessionId: string, state: Uint8Array): void {
    void this.saveSessionSnapshot(sessionId, state);
  }

  sessionTransport(_room: RoomInfo, sessionId: string): Transport {
    return this.world.sessionHub(sessionId).createTransport();
  }

  private asHost(roomId: string, change: (room: StoredRoom) => void): Promise<ActionResult> {
    if (!this.world.online) return Promise.resolve({ ok: false, reason: 'offline' });
    const room = this.world.rooms.get(roomId);
    if (room?.info.hostUid !== this.me) return Promise.resolve({ ok: false, reason: 'not-host' });
    change(room);
    return Promise.resolve({ ok: true });
  }
}
