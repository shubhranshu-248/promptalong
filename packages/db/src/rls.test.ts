import { TestDb, type Json } from './harness';

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create();
});
afterAll(async () => {
  await db.close();
});

const reason = (res: Json) => (res.ok === true ? 'ok' : String(res.reason));
const roomOf = (res: Json) =>
  res.room as { id: string; code: string; host_uid: string; locked: boolean; name: string };

describe('schema', () => {
  it('every table has row-level security on, and none has a column for a key', async () => {
    const tables = await db.admin<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
    );
    expect(tables.map((t) => t.relname)).toEqual([
      'room_events_rl',
      'room_members',
      'room_snapshots',
      'rooms',
      'session_members',
      'session_snapshots',
      'sessions',
    ]);
    expect(tables.every((t) => t.relrowsecurity)).toBe(true);
    const columns = await db.admin<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public'`,
    );
    const suspicious = columns
      .map((c) => c.column_name)
      .filter((name) => /key|secret|token|password|credential/iu.test(name));
    expect(suspicious).toEqual([]);
  });

  it('every function runs with an empty search_path, and the API ones as their owner', async () => {
    const fns = await db.admin<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      `select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' order by p.proname`,
    );
    expect(fns.length).toBeGreaterThanOrEqual(16);
    for (const f of fns) expect(f.proconfig, f.proname).toContain('search_path=""');
    const invoker = fns.filter((f) => !f.prosecdef).map((f) => f.proname);
    expect(invoker).toEqual(['clean_line', 'room_json']);
  });

  it('a visitor who is not signed in can do nothing', async () => {
    await expect(db.as(null, 'select * from public.rooms')).rejects.toThrow(/permission denied/u);
    await expect(db.call(null, 'join_room', '123456', 'Eve')).rejects.toThrow(/permission denied/u);
    await expect(db.call(null, 'create_room', '123456', 'x', 'Eve')).rejects.toThrow(
      /permission denied/u,
    );
  });

  it('signed-in people cannot call the internal helpers or the clean-up job', async () => {
    const eve = await db.user();
    await expect(db.call(eve, 'rl_hit', eve, 'join', 1000)).rejects.toThrow(/permission denied/u);
    await expect(db.call(eve, 'delete_idle_rooms')).rejects.toThrow(/permission denied/u);
  });
});

describe('create_room', () => {
  it('makes the caller host with the first colour and cleans the names', async () => {
    const aarav = await db.user();
    const code = db.code();
    const res = await db.call(aarav, 'create_room', code, '  Hackathon\n pitch  ', ' Aarav\u0007 ');
    expect(res).toMatchObject({ ok: true, slot: 1, uid: aarav });
    expect(roomOf(res)).toMatchObject({
      code,
      name: 'Hackathon pitch',
      host_uid: aarav,
      locked: false,
    });
    const members = await db.as(aarav, 'select uid, slot, display_name from public.room_members');
    expect(members).toEqual([{ uid: aarav, slot: 1, display_name: 'Aarav' }]);
  });

  it('refuses bad codes, empty names and a code that is taken', async () => {
    const aarav = await db.user();
    expect(reason(await db.call(aarav, 'create_room', 'abc', 'x', 'Aarav'))).toBe('invalid');
    expect(reason(await db.call(aarav, 'create_room', 'K7QM2O', 'x', 'Aarav'))).toBe('invalid'); // O is not in the alphabet
    expect(reason(await db.call(aarav, 'create_room', db.code(), 'x', '   '))).toBe('invalid');
    const { code } = await db.room(aarav);
    expect(reason(await db.call(await db.user(), 'create_room', code, 'x', 'Meera'))).toBe(
      'code_taken',
    );
    // the same person asking again for the same code gets the same room, and it is not counted
    const again = await db.call(aarav, 'create_room', code, 'other name', 'Aarav');
    expect(roomOf(again)).toMatchObject({ code, name: 'Hackathon pitch', host_uid: aarav });
    // an empty room name gets the default
    const res = await db.call(aarav, 'create_room', db.code(), '   ', 'Aarav');
    expect(roomOf(res).name).toBe('Untitled room');
  });

  it('allows 5 rooms per person per hour', async () => {
    const aarav = await db.user();
    for (let i = 0; i < 5; i++) await db.room(aarav);
    expect(reason(await db.call(aarav, 'create_room', db.code(), 'x', 'Aarav'))).toBe(
      'rate_limited',
    );
    // someone else is not affected
    await db.room(await db.user());
    // an hour later it works again
    await db.admin(
      `update public.room_events_rl set at = at - interval '61 minutes' where uid = $1`,
      [aarav],
    );
    await db.room(aarav);
  });
});

