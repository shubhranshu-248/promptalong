import type { MemoryHub, Transport } from '@promptalong/core';
import type { ActionResult, JoinResult, RoomBackend, RoomInfo, TouchResult } from './types';

interface Seat {
  slot: number;
  removed: boolean;
}

interface StoredRoom {
  info: RoomInfo;
  seats: Map<string, Seat>;
  snapshot: Uint8Array | null;
  saves: { by: string; bytes: number }[];
}

/** One in-memory "server" shared by several people's backends (tests only). */
export class MemoryServer {
  readonly rooms = new Map<string, StoredRoom>();
  online = true;
  private next = 1;

  constructor(readonly hub: MemoryHub) {}

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
    };
    this.world.rooms.set(info.id, {
      info,
      seats: new Map([[this.me, { slot: 1, removed: false }]]),
      snapshot: null,
      saves: [],
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
    if (!seat && room.seats.size >= 8) {
      return Promise.resolve({ ok: false, reason: 'full', name: room.info.name });
    }
    const slot = seat?.slot ?? room.seats.size + 1;
    room.seats.set(this.me, { slot, removed: false });
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

  leave(): void {
    // seats are kept: a person who left may come back
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
    });
  }

  transferHost(roomId: string, uid: string): Promise<ActionResult> {
    return this.asHost(roomId, (room) => {
      room.info.hostUid = uid;
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

  private asHost(roomId: string, change: (room: StoredRoom) => void): Promise<ActionResult> {
    if (!this.world.online) return Promise.resolve({ ok: false, reason: 'offline' });
    const room = this.world.rooms.get(roomId);
    if (room?.info.hostUid !== this.me) return Promise.resolve({ ok: false, reason: 'not-host' });
    change(room);
    return Promise.resolve({ ok: true });
  }
}
