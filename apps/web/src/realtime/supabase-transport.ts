import { parseWireMessage, type WireMessage } from '@promptalong/core';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { BaseTransport } from './base-transport';

const EVENT = 'y';

/**
 * Supabase Realtime broadcast on a private channel `room:{room id}` (ADR-002, ADR-006): only
 * people with a seat in the room may subscribe, checked by the database. Delivery is at-most-once;
 * RoomSync repairs gaps.
 */
export class SupabaseTransport extends BaseTransport {
  private channel: RealtimeChannel | null = null;
  private client: SupabaseClient | null = null;
  private opening = false;

  constructor(
    private readonly getClient: () => Promise<SupabaseClient>,
    private readonly topic: string,
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
    void this.getClient()
      // the channel is authorised with this person's sign-in, not the public key
      .then((client) => client.realtime.setAuth().then(() => client))
      .then(
        (client) => {
          this.opening = false;
          if (!this.wanted || this.channel) return;
          this.client = client;
          const channel = client.channel(this.topic, {
            config: { private: true, broadcast: { self: false, ack: false } },
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
