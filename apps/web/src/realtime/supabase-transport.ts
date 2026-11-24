import { parseWireMessage, type WireMessage } from '@promptalong/core';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { BaseTransport } from './base-transport';

const EVENT = 'y';
let clientPromise: Promise<SupabaseClient> | null = null;

/** One lazily loaded Supabase client per page (supabase-js is not in the first-load bundle). */
function getClient(url: string, key: string): Promise<SupabaseClient> {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 40 } },
    }),
  );
  return clientPromise;
}

/**
 * Supabase Realtime broadcast channel `room:{code}` (ADR-002, ADR-008: public channel until P6).
 * Delivery is at-most-once; RoomSync repairs gaps.
 */
export class SupabaseTransport extends BaseTransport {
  private channel: RealtimeChannel | null = null;
  private client: SupabaseClient | null = null;
  private opening = false;

  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly room: string,
  ) {
    super();
  }

  send(message: WireMessage): void {
    if (this._status !== 'online' || !this.channel) return;
    void this.channel.send({ type: 'broadcast', event: EVENT, payload: message });
  }

  protected open(): void {
    if (this.channel || this.opening) return;
    this.opening = true;
    this.setStatus('connecting');
    void getClient(this.url, this.key).then(
      (client) => {
        this.opening = false;
        if (!this.wanted || this.channel) return;
        this.client = client;
        const channel = client.channel(`room:${this.room}`, {
          config: { broadcast: { self: false, ack: false } },
        });
        this.channel = channel;
        channel.on('broadcast', { event: EVENT }, (event: { payload?: unknown }) => {
          const msg = parseWireMessage(event.payload);
          if (msg) this.emit(msg);
        });
        channel.subscribe((subscribeStatus) => {
          if (this.channel !== channel) return;
          const status: string = subscribeStatus;
          if (status === 'SUBSCRIBED') this.setStatus(navigator.onLine ? 'online' : 'offline');
          else if (status === 'CLOSED') this.setStatus('offline');
          else this.setStatus('connecting'); // CHANNEL_ERROR / TIMED_OUT: realtime-js rejoins itself
        });
      },
      () => {
        this.opening = false;
        this.setStatus('offline');
      },
    );
  }

  protected close(): void {
    const channel = this.channel;
    this.channel = null;
    if (channel && this.client) void this.client.removeChannel(channel);
  }
}
