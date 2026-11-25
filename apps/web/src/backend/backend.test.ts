import type { SupabaseClient } from '@supabase/supabase-js';
import { LocalBackend } from './local-backend';
import { SupabaseBackend } from './supabase-backend';
import { fromBase64, readActionResult, readJoinResult, readTouchResult, toBase64 } from './types';

const ROOM = {
  id: '7b0a6c2e-0000-4000-8000-000000000001',
  code: 'K7QM2X',
  name: 'Hackathon pitch',
  host_uid: 'u-host',
  locked: false,
};

describe('server answers', () => {
  it('a seat: the room, this person and their colour', () => {
    expect(readJoinResult({ ok: true, room: ROOM, slot: 3, uid: 'u-me' })).toEqual({
      ok: true,
      room: {
        id: ROOM.id,
        code: 'K7QM2X',
        name: 'Hackathon pitch',
        hostUid: 'u-host',
        locked: false,
      },
      uid: 'u-me',
      slot: 3,
    });
  });

  it('every refusal the database can give, with the room name when it tells it', () => {
    expect(readJoinResult({ ok: false, reason: 'not_found' })).toEqual({
      ok: false,
      reason: 'not-found',
    });
    expect(readJoinResult({ ok: false, reason: 'locked', name: 'Pitch' })).toEqual({
      ok: false,
      reason: 'locked',
      name: 'Pitch',
    });
    for (const [wire, reason] of [
      ['full', 'full'],
      ['removed', 'removed'],
      ['rate_limited', 'rate-limited'],
      ['code_taken', 'code-taken'],
    ] as const) {
      expect(readJoinResult({ ok: false, reason: wire })).toMatchObject({ reason });
    }
  });

  it('anything unexpected is "unavailable", never a seat', () => {
    for (const bad of [
      null,
      'ok',
      42,
      {},
      { ok: true },
      { ok: true, room: { id: 1 }, uid: 'x' },
      { ok: false, reason: 'weird' },
    ]) {
      expect(readJoinResult(bad)).toMatchObject({ ok: false, reason: 'unavailable' });
    }
    expect(readActionResult({ ok: false, reason: 'not_host' })).toEqual({
      ok: false,
      reason: 'not-host',
    });
    expect(readActionResult({ ok: false, reason: 'too_large' })).toEqual({
      ok: false,
      reason: 'too-large',
    });
    expect(readActionResult(undefined)).toEqual({ ok: false, reason: 'unavailable' });
    expect(readTouchResult({ ok: false, reason: 'removed' })).toEqual({
      ok: false,
      reason: 'removed',
    });
    expect(readTouchResult({ ok: false, reason: 'not_member' })).toEqual({
      ok: false,
      reason: 'not-member',
    });
    expect(readTouchResult({ ok: true, room: { ...ROOM, locked: true } })).toMatchObject({
      ok: true,
      room: { locked: true },
    });
  });

  it('base64 round trip for room snapshots, also large ones', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 31) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(fromBase64('%%%')).toBeNull();
  });
});

/** A stand-in for the supabase-js client: records what the app asks for. */
function fakeClient(options: {
  session?: string | null;
  signIn?: 'ok' | 'refused';
  rpc?: (
    fn: string,
    args: Record<string, unknown>,
  ) => { data?: unknown; error?: { code?: string; message: string } };
}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let session = options.session ?? null;
  let signIns = 0;
  const toSession = (id: string) => ({ access_token: `token-${id}`, user: { id } });
  const client = {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      getSession: () => Promise.resolve({ data: { session: session ? toSession(session) : null } }),
      signInAnonymously: () => {
        signIns += 1;
        if (options.signIn === 'refused') {
          return Promise.resolve({
            data: { session: null, user: null },
            error: { message: 'disabled' },
          });
        }
        session = 'anon-1';
        return Promise.resolve({
          data: { session: toSession('anon-1'), user: { id: 'anon-1' } },
          error: null,
        });
      },
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const res = options.rpc?.(fn, args) ?? { data: { ok: true } };
      return Promise.resolve({ data: res.data ?? null, error: res.error ?? null });
    },
  };
  return { client: client as unknown as SupabaseClient, calls, signIns: () => signIns };
}

