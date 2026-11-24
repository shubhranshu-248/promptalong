import type { Transport, TransportStatus, WireMessage } from './transport';

/**
 * An in-memory broadcast channel for tests. Delivery is asynchronous, like the network, and can
 * drop messages or take a transport offline.
 */
export class MemoryHub {
  private readonly members = new Set<MemoryTransport>();
  dropRate = 0;
  delayMs = 0;
  delivered = 0;
  private seed: number;

  constructor(seed = 1) {
    this.seed = seed;
  }

  createTransport(): MemoryTransport {
    return new MemoryTransport(this);
  }

  /** deterministic pseudo-random number in [0, 1) */
  random(): number {
    this.seed = (this.seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return this.seed / 2_147_483_648;
  }

  /** @internal */
  join(t: MemoryTransport): void {
    this.members.add(t);
  }

  /** @internal */
  leave(t: MemoryTransport): void {
    this.members.delete(t);
  }

  /** @internal */
  broadcast(from: MemoryTransport, message: WireMessage): void {
    const copy = JSON.parse(JSON.stringify(message)) as WireMessage;
    for (const m of this.members) {
      if (m === from || m.status !== 'online') continue;
      if (this.dropRate > 0 && this.random() < this.dropRate) continue;
      setTimeout(() => {
        if (m.status === 'online') {
          this.delivered += 1;
          m.deliver(copy);
        }
      }, this.delayMs);
    }
  }
}

export class MemoryTransport implements Transport {
  private _status: TransportStatus = 'offline';
  private readonly messageListeners = new Set<(m: WireMessage) => void>();
  private readonly statusListeners = new Set<(s: TransportStatus) => void>();
  private wanted = false;
  private networkUp = true;

  constructor(private readonly hub: MemoryHub) {}

  get status(): TransportStatus {
    return this._status;
  }

  connect(): void {
    this.wanted = true;
    this.update();
  }

  disconnect(): void {
    this.wanted = false;
    this.update();
  }

  /** Simulates the network going down or coming back. */
  setNetwork(up: boolean): void {
    this.networkUp = up;
    this.update();
  }

  send(message: WireMessage): void {
    if (this._status === 'online') this.hub.broadcast(this, message);
  }

  onMessage(listener: (m: WireMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatus(listener: (s: TransportStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** @internal */
  deliver(message: WireMessage): void {
    for (const l of this.messageListeners) l(message);
  }

  private update(): void {
    const next: TransportStatus = this.wanted && this.networkUp ? 'online' : 'offline';
    if (next === 'online') this.hub.join(this);
    else this.hub.leave(this);
    if (next === this._status) return;
    this._status = next;
    for (const l of this.statusListeners) l(next);
  }
}
