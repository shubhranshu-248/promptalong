import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { decode64, encode64 } from './base64';
import type { Transport, TransportStatus, WireMessage } from './transport';

/**
 * Keeps one Yjs room document and its awareness in sync over a broadcast Transport.
 *
 * - Join / reconnect: state-vector exchange in both directions (sync1 -> sync2).
 * - Local edits: coalesced (50 ms, or 100 ms with more than 3 people) into one update with a
 *   per-sender sequence number. A gap in a sender's sequence triggers a targeted re-sync.
 * - Awareness (cursors, names): at most one message per 100 ms from each person.
 * - Every 20 s a light re-sync; peers answer only when the asker is missing something.
 */
export type SyncState = 'offline' | 'connecting' | 'synced' | 'alone';

export interface RoomSyncOptions {
  /** coalescing window for up to 3 people (ms) */
  coalesceMs?: number;
  /** coalescing window for bigger rooms (ms) */
  coalesceBusyMs?: number;
  awarenessThrottleMs?: number;
  resyncMs?: number;
  /** how long to wait for an answer before deciding nobody else is here (ms) */
  aloneAfterMs?: number;
  /** session id; random by default */
  id?: string;
}

export interface SyncStats {
  sent: number;
  received: number;
  bytesSent: number;
  bytesReceived: number;
  gaps: number;
  byType: Record<string, number>;
}

type Listener<T> = (value: T) => void;

const EMPTY_UPDATE_MAX = 2; // Y.encodeStateAsUpdate of "nothing new" is 2 bytes

export class RoomSync {
  readonly id: string;
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly stats: SyncStats = {
    sent: 0,
    received: 0,
    bytesSent: 0,
    bytesReceived: 0,
    gaps: 0,
    byType: {},
  };

  private readonly transport: Transport;
  private readonly opts: Required<Omit<RoomSyncOptions, 'id'>>;
  private pending: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private awTimer: ReturnType<typeof setTimeout> | null = null;
  private awLastSent = 0;
  private aloneTimer: ReturnType<typeof setTimeout> | null = null;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private readonly lastSeq = new Map<string, number>();
  private readonly knownPeers = new Set<string>();
  private _state: SyncState = 'offline';
  private readonly stateListeners = new Set<Listener<SyncState>>();
  private readonly cleanups: (() => void)[] = [];
  private destroyed = false;

  constructor(
    doc: Y.Doc,
    awareness: awarenessProtocol.Awareness,
    transport: Transport,
    options: RoomSyncOptions = {},
  ) {
    this.doc = doc;
    this.awareness = awareness;
    this.transport = transport;
    this.id = options.id ?? randomId();
    this.opts = {
      coalesceMs: options.coalesceMs ?? 50,
      coalesceBusyMs: options.coalesceBusyMs ?? 100,
      awarenessThrottleMs: options.awarenessThrottleMs ?? 100,
      resyncMs: options.resyncMs ?? 20_000,
      aloneAfterMs: options.aloneAfterMs ?? 1_500,
    };

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      this.pending.push(update);
      this.scheduleFlush();
    };
    doc.on('update', onUpdate);
    this.cleanups.push(() => {
      doc.off('update', onUpdate);
    });

