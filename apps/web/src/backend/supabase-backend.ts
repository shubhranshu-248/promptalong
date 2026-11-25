import type { Transport } from '@promptalong/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseTransport } from '../realtime/supabase-transport';
import {
  fromBase64,
  readActionResult,
  readJoinResult,
  readTouchResult,
  toBase64,
  type ActionResult,
  type JoinResult,
  type RoomBackend,
  type RoomInfo,
  type TouchResult,
} from './types';

/**
 * The Supabase project (ADR-006): anonymous sign-in gives every browser a real user id, rooms are
 * created and joined through SQL functions, and the room channel is private (members only).
 * supabase-js is loaded on first use, so it is not part of the first-load bundle.
 */
export class SupabaseBackend implements RoomBackend {
  readonly server = true;
  private client: Promise<SupabaseClient> | null = null;
  private signIn: Promise<string | null> | null = null;
  /** the last access token seen, for the "page is closing" call that cannot wait */
  private token: string | null = null;

  constructor(
    private readonly url: string,
    private readonly key: string,
    /** how the client is made (tests pass a stand-in) */
    private readonly load: () => Promise<SupabaseClient> = () =>
      import('@supabase/supabase-js').then(({ createClient }) =>
        createClient(url, key, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
            storageKey: 'promptalong:auth',
          },
          realtime: { params: { eventsPerSecond: 40 } },
        }),
      ),
  ) {}

  getClient(): Promise<SupabaseClient> {
    this.client ??= this.load().then((client) => {
      client.auth.onAuthStateChange((_event, session) => {
        this.token = session?.access_token ?? null;
      });
      return client;
    });
    return this.client;
  }

  uid(): Promise<string | null> {
    this.signIn ??= this.ensureUser().then((uid) => {
      // a failed sign-in may be tried again later (offline, rate limit)
      if (uid === null) this.signIn = null;
      return uid;
    });
    return this.signIn;
  }

  async createRoom(input: {
    code: string;
    name: string;
    displayName: string;
  }): Promise<JoinResult> {
    const res = await this.rpc('create_room', {
      p_code: input.code,
      p_name: input.name,
      p_display_name: input.displayName,
    });
    return res.offline ? { ok: false, reason: 'offline' } : readJoinResult(res.data);
  }

  async joinRoom(code: string, displayName: string): Promise<JoinResult> {
    const res = await this.rpc('join_room', { p_code: code, p_display_name: displayName });
    return res.offline ? { ok: false, reason: 'offline' } : readJoinResult(res.data);
  }

  async touch(roomId: string): Promise<TouchResult> {
    const res = await this.rpc('touch_room', { p_room: roomId });
    return res.offline ? { ok: false, reason: 'offline' } : readTouchResult(res.data);
  }

  leave(roomId: string): void {
    if (!this.token) return;
    // the page may be closing: a keepalive request outlives it, supabase-js calls may not
    void fetch(`${this.url}/rest/v1/rpc/leave_room`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'content-type': 'application/json',
        apikey: this.key,
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ p_room: roomId }),
    }).catch(() => undefined);
  }

  setLocked(roomId: string, locked: boolean): Promise<ActionResult> {
    return this.action('set_room_locked', { p_room: roomId, p_locked: locked });
  }

  removeMember(roomId: string, uid: string): Promise<ActionResult> {
    return this.action('remove_member', { p_room: roomId, p_uid: uid });
  }

  transferHost(roomId: string, uid: string): Promise<ActionResult> {
    return this.action('transfer_host', { p_room: roomId, p_uid: uid });
  }

  deleteRoom(roomId: string): Promise<ActionResult> {
    return this.action('delete_room', { p_room: roomId });
  }

  async loadSnapshot(roomId: string): Promise<Uint8Array | null> {
    const res = await this.rpc('load_snapshot', { p_room: roomId });
    const data = res.data as { state?: unknown } | null;
    return typeof data?.state === 'string' ? fromBase64(data.state) : null;
  }

  saveSnapshot(roomId: string, state: Uint8Array): Promise<ActionResult> {
    return this.action('save_snapshot', { p_room: roomId, p_state: toBase64(state) });
  }

  transport(room: RoomInfo): Transport {
    return new SupabaseTransport(() => this.getClient(), `room:${room.id}`);
  }

  private async ensureUser(): Promise<string | null> {
    try {
      const client = await this.getClient();
      const current = await client.auth.getSession();
      if (current.data.session) {
        this.token = current.data.session.access_token;
        return current.data.session.user.id;
      }
      const created = await client.auth.signInAnonymously();
      if (created.error || !created.data.session || !created.data.user) return null;
      this.token = created.data.session.access_token;
      return created.data.user.id;
    } catch {
      return null;
    }
  }

  private async action(fn: string, args: Record<string, unknown>): Promise<ActionResult> {
    const res = await this.rpc(fn, args);
    return res.offline ? { ok: false, reason: 'offline' } : readActionResult(res.data);
  }

  /** Calls a SQL function as the signed-in user. `offline` = the request did not get through. */
  private async rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; offline: boolean }> {
    try {
      if ((await this.uid()) === null) return { data: null, offline: !navigator.onLine };
      const client = await this.getClient();
      const res = await client.rpc(fn, args);
      if (res.error) {
        // PostgREST answers have a code; a failed fetch does not
        return { data: null, offline: !res.error.code };
      }
      const data: unknown = res.data;
      return { data, offline: false };
    } catch {
      return { data: null, offline: true };
    }
  }
}