describe('join_room', () => {
  it('unknown code -> not_found; a real code gives a seat and the next colour', async () => {
    const aarav = await db.user();
    const meera = await db.user();
    const { id, code } = await db.room(aarav);
    expect(reason(await db.call(meera, 'join_room', db.code(), 'Meera'))).toBe('not_found');
    const res = await db.call(meera, 'join_room', code, 'Meera');
    expect(res).toMatchObject({ ok: true, slot: 2, uid: meera });
    expect(roomOf(res).id).toBe(id);
    // both now see each other, and only this room
    await db.room(await db.user());
    const seen = await db.as(meera, 'select display_name from public.room_members order by slot');
    expect(seen).toEqual([{ display_name: 'Host' }, { display_name: 'Meera' }]);
    expect(await db.as(meera, 'select code from public.rooms')).toEqual([{ code }]);
  });

  it('the 17th person is refused; a seat that went quiet is given away, with its colour', async () => {
    const host = await db.user();
    const { id, code } = await db.room(host);
    const people: string[] = [];
    for (let i = 2; i <= 16; i++) {
      const p = await db.user();
      people.push(p);
      expect(await db.call(p, 'join_room', code, `P${String(i)}`)).toMatchObject({
        ok: true,
        slot: i,
      });
    }
    const late = await db.user();
    expect(await db.call(late, 'join_room', code, 'Late')).toMatchObject({
      ok: false,
      reason: 'full',
      name: 'Hackathon pitch',
    });
    // the person on slot 4 closes their laptop: no heartbeat for two minutes
    const quiet = people[2] ?? '';
    await db.admin(
      `update public.room_members set last_seen_at = now() - interval '2 minutes' where room_id = $1 and uid = $2`,
      [id, quiet],
    );
    expect(await db.call(late, 'join_room', code, 'Late')).toMatchObject({ ok: true, slot: 4 });
    // ... and when they come back the room is full for them
    expect(reason(await db.call(quiet, 'join_room', code, 'P4'))).toBe('full');
  });

  it('coming back keeps the colour; leaving frees the seat', async () => {
    const host = await db.user();
    const meera = await db.user();
    const kabir = await db.user();
    const { id, code } = await db.room(host);
    await db.call(meera, 'join_room', code, 'Meera');
    await db.call(kabir, 'join_room', code, 'Kabir');
    expect(await db.call(meera, 'join_room', code, 'Meera K')).toMatchObject({ ok: true, slot: 2 });
    expect(reason(await db.call(meera, 'leave_room', id))).toBe('ok');
    // someone who left no longer reads the room
    expect(await db.as(meera, 'select code from public.rooms')).toEqual([]);
    const ishita = await db.user();
    expect(await db.call(ishita, 'join_room', code, 'Ishita')).toMatchObject({ ok: true, slot: 2 });
    // Meera returns: her colour is taken now, she gets the next free one
    expect(await db.call(meera, 'join_room', code, 'Meera')).toMatchObject({ ok: true, slot: 4 });
  });

  it('a closing page leaves with its last copy of the room in the same call', async () => {
    const host = await db.user();
    const meera = await db.user();
    const { id, code } = await db.room(host);
    await db.call(meera, 'join_room', code, 'Meera');
    expect(reason(await db.call(meera, 'leave_room', id, 'AQIDBA=='))).toBe('ok');
    expect(await db.call(host, 'load_snapshot', id)).toMatchObject({ ok: true, state: 'AQIDBA==' });
    // the seat is given back even when the copy is refused
    await db.call(meera, 'join_room', code, 'Meera');
    expect(reason(await db.call(meera, 'leave_room', id, 'not base64!'))).toBe('ok');
    expect(await db.as(meera, 'select code from public.rooms')).toEqual([]);
    expect(await db.call(host, 'load_snapshot', id)).toMatchObject({ state: 'AQIDBA==' });
    // someone who already left cannot write the room's copy that way
    expect(reason(await db.call(meera, 'leave_room', id, 'BQY='))).toBe('ok');
    expect(await db.call(host, 'load_snapshot', id)).toMatchObject({ state: 'AQIDBA==' });
  });

  it('counts failed and first attempts: 30 per hour, so codes cannot be guessed in bulk', async () => {
    const host = await db.user();
    const { code } = await db.room(host);
    const member = await db.user();
    await db.call(member, 'join_room', code, 'Member');
    const eve = await db.user();
    for (let i = 0; i < 30; i++) {
      expect(reason(await db.call(eve, 'join_room', db.code(), 'Eve'))).toBe('not_found');
    }
    expect(reason(await db.call(eve, 'join_room', db.code(), 'Eve'))).toBe('rate_limited');
    // even the right code is refused now
    expect(reason(await db.call(eve, 'join_room', code, 'Eve'))).toBe('rate_limited');
    // people who already have a seat are never limited when they come back
    for (let i = 0; i < 40; i++) await db.call(member, 'join_room', code, 'Member');
    expect(reason(await db.call(member, 'join_room', code, 'Member'))).toBe('ok');
  });
});

