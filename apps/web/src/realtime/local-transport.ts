import type { Transport, TransportStatus } from '@promptalong/core';

/** No realtime configured: the room lives only on this device. */
export class LocalOnlyTransport implements Transport {
  private _status: TransportStatus = 'offline';
  private readonly statusListeners = new Set<(s: TransportStatus) => void>();

  get status(): TransportStatus {
    return this._status;
  }

  connect(): void {
    this.set('online');
  }

  disconnect(): void {
    this.set('offline');
  }

  send(): void {
    // nowhere to send
  }

  onMessage(): () => void {
    return () => undefined;
  }

  onStatus(listener: (s: TransportStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private set(status: TransportStatus): void {
    if (status === this._status) return;
    this._status = status;
    for (const l of this.statusListeners) l(status);
  }
}
