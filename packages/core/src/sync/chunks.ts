import type { Transport, TransportStatus, WireMessage } from './transport';

/**
 * Big changes in parts. A broadcast message may be at most 256 KB on the free realtime plan, and a
 * room change can be far larger (a 1 MB context item, a whole room for someone who just joined).
 * Messages whose payload is longer than CHUNK_CHARS are sent as numbered parts and put back
 * together on the other side. Parts are paced so a big change does not run into the per-second
 * message limit. A part that never arrives just drops that message: RoomSync's periodic re-sync
 * repairs it, as for any lost message.
 */
export const CHUNK_CHARS = 160_000;
/** the most parts one message may have (~20 MB of base64) */
export const CHUNK_MAX_PARTS = 128;
/** parts per second sent by one page */
export const CHUNK_RATE = 8;
/** an unfinished message is dropped after this long */
export const CHUNK_TIMEOUT_MS = 60_000;

export interface ChunkInfo {
  /** message id, the same in every part */
  id: string;
  /** part number, from 0 */
  i: number;
  /** number of parts */
  n: number;
}

function chunkId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** One message, or its parts when the payload is too long for one broadcast. */
export function splitMessage(message: WireMessage, max = CHUNK_CHARS): WireMessage[] {
  if (message.d.length <= max) return [message];
  const n = Math.ceil(message.d.length / max);
  if (n > CHUNK_MAX_PARTS) return [];
  const id = chunkId();
  const parts: WireMessage[] = [];
  for (let i = 0; i < n; i++) {
    parts.push({ ...message, d: message.d.slice(i * max, (i + 1) * max), c: { id, i, n } });
  }
  return parts;
}

interface Pending {
  parts: (string | undefined)[];
  got: number;
  first: WireMessage;
  at: number;
}

/** Puts parts back together. Whole messages pass straight through. */
export class Reassembler {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly now: () => number = Date.now) {}

  push(message: WireMessage): WireMessage | null {
    if (this.pending.size > 0) this.expire();
    const c = message.c;
    if (!c) return message;
    const key = `${message.from}:${c.id}`;
    let p = this.pending.get(key);
    if (!p) {
      p = {
        parts: new Array<string | undefined>(c.n).fill(undefined),
        got: 0,
        first: message,
        at: this.now(),
      };
      this.pending.set(key, p);
    }
    if (p.parts.length !== c.n || p.parts[c.i] !== undefined) return null;
    p.parts[c.i] = message.d;
    p.got += 1;
    if (p.got < c.n) return null;
    this.pending.delete(key);
    const whole: WireMessage = { ...p.first, d: p.parts.join('') };
    delete whole.c;
    return whole;
  }

  /** messages still waiting for parts */
  get size(): number {
    return this.pending.size;
  }

  private expire(): void {
    const now = this.now();
    for (const [key, p] of this.pending) {
      if (now - p.at > CHUNK_TIMEOUT_MS) this.pending.delete(key);
    }
  }
}

/** Wraps a transport: long messages go out in paced parts and come back whole. */
export class ChunkedTransport implements Transport {
  private readonly reassembler = new Reassembler();
  private readonly queue: WireMessage[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastPart = 0;

  constructor(
    private readonly inner: Transport,
    private readonly options: { max?: number; rate?: number } = {},
  ) {}

  get status(): TransportStatus {
    return this.inner.status;
  }

  connect(): void {
    this.inner.connect();
  }

  disconnect(): void {
    this.queue.length = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.inner.disconnect();
  }

  send(message: WireMessage): void {
    const parts = splitMessage(message, this.options.max ?? CHUNK_CHARS);
    if (parts.length === 1 && !parts[0]?.c) {
      this.inner.send(message);
      return;
    }
    this.queue.push(...parts);
    this.pump();
  }

  private pump(): void {
    if (this.timer) return;
    const gap = 1000 / (this.options.rate ?? CHUNK_RATE);
    const next = () => {
      this.timer = null;
      const part = this.queue.shift();
      if (!part) return;
      this.lastPart = Date.now();
      this.inner.send(part);
      if (this.queue.length > 0) this.timer = setTimeout(next, gap);
    };
    const wait = Math.max(0, this.lastPart + gap - Date.now());
    if (wait === 0) next();
    else this.timer = setTimeout(next, wait);
  }

  onMessage(listener: (message: WireMessage) => void): () => void {
    return this.inner.onMessage((m) => {
      const whole = this.reassembler.push(m);
      if (whole) listener(whole);
    });
  }

  onStatus(listener: (status: TransportStatus) => void): () => void {
    return this.inner.onStatus(listener);
  }
}
