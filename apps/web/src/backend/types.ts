import type { Transport } from '@promptalong/core';

/**
 * Where rooms live. Three implementations (ADR-006, ADR-008): the Supabase project (production),
 * the local relay with the same rules in memory (development and tests) and "this device only".
 * The rules themselves - who may join, lock, remove - are enforced by the server, never here.
 */
export interface RoomInfo {
  /** the server's id for the room (the code itself when there is no server) */
  id: string;
  code: string;
  /** the name the room was created with */
  name: string;
  hostUid: string;
  locked: boolean;
}

export type AccessFailure =
  | 'not-found'
  | 'locked'
  | 'full'
  | 'removed'
  | 'rate-limited'
  | 'code-taken'
  /** no connection to the server right now */
  | 'offline'
  /** the server refused or sign-in is not possible */
  | 'unavailable';

export type JoinResult =
  | { ok: true; room: RoomInfo; uid: string; slot: number }
  | { ok: false; reason: AccessFailure; name?: string };

export type ActionFailure =
  'not-host' | 'not-member' | 'removed' | 'too-large' | 'offline' | 'unavailable';

export type ActionResult = { ok: true } | { ok: false; reason: ActionFailure };

export type TouchResult =
  | { ok: true; room: RoomInfo }
  | { ok: false; reason: 'removed' | 'not-member' | 'offline' | 'unavailable' };

export interface RoomBackend {
  /** false = no server: rooms live on this device only and cannot be locked */
  readonly server: boolean;
  /** this browser's id on this backend; signs in on first use (null = not possible right now) */
  uid(): Promise<string | null>;
  createRoom(input: { code: string; name: string; displayName: string }): Promise<JoinResult>;
  joinRoom(code: string, displayName: string): Promise<JoinResult>;
  /** heartbeat: keeps the seat and reports what changed on the server */
  touch(roomId: string): Promise<TouchResult>;
  /**
   * Gives the seat back; best effort, also called while the page closes. `state` is this page's
   * last copy of the room, saved in the same request (two requests could arrive in either order).
   */
  leave(roomId: string, state?: Uint8Array): void;
  setLocked(roomId: string, locked: boolean): Promise<ActionResult>;
  removeMember(roomId: string, uid: string): Promise<ActionResult>;
  transferHost(roomId: string, uid: string): Promise<ActionResult>;
  deleteRoom(roomId: string): Promise<ActionResult>;
  loadSnapshot(roomId: string): Promise<Uint8Array | null>;
  saveSnapshot(roomId: string, state: Uint8Array): Promise<ActionResult>;
  /** the room's live channel */
  transport(room: RoomInfo): Transport;
}

/**
 * Browsers cap the body of requests that outlive the page (fetch keepalive) at 64 KiB in total.
 * Bigger "leave" calls go as normal requests: they still arrive when the page is closed in
 * Chromium, maybe not in Firefox or Safari (the seat then frees itself after 90 s, and the room
 * keeps its copy from the last save, at most 30 s older).
 */
export const KEEPALIVE_MAX_BODY = 60 * 1024;

const FAILURES: Record<string, AccessFailure> = {
  not_found: 'not-found',
  locked: 'locked',
  full: 'full',
  removed: 'removed',
  rate_limited: 'rate-limited',
  code_taken: 'code-taken',
};

const ACTIONS: Record<string, ActionFailure> = {
  not_host: 'not-host',
  not_member: 'not-member',
  removed: 'removed',
  too_large: 'too-large',
};

/** Reads a room from a server answer (anything malformed is refused). */
export function readRoomInfo(value: unknown): RoomInfo | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.code !== 'string' || typeof v.host_uid !== 'string') {
    return null;
  }
  return {
    id: v.id.slice(0, 64),
    code: v.code.slice(0, 12),
    name: typeof v.name === 'string' ? v.name.slice(0, 60) : '',
    hostUid: v.host_uid.slice(0, 64),
    locked: v.locked === true,
  };
}

/** The server's JSON answer to create_room / join_room. */
export function readJoinResult(value: unknown): JoinResult {
  if (typeof value !== 'object' || value === null) return { ok: false, reason: 'unavailable' };
  const v = value as Record<string, unknown>;
  if (v.ok === true) {
    const room = readRoomInfo(v.room);
    if (!room || typeof v.uid !== 'string') return { ok: false, reason: 'unavailable' };
    const slot = typeof v.slot === 'number' ? Math.min(8, Math.max(1, Math.round(v.slot))) : 1;
    return { ok: true, room, uid: v.uid.slice(0, 64), slot };
  }
  const reason = FAILURES[String(v.reason)] ?? 'unavailable';
  return typeof v.name === 'string'
    ? { ok: false, reason, name: v.name.slice(0, 60) }
    : { ok: false, reason };
}

export function readActionResult(value: unknown): ActionResult {
  if (typeof value !== 'object' || value === null) return { ok: false, reason: 'unavailable' };
  const v = value as Record<string, unknown>;
  if (v.ok === true) return { ok: true };
  return { ok: false, reason: ACTIONS[String(v.reason)] ?? 'unavailable' };
}

export function readTouchResult(value: unknown): TouchResult {
  if (typeof value !== 'object' || value === null) return { ok: false, reason: 'unavailable' };
  const v = value as Record<string, unknown>;
  if (v.ok === true) {
    const room = readRoomInfo(v.room);
    return room ? { ok: true, room } : { ok: false, reason: 'unavailable' };
  }
  if (v.reason === 'removed') return { ok: false, reason: 'removed' };
  if (v.reason === 'not_member') return { ok: false, reason: 'not-member' };
  return { ok: false, reason: 'unavailable' };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
