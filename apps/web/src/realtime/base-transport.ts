import type { Transport, TransportStatus, WireMessage } from '@promptalong/core';

/** Shared listener plumbing and browser online/offline handling for real transports. */
export abstract class BaseTransport implements Transport {
  protected _status: TransportStatus = 'offline';
  protected wanted = false;
  private readonly messageListeners = new Set<(m: WireMessage) => void>();
  private readonly statusListeners = new Set<(s: TransportStatus) => void>();
  private readonly onOnline = () => {
    if (this.wanted) this.open();
  };
  private readonly onOffline = () => {
    this.close();
    this.setStatus('offline');
  };

  get status(): TransportStatus {
    return this._status;
  }

  connect(): void {
    if (this.wanted) return;
    this.wanted = true;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    if (navigator.onLine) this.open();
    else this.setStatus('offline');
  }

  disconnect(): void {
    this.wanted = false;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    this.close();
    this.setStatus('offline');
  }

  abstract send(message: WireMessage): void;
  protected abstract open(): void;
  protected abstract close(): void;

  onMessage(listener: (m: WireMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatus(listener: (s: TransportStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  protected emit(message: WireMessage): void {
    for (const l of this.messageListeners) l(message);
  }

  protected setStatus(status: TransportStatus): void {
    if (status === this._status) return;
    this._status = status;
    for (const l of this.statusListeners) l(status);
  }
}