    const onAwareness = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === this) return;
      const mine = [...added, ...updated, ...removed].includes(awareness.clientID);
      if (mine) this.scheduleAwareness();
    };
    awareness.on('update', onAwareness);
    this.cleanups.push(() => {
      awareness.off('update', onAwareness);
    });

    this.cleanups.push(
      transport.onMessage((m) => {
        this.receive(m);
      }),
    );
    this.cleanups.push(
      transport.onStatus((s) => {
        this.onTransportStatus(s);
      }),
    );
    this.onTransportStatus(transport.status);
  }

  get state(): SyncState {
    return this._state;
  }

  /** Number of other people (sessions) whose awareness is known. */
  get peerCount(): number {
    let n = 0;
    this.awareness.getStates().forEach((_s, clientId) => {
      if (clientId !== this.awareness.clientID) n++;
    });
    return n;
  }

  onState(listener: Listener<SyncState>): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  connect(): void {
    this.transport.connect();
  }

  /** Sends everything not sent yet, right now. */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pending.length === 0) return;
    if (this.transport.status !== 'online') {
      // Kept in the document; the state-vector exchange on reconnect sends it.
      this.pending = [];
      return;
    }
    const update = this.pending.length === 1 ? this.pending[0] : Y.mergeUpdates(this.pending);
    this.pending = [];
    if (!update) return;
    this.seq += 1;
    this.send({ t: 'update', from: this.id, seq: this.seq, d: encode64(update) });
  }

  /** Tells the others this person left, then stops. */
  destroy(): void {
    if (this.destroyed) return;
    this.flush();
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.awareness.clientID], this);
    if (this.transport.status === 'online') {
      this.send({
        t: 'aw',
        from: this.id,
        d: encode64(
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]),
        ),
      });
    }
    this.destroyed = true;
    for (const c of this.cleanups) c();
    for (const t of [this.flushTimer, this.awTimer, this.aloneTimer]) if (t) clearTimeout(t);
    if (this.resyncTimer) clearInterval(this.resyncTimer);
    this.transport.disconnect();
    this.stateListeners.clear();
  }

  private setState(state: SyncState): void {
    if (state === this._state) return;
    this._state = state;
    for (const l of this.stateListeners) l(state);
  }

  private onTransportStatus(status: TransportStatus): void {
    if (this.destroyed) return;
    if (status === 'online') {
      this.knownPeers.clear();
      this.lastSeq.clear();
      this.setState('connecting');
      this.sendSync1();
      this.sendAwareness();
      if (this.aloneTimer) clearTimeout(this.aloneTimer);
      this.aloneTimer = setTimeout(() => {
        if (this._state === 'connecting') this.setState('alone');
      }, this.opts.aloneAfterMs);
      this.resyncTimer ??= setInterval(() => {
        if (this.transport.status === 'online') this.sendSync1(undefined, true);
      }, this.opts.resyncMs);
    } else {
      this.setState(status === 'offline' ? 'offline' : 'connecting');
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    const wait = this.peerCount + 1 > 3 ? this.opts.coalesceBusyMs : this.opts.coalesceMs;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, wait);
  }

  private scheduleAwareness(): void {
    if (this.awTimer) return;
    const since = Date.now() - this.awLastSent;
    const wait = Math.max(0, this.opts.awarenessThrottleMs - since);
    this.awTimer = setTimeout(() => {
      this.awTimer = null;
      this.sendAwareness();
    }, wait);
  }

  private sendAwareness(to?: string): void {
    if (this.transport.status !== 'online') return;
    if (!this.awareness.getLocalState()) return;
    this.awLastSent = Date.now();
    const msg: WireMessage = {
      t: 'aw',
      from: this.id,
      d: encode64(
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]),
      ),
    };
    if (to) msg.to = to;
    this.send(msg);
  }

  private sendSync1(to?: string, periodic = false): void {
    const msg: WireMessage = {
      t: 'sync1',
      from: this.id,
      d: encode64(Y.encodeStateVector(this.doc)),
    };
    if (to) msg.to = to;
    if (periodic) msg.r = 1;
    this.send(msg);
  }

  private send(message: WireMessage): void {
    this.stats.sent += 1;
    this.stats.bytesSent += message.d.length;
    this.stats.byType[message.t] = (this.stats.byType[message.t] ?? 0) + 1;
    this.transport.send(message);
  }

  private receive(m: WireMessage): void {
    if (this.destroyed || m.from === this.id) return;
    if (m.to !== undefined && m.to !== this.id) return;
    this.stats.received += 1;
    this.stats.bytesReceived += m.d.length;
    let data: Uint8Array;
    try {
      data = decode64(m.d);
    } catch {
      return;
    }
    try {
      switch (m.t) {
        case 'sync1': {
          const diff = Y.encodeStateAsUpdate(this.doc, data);
          const isNew = !this.knownPeers.has(m.from);
          if (!m.r || diff.length > EMPTY_UPDATE_MAX) {
            this.send({ t: 'sync2', from: this.id, to: m.from, d: encode64(diff) });
          }
          // A join / reconnect (no r) or a first contact: ask what they have that we lack.
          // That question is itself marked r, so it never triggers another question back.
          if (!m.r || isNew) {
            this.knownPeers.add(m.from);
            this.sendSync1(m.from, true);
            this.sendAwareness(m.from);
          }
          if (this._state === 'alone') this.setState('synced');
          break;
        }
        case 'sync2': {
          Y.applyUpdate(this.doc, data, this);
          this.knownPeers.add(m.from);
          if (this._state === 'connecting' || this._state === 'alone') this.setState('synced');
          break;
        }
        case 'update': {
          Y.applyUpdate(this.doc, data, this);
          const seq = m.seq ?? 0;
          const last = this.lastSeq.get(m.from);
          if (last !== undefined && seq > last + 1) {
            this.stats.gaps += 1;
            this.sendSync1(m.from, true);
          } else if (last === undefined && !this.knownPeers.has(m.from)) {
            this.knownPeers.add(m.from);
            this.sendSync1(m.from, true);
          }
          if (last === undefined || seq > last) this.lastSeq.set(m.from, seq);
          if (this._state === 'alone' || this._state === 'connecting') this.setState('synced');
          break;
        }
        case 'aw': {
          awarenessProtocol.applyAwarenessUpdate(this.awareness, data, this);
          if (this._state === 'alone') this.setState('synced');
          break;
        }
      }
    } catch {
      // A malformed update from the network must never break the room.
    }
  }
}

export function randomId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
