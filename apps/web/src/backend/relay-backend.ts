import { ChunkedTransport, type Transport } from '@promptalong/core';
import { RelayTransport } from '../realtime/relay-transport';
import { getPid } from '../room/identity';
import {
  fromBase64,
  KEEPALIVE_MAX_BODY,
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
 * The local relay (scripts/dev-relay.mjs): the same room rules as the database, kept in memory,
 * so development and end-to-end tests need no hosted service. The browser id stands in for a
 * signed-in user. Not for production.
 */
export class RelayBackend implements RoomBackend {
  readonly server = true;
  private readonly http: string;

  constructor(private readonly wsUrl: string) {
    this.http = wsUrl.replace(/^ws/u, 'http').replace(/\/$/u, '');
  }

  uid(): Promise<string | null> {
    return Promise.resolve(getPid());
  }

  async createRoom(input: {
    code: string;
    name: string;
    displayName: string;
  }): Promise<JoinResult> {
    const res = await this.call('create_room', input);
    return res === null ? { ok: false, reason: 'offline' } : readJoinResult(res);
  }

  async joinRoom(code: string, displayName: string): Promise<JoinResult> {
    const res = await this.call('join_room', { code, displayName });
    return res === null ? { ok: false, reason: 'offline' } : readJoinResult(res);
  }

  async touch(roomId: string): Promise<TouchResult> {
    const res = await this.call('touch_room', { room: roomId });
    return res === null ? { ok: false, reason: 'offline' } : readTouchResult(res);
  }

  leave(roomId: string, state?: Uint8Array): void {
    const body = { room: roomId, ...(state ? { state: toBase64(state) } : {}) };
    void this.call('leave_room', body, JSON.stringify(body).length < KEEPALIVE_MAX_BODY);
  }

  setLocked(roomId: string, locked: boolean): Promise<ActionResult> {
    return this.action('set_room_locked', { room: roomId, locked });
  }

  removeMember(roomId: string, uid: string): Promise<ActionResult> {
    return this.action('remove_member', { room: roomId, target: uid });
  }

  transferHost(roomId: string, uid: string): Promise<ActionResult> {
    return this.action('transfer_host', { room: roomId, target: uid });
  }

  deleteRoom(roomId: string): Promise<ActionResult> {
    return this.action('delete_room', { room: roomId });
  }

  async loadSnapshot(roomId: string): Promise<Uint8Array | null> {
    const res = (await this.call('load_snapshot', { room: roomId })) as { state?: unknown } | null;
    return typeof res?.state === 'string' ? fromBase64(res.state) : null;
  }

  saveSnapshot(roomId: string, state: Uint8Array): Promise<ActionResult> {
    return this.action('save_snapshot', { room: roomId, state: toBase64(state) });
  }

  transport(room: RoomInfo): Transport {
    return new ChunkedTransport(new RelayTransport(this.wsUrl, room.id, getPid()));
  }

  private async action(fn: string, body: Record<string, unknown>): Promise<ActionResult> {
    const res = await this.call(fn, body);
    return res === null ? { ok: false, reason: 'offline' } : readActionResult(res);
  }

  /** POST /api/{fn}; null when the relay cannot be reached. */
  private async call(
    fn: string,
    body: Record<string, unknown>,
    keepalive = false,
  ): Promise<unknown> {
    try {
      const res = await fetch(`${this.http}/api/${fn}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, uid: getPid() }),
        keepalive,
      });
      return (await res.json()) as unknown;
    } catch {
      return null;
    }
  }
}