describe('locked rooms', () => {
  it('reject new people, let members back in, and only the host can lock', async () => {
    const host = await db.user();
    const meera = await db.user();
    const { id, code } = await db.room(host);
    await db.call(meera, 'join_room', code, 'Meera');
    expect(reason(await db.call(meera, 'set_room_locked', id, true))).toBe('not_host');
    expect(await db.call(host, 'set_room_locked', id, true)).toEqual({ ok: true, locked: true });

    const kabir = await db.user();
    expect(await db.call(kabir, 'join_room', code, 'Kabir')).toMatchObject({
      ok: false,
      reason: 'locked',
      name: 'Hackathon pitch',
    });
    expect(await db.as(kabir, 'select * from public.room_members')).toEqual([]);
    // a member reloads the page, or comes back after leaving
    expect(reason(await db.call(meera, 'join_room', code, 'Meera'))).toBe('ok');
    await db.call(meera, 'leave_room', id);
    expect(reason(await db.call(meera, 'join_room', code, 'Meera'))).toBe('ok');
    // the heartbeat tells members the room is locked
    expect(roomOf(await db.call(meera, 'touch_room', id)).locked).toBe(true);

    await db.call(host, 'set_room_locked', id, false);
    expect(reason(await db.call(kabir, 'join_room', code, 'Kabir'))).toBe('ok');
  });
});

describe('host powers', () => {
  it('a removed person is out for good and reads nothing', async () => {
    const host = await db.user();
    const meera = await db.user();
    const kabir = await db.user();
    const { id, code } = await db.room(host);
    await db.call(meera, 'join_room', code, 'Meera');
    await db.call(kabir, 'join_room', code, 'Kabir');
    await db.call(host, 'save_snapshot', id, 'AQID');

    expect(reason(await db.call(meera, 'remove_member', id, kabir))).toBe('not_host');
    expect(reason(await db.call(host, 'remove_member', id, host))).toBe('invalid');
    expect(reason(await db.call(host, 'remove_member', id, await db.user()))).toBe('not_member');
    expect(reason(await db.call(host, 'remove_member', id, kabir))).toBe('ok');

    expect(reason(await db.call(kabir, 'touch_room', id))).toBe('removed');
    expect(reason(await db.call(kabir, 'join_room', code, 'Kabir'))).toBe('removed');
    expect(reason(await db.call(kabir, 'load_snapshot', id))).toBe('not_member');
    expect(reason(await db.call(kabir, 'save_snapshot', id, 'AQID'))).toBe('not_member');
    expect(await db.as(kabir, 'select * from public.rooms')).toEqual([]);
    expect(await db.as(kabir, 'select * from public.room_snapshots')).toEqual([]);
    // leaving does not undo a removal
    await db.call(kabir, 'leave_room', id);
    expect(reason(await db.call(kabir, 'join_room', code, 'Kabir'))).toBe('removed');
    // the others are untouched
    expect(reason(await db.call(meera, 'touch_room', id))).toBe('ok');
  });

  it('the host can hand the room over; the old host loses the powers', async () => {
    const host = await db.user();
    const meera = await db.user();
    const { id, code } = await db.room(host);
    expect(reason(await db.call(host, 'transfer_host', id, meera))).toBe('not_member');
    await db.call(meera, 'join_room', code, 'Meera');
    expect(reason(await db.call(meera, 'transfer_host', id, meera))).toBe('not_host');
    expect(await db.call(host, 'transfer_host', id, meera)).toEqual({ ok: true, host_uid: meera });
    expect(reason(await db.call(host, 'set_room_locked', id, true))).toBe('not_host');
    expect(reason(await db.call(meera, 'set_room_locked', id, true))).toBe('ok');
    expect(roomOf(await db.call(host, 'touch_room', id)).host_uid).toBe(meera);
  });

  it('only the host deletes the room; members then learn it is gone', async () => {
    const host = await db.user();
    const meera = await db.user();
    const { id, code } = await db.room(host);
    await db.call(meera, 'join_room', code, 'Meera');
    await db.call(host, 'save_snapshot', id, 'AQID');
    expect(reason(await db.call(meera, 'delete_room', id))).toBe('not_host');
    expect(reason(await db.call(host, 'delete_room', id))).toBe('ok');
    expect(reason(await db.call(meera, 'touch_room', id))).toBe('not_member');
    expect(reason(await db.call(meera, 'join_room', code, 'Meera'))).toBe('not_found');
    const left = await db.admin(
      `select (select count(*) from public.room_members where room_id = $1)::int as members,
              (select count(*) from public.room_snapshots where room_id = $1)::int as snapshots`,
      [id],
    );
    expect(left).toEqual([{ members: 0, snapshots: 0 }]);
  });
});

