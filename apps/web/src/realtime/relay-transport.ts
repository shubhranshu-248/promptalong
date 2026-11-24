import { parseWireMessage, type WireMessage } from '@promptalong/core';
import { BaseTransport } from './base-transport';

/** WebSocket client for the local development / test relay (scripts/dev-relay.mjs). */
export class RelayTransport extends BaseTransport {
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;

  constructor(
    private readonly url: string,
    private readonly room: string,
  ) {
    super();
  }

  send(message: WireMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  protected open(): void {
    if (this.socket) return;
    this.setStatus('connecting');
    const ws = new WebSocket(`${this.url}/?room=${encodeURIComponent(this.room)}`);
    this.socket = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus('online');
    };
    ws.onmessage = (e: MessageEvent<unknown>) => {
      if (typeof e.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(e.data);
      } catch {
        return;
      }
      const msg = parseWireMessage(parsed);
      if (msg) this.emit(msg);
    };
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.setStatus(navigator.onLine ? 'connecting' : 'offline');
      this.scheduleRetry();
    };
    ws.onerror = () => {
      ws.close();
    };
  }

  protected close(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const ws = this.socket;
    this.socket = null;
    ws?.close();
  }

  private scheduleRetry(): void {
    if (!this.wanted || !navigator.onLine || this.retry) return;
    const wait = Math.min(5000, 250 * 2 ** this.attempts);
    this.attempts += 1;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.wanted) this.open();
    }, wait);
  }
}
