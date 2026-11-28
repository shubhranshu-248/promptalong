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
  /** goes up whenever a session or its members change (0 = no sessions on this backend yet) */
  sessionsRev: number;
}

/** A session of a room: its own conversation and members (private to them and the host). */
export interface SessionInfo {
  id: string;
  roomId: string;
  name: string;
  /** the room's first session; new people are added to it */
  isDefault: boolean;
  /** member ids, in the order the host placed them */
  members: string[];
  createdAt: string;
}

export type SessionsResult =
  { ok: true; rev: number; sessions: SessionInfo[] } | { ok: false; reason: ActionFailure };

export type SessionResult =
  { ok: true; session: SessionInfo } | { ok: false; reason: ActionFailure };

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
  | 'not-host'
  | 'not-member'
  | 'removed'
  | 'too-large'
  | 'too-many'
  | 'invalid'
  | 'offline'
  | 'unavailable';

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

  /** the sessions this person may open (the host: all of them) */
  listSessions(roomId: string): Promise<SessionsResult>;
  /** host only; 1-8 members, each with a seat in the room */
  createSession(roomId: string, name: string, members: string[]): Promise<SessionResult>;
  /** host only; a field left out stays as it is */
  updateSession(
    sessionId: string,
    patch: { name?: string; members?: string[] },
  ): Promise<SessionResult>;
  /** host only; the default session cannot be deleted */
  deleteSession(sessionId: string): Promise<ActionResult>;
  loadSessionSnapshot(sessionId: string): Promise<Uint8Array | null>;
  saveSessionSnapshot(sessionId: string, state: Uint8Array): Promise<ActionResult>;
  /** the last copy of a session while the page closes (a request that outlives the page) */
  saveSessionOnLeave(sessionId: string, state: Uint8Array): void;
  /** a session's live channel (members and the host only) */
  sessionTransport(room: RoomInfo, sessionId: string): Transport;
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
  too_many: 'too-many',
  invalid: 'invalid',
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
    sessionsRev: typeof v.sessions_rev === 'number' ? v.sessions_rev : 0,
  };
}

/** One session from a server answer (anything malformed is refused). */
export function readSessionInfo(value: unknown): SessionInfo | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.name !== 'string' || !Array.isArray(v.members)) {
    return null;
  }
  return {
    id: v.id.slice(0, 64),
    roomId: typeof v.room_id === 'string' ? v.room_id.slice(0, 64) : '',
    name: v.name.slice(0, 40),
    isDefault: v.is_default === true,
    members: v.members.filter((m): m is string => typeof m === 'string').slice(0, 64),
    createdAt: typeof v.created_at === 'string' ? v.created_at : '',
  };
}

export function readSessionsResult(value: unknown): SessionsResult {
  if (typeof value !== 'object' || value === null) return { ok: false, reason: 'unavailable' };
  const v = value as Record<string, unknown>;
  if (v.ok !== true) return { ok: false, reason: ACTIONS[String(v.reason)] ?? 'unavailable' };
  const list = Array.isArray(v.sessions) ? v.sessions : [];
  return {
    ok: true,
    rev: typeof v.rev === 'number' ? v.rev : 0,
    sessions: list.map(readSessionInfo).filter((x): x is SessionInfo => x !== null),
  };
}

export function readSessionResult(value: unknown): SessionResult {
  if (typeof value !== 'object' || value === null) return { ok: false, reason: 'unavailable' };
  const v = value as Record<string, unknown>;
  if (v.ok !== true) return { ok: false, reason: ACTIONS[String(v.reason)] ?? 'unavailable' };
  const session = readSessionInfo(v.session);
  return session ? { ok: true, session } : { ok: false, reason: 'unavailable' };
}

/** The server's JSON answer to create_room / join_room. */
export function readJoinResult(value: unknown): JoinResult {
  if (typeof value !== 'object' || value === null) return { ok: false, reason: 'unavailable' };
  const v = value as Record<string, unknown>;
  if (v.ok === true) {
    const room = readRoomInfo(v.room);
    if (!room || typeof v.uid !== 'string') return { ok: false, reason: 'unavailable' };
    const slot = typeof v.slot === 'number' ? Math.min(16, Math.max(1, Math.round(v.slot))) : 1;
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