describe('row-level security', () => {
  it('a person outside the room cannot read rooms, members or snapshots', async () => {
    const host = await db.user();
    const { id } = await db.room(host);
    await db.call(host, 'save_snapshot', id, 'AQID');
    const eve = await db.user();
    expect(await db.as(eve, 'select * from public.rooms')).toEqual([]);
    expect(await db.as(eve, 'select * from public.rooms where id = $1', [id])).toEqual([]);
    expect(await db.as(eve, 'select * from public.room_members')).toEqual([]);
    expect(await db.as(eve, 'select * from public.room_snapshots')).toEqual([]);
    expect(reason(await db.call(eve, 'load_snapshot', id))).toBe('not_member');
    expect(reason(await db.call(eve, 'save_snapshot', id, 'AQID'))).toBe('not_member');
    expect(reason(await db.call(eve, 'touch_room', id))).toBe('not_member');
    expect(reason(await db.call(eve, 'set_room_locked', id, true))).toBe('not_host');
    expect(reason(await db.call(eve, 'delete_room', id))).toBe('not_host');
    // the host still sees everything of this room
    expect(await db.as(host, 'select count(*)::int as n from public.room_snapshots')).toEqual([
      { n: 1 },
    ]);
  });

  it('nobody writes a table directly, not even a member or the host', async () => {
    const host = await db.user();
    const { id } = await db.room(host);
    const denied = /permission denied/u;
    await expect(
      db.as(host, `update public.rooms set locked = true where id = $1`, [id]),
    ).rejects.toThrow(denied);
    await expect(db.as(host, `delete from public.rooms where id = $1`, [id])).rejects.toThrow(
      denied,
    );
    await expect(
      db.as(host, `insert into public.rooms (code, name, host_uid) values ('ZZZZZZ', 'x', $1)`, [
        host,
      ]),
    ).rejects.toThrow(denied);
    await expect(
      db.as(
        host,
        `insert into public.room_members (room_id, uid, slot, display_name) values ($1, $2, 2, 'x')`,
        [id, await db.user()],
      ),
    ).rejects.toThrow(denied);
    await expect(
      db.as(host, `update public.room_members set removed_at = null where room_id = $1`, [id]),
    ).rejects.toThrow(denied);
    await expect(
      db.as(host, `insert into public.room_snapshots (room_id, state) values ($1, '\\x00')`, [id]),
    ).rejects.toThrow(denied);
    await expect(db.as(host, 'select * from public.room_events_rl')).rejects.toThrow(denied);
    await expect(db.as(host, 'delete from public.room_events_rl')).rejects.toThrow(denied);
  });
});

describe('snapshots', () => {
  it('a member saves and loads the room; the newest save wins', async () => {
    const host = await db.user();
    const meera = await db.user();
    const { id, code } = await db.room(host);
    await db.call(meera, 'join_room', code, 'Meera');
    expect(await db.call(meera, 'load_snapshot', id)).toEqual({ ok: true, state: null });
    const first = Buffer.from('first room state').toString('base64');
    const second = Buffer.from(Uint8Array.from({ length: 5000 }, (_, i) => i % 251)).toString(
      'base64',
    );
    expect(reason(await db.call(host, 'save_snapshot', id, first))).toBe('ok');
    expect(reason(await db.call(meera, 'save_snapshot', id, second))).toBe('ok');
    const loaded = await db.call(host, 'load_snapshot', id);
    expect(loaded.state).toBe(second); // one line of base64, byte for byte
    const row = await db.admin<{ updated_by: string; bytes: number }>(
      'select updated_by, octet_length(state) as bytes from public.room_snapshots where room_id = $1',
      [id],
    );
    expect(row).toEqual([{ updated_by: meera, bytes: 5000 }]);
  });

  it('refuses text that is not base64, empty data and more than 8 MB', async () => {
    const host = await db.user();
    const { id } = await db.room(host);
    expect(reason(await db.call(host, 'save_snapshot', id, '%%% not base64 %%%'))).toBe('invalid');
    expect(reason(await db.call(host, 'save_snapshot', id, ''))).toBe('invalid');
    const big = Buffer.alloc(8 * 1024 * 1024 + 1, 7).toString('base64');
    expect(reason(await db.call(host, 'save_snapshot', id, big))).toBe('too_large');
    expect(await db.call(host, 'load_snapshot', id)).toEqual({ ok: true, state: null });
  });
});