describe('SupabaseBackend', () => {
  it('signs in anonymously once, then calls the SQL functions as that user', async () => {
    const fake = fakeClient({
      rpc: (fn) =>
        fn === 'join_room'
          ? { data: { ok: true, room: ROOM, slot: 2, uid: 'anon-1' } }
          : { data: { ok: true } },
    });
    const backend = new SupabaseBackend('https://x.supabase.co', 'public-key', () =>
      Promise.resolve(fake.client),
    );
    expect(await backend.uid()).toBe('anon-1');
    expect(await backend.joinRoom('K7QM2X', 'Meera')).toMatchObject({
      ok: true,
      uid: 'anon-1',
      slot: 2,
    });
    expect(await backend.setLocked(ROOM.id, true)).toEqual({ ok: true });
    expect(await backend.uid()).toBe('anon-1');
    expect(fake.signIns()).toBe(1);
    expect(fake.calls).toEqual([
      { fn: 'join_room', args: { p_code: 'K7QM2X', p_display_name: 'Meera' } },
      { fn: 'set_room_locked', args: { p_room: ROOM.id, p_locked: true } },
    ]);
  });

  it('keeps the user it already has: no second anonymous user after a reload', async () => {
    const fake = fakeClient({ session: 'anon-7' });
    const backend = new SupabaseBackend('u', 'k', () => Promise.resolve(fake.client));
    expect(await backend.uid()).toBe('anon-7');
    expect(fake.signIns()).toBe(0);
  });

  it('sign-in refused (switched off, rate limit): rooms are "unavailable", and it can be tried again', async () => {
    const fake = fakeClient({ signIn: 'refused' });
    const backend = new SupabaseBackend('u', 'k', () => Promise.resolve(fake.client));
    expect(await backend.uid()).toBeNull();
    expect(await backend.joinRoom('K7QM2X', 'Meera')).toEqual({ ok: false, reason: 'unavailable' });
    expect(fake.calls).toEqual([]); // nothing is asked of the database without a user
    expect(fake.signIns()).toBe(2); // each call tried again
  });

  it('tells "no connection" from "the database said no"', async () => {
    let mode: 'network' | 'denied' = 'network';
    const fake = fakeClient({
      session: 'anon-1',
      rpc: () =>
        mode === 'network'
          ? { error: { message: 'TypeError: Failed to fetch' } }
          : { error: { code: '42501', message: 'permission denied for function join_room' } },
    });
    const backend = new SupabaseBackend('u', 'k', () => Promise.resolve(fake.client));
    expect(await backend.joinRoom('K7QM2X', 'Meera')).toEqual({ ok: false, reason: 'offline' });
    expect(await backend.touch(ROOM.id)).toEqual({ ok: false, reason: 'offline' });
    mode = 'denied';
    expect(await backend.joinRoom('K7QM2X', 'Meera')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('snapshots travel as base64 text', async () => {
    const state = Uint8Array.from([1, 2, 3, 250, 251, 252]);
    const fake = fakeClient({
      session: 'anon-1',
      rpc: (fn) =>
        fn === 'load_snapshot'
          ? { data: { ok: true, state: toBase64(state) } }
          : { data: { ok: true } },
    });
    const backend = new SupabaseBackend('u', 'k', () => Promise.resolve(fake.client));
    expect(await backend.saveSnapshot(ROOM.id, state)).toEqual({ ok: true });
    expect(fake.calls[0]).toEqual({
      fn: 'save_snapshot',
      args: { p_room: ROOM.id, p_state: 'AQID+vv8' },
    });
    expect(await backend.loadSnapshot(ROOM.id)).toEqual(state);
  });
});

describe('LocalBackend (no server)', () => {
  it('every code opens on this device; nothing can be locked', async () => {
    const backend = new LocalBackend();
    expect(backend.server).toBe(false);
    const res = await backend.joinRoom('K7QM2X');
    expect(res).toMatchObject({ ok: true, room: { id: 'K7QM2X', code: 'K7QM2X', locked: false } });
    expect(await backend.setLocked()).toEqual({ ok: false, reason: 'unavailable' });
    expect(await backend.loadSnapshot()).toBeNull();
  });
});
