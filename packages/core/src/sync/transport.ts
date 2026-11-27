/**
 * A broadcast-style channel, like a Supabase Realtime broadcast channel: a message sent by one
 * client reaches every other client in the same room at most once (it can be lost).
 */
export type TransportStatus = 'connecting' | 'online' | 'offline';

export type WireType = 'sync1' | 'sync2' | 'update' | 'aw';

export interface WireMessage {
  /** message type */
  t: WireType;
  /** sender session id */
  from: string;
  /** receiver session id; missing = everyone */
  to?: string;
  /** per-sender sequence number (updates only) */
  seq?: number;
  /** "answer only if I am missing something" (periodic re-sync, gap repair, replies) */
  r?: 1;
  /** base64 payload */
  d: string;
  /** set on one part of a message sent in parts (see chunks.ts) */
  c?: { id: string; i: number; n: number };
}

export interface Transport {
  readonly status: TransportStatus;
  connect(): void;
  disconnect(): void;
  send(message: WireMessage): void;
  onMessage(listener: (message: WireMessage) => void): () => void;
  onStatus(listener: (status: TransportStatus) => void): () => void;
}

const TYPES = new Set<string>(['sync1', 'sync2', 'update', 'aw']);

/** Validates a message received from the network (anything else is ignored). */
export function parseWireMessage(value: unknown): WireMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.t !== 'string' || !TYPES.has(v.t)) return null;
  if (typeof v.from !== 'string' || v.from.length === 0 || v.from.length > 64) return null;
  if (typeof v.d !== 'string' || v.d.length > 400_000) return null;
  if (v.to !== undefined && typeof v.to !== 'string') return null;
  if (v.seq !== undefined && (typeof v.seq !== 'number' || !Number.isInteger(v.seq))) return null;
  const msg: WireMessage = { t: v.t as WireType, from: v.from, d: v.d };
  if (typeof v.to === 'string') msg.to = v.to;
  if (typeof v.seq === 'number') msg.seq = v.seq;
  if (v.r === 1) msg.r = 1;
  if (v.c !== undefined) {
    const c = v.c as Record<string, unknown> | null;
    if (typeof c !== 'object' || c === null) return null;
    const { id, i, n } = c;
    if (typeof id !== 'string' || id.length === 0 || id.length > 32) return null;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 2 || n > 128) return null;
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= n) return null;
    msg.c = { id, i, n };
  }
  return msg;
}