describe('realtime channel', () => {
  it('only people with a seat may receive and send on room:{id}', async () => {
    const host = await db.user();
    const meera = await db.user();
    const eve = await db.user();
    const { id, code } = await db.room(host);
    const other = await db.room(eve);
    await db.call(meera, 'join_room', code, 'Meera');
    const topic = `room:${id}`;
    await db.admin(
      `insert into realtime.messages (topic, extension) values ($1, 'broadcast'), ($1, 'presence')`,
      [topic],
    );

    const receive = (uid: string, t: string) =>
      db.as<{ n: number }>(
        uid,
        `select count(*)::int as n from realtime.messages where extension = 'broadcast'`,
        [],
        t,
      );
    const send = (uid: string, t: string, extension = 'broadcast') =>
      db.as(
        uid,
        `insert into realtime.messages (topic, extension) values ($1, $2)`,
        [t, extension],
        t,
      );

    expect(await receive(meera, topic)).toEqual([{ n: 1 }]);
    expect(await receive(eve, topic)).toEqual([{ n: 0 }]);
    // a member of this room has no access to another room's channel, or to any other topic
    expect(await receive(meera, `room:${other.id}`)).toEqual([{ n: 0 }]);
    expect(await receive(meera, 'room:not-a-room-id')).toEqual([{ n: 0 }]);
    expect(await receive(meera, `room:${code}`)).toEqual([{ n: 0 }]);
    expect(await receive(meera, '')).toEqual([{ n: 0 }]);

    await send(meera, topic);
    await expect(send(eve, topic)).rejects.toThrow(/row-level security/u);
    await expect(send(meera, `room:${other.id}`)).rejects.toThrow(/row-level security/u);
    // presence is not used: only broadcast is allowed
    await expect(send(meera, topic, 'presence')).rejects.toThrow(/row-level security/u);

    // removed by the host -> the channel is closed to them
    await db.call(host, 'remove_member', id, meera);
    expect(await receive(meera, topic)).toEqual([{ n: 0 }]);
    await expect(send(meera, topic)).rejects.toThrow(/row-level security/u);
  });
});

describe('retention', () => {
  it('deletes rooms idle for 30 days, old rate-limit rows and anonymous users without a room', async () => {
    const host = await db.user();
    const idle = await db.room(host);
    await db.call(host, 'save_snapshot', idle.id, 'AQID');
    const fresh = await db.room(await db.user());
    const drifter = await db.user(); // signed in once, never joined anything
    await db.admin(
      `update public.rooms set last_active_at = now() - interval '31 days' where id = $1`,
      [idle.id],
    );
    await db.admin(
      `update public.room_events_rl set at = now() - interval '2 days' where uid = $1`,
      [host],
    );
    await db.admin(
      `update auth.users set created_at = now() - interval '40 days' where id = any($1)`,
      [[host, drifter]],
    );

    const deleted = await db.admin<{ n: number }>('select public.delete_idle_rooms() as n');
    expect(deleted[0]?.n).toBeGreaterThanOrEqual(1);
    const left = await db.admin<{ id: string }>('select id from public.rooms where id = any($1)', [
      [idle.id, fresh.id],
    ]);
    expect(left).toEqual([{ id: fresh.id }]);
    expect(
      await db.admin('select 1 from public.room_snapshots where room_id = $1', [idle.id]),
    ).toEqual([]);
    expect(await db.admin('select 1 from public.room_events_rl where uid = $1', [host])).toEqual(
      [],
    );
    expect(
      await db.admin('select 1 from auth.users where id = any($1)', [[host, drifter]]),
    ).toEqual([]);
  });

  it('activity keeps a room: the heartbeat moves last_active_at forward', async () => {
    const host = await db.user();
    const { id } = await db.room(host);
    await db.admin(
      `update public.rooms set last_active_at = now() - interval '29 days' where id = $1`,
      [id],
    );
    await db.call(host, 'touch_room', id);
    await db.admin('select public.delete_idle_rooms()');
    const row = await db.admin<{ recent: boolean }>(
      `select last_active_at > now() - interval '1 minute' as recent from public.rooms where id = $1`,
      [id],
    );
    expect(row).toEqual([{ recent: true }]);
  });
});
