import { TestDb, type Json } from './harness';

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create();
});
afterAll(async () => {
  await db.close();
});

const reason = (res: Json) => (res.ok === true ? 'ok' : String(res.reason));
interface Session {
  id: string;
  name: string;
  is_default: boolean;
  members: string[];
}
const sessionsOf = (res: Json) => (res.sessions ?? []) as Session[];
const sessionOf = (res: Json) => res.session as Session;

/** A room with a host and the given number of other people who joined by code. */
async function roomWith(others: number) {
  const host = await db.user();
  const room = await db.room(host);
  const people: string[] = [];
  for (let i = 0; i < others; i++) {
    const p = await db.user();
    expect(reason(await db.call(p, 'join_room', room.code, `P${String(i + 1)}`))).toBe('ok');
    people.push(p);
  }
  return { host, room, people };
}

describe('sessions', () => {
  it('a new room has a default "General" session with the host in it', async () => {
    const { host, room } = await roomWith(0);
    const res = await db.call(host, 'list_sessions', room.id);
    expect(res.ok).toBe(true);
    expect(sessionsOf(res)).toEqual([
      expect.objectContaining({ name: 'General', is_default: true, members: [host] }),
    ]);
  });

  it('people who join are added to the default session', async () => {
    const { host, room, people } = await roomWith(2);
    const [general] = sessionsOf(await db.call(host, 'list_sessions', room.id));
    expect(general?.members).toEqual([host, ...people]);
  });

  it('only the host creates sessions; members must have a seat; distinct people, at least one', async () => {
    const { host, room, people } = await roomWith(3);
    const [a, b, c] = people as [string, string, string];
    expect(reason(await db.call(a, 'create_session', room.id, 'Pitch', [a, b]))).toBe('not_host');
    const outsider = await db.user();
    expect(reason(await db.call(host, 'create_session', room.id, 'X', [a, outsider]))).toBe(
      'invalid',
    );
    expect(reason(await db.call(host, 'create_session', room.id, 'X', [a, a]))).toBe('invalid');
    expect(reason(await db.call(host, 'create_session', room.id, 'X', []))).toBe('invalid');
    expect(reason(await db.call(host, 'create_session', room.id, '   ', [a]))).toBe('invalid');
    const res = await db.call(host, 'create_session', room.id, '  Pitch\n deck ', [a, c]);
    expect(res.ok).toBe(true);
    expect(sessionOf(res)).toMatchObject({
      name: 'Pitch deck',
      is_default: false,
      members: [a, c],
    });
  });

  it('a session is private: others do not see it, its members, its copy or its channel', async () => {
    const { host, room, people } = await roomWith(3);
    const [a, b, c] = people as [string, string, string];
    const s = sessionOf(await db.call(host, 'create_session', room.id, 'Design', [a, c]));
    expect(reason(await db.call(a, 'save_session_snapshot', s.id, 'AQID'))).toBe('ok');

    // members and the host see it
    for (const who of [a, c, host]) {
      const names = sessionsOf(await db.call(who, 'list_sessions', room.id)).map((x) => x.name);
      expect(names).toContain('Design');
    }
    // b does not, through any door
    expect(sessionsOf(await db.call(b, 'list_sessions', room.id)).map((x) => x.name)).toEqual([
      'General',
    ]);
    expect(await db.as(b, 'select * from public.sessions where id = $1', [s.id])).toEqual([]);
    expect(
      await db.as(b, 'select * from public.session_members where session_id = $1', [s.id]),
    ).toEqual([]);
    expect(
      await db.as(b, 'select * from public.session_snapshots where session_id = $1', [s.id]),
    ).toEqual([]);
    expect(reason(await db.call(b, 'load_session_snapshot', s.id))).toBe('not_member');
    expect(reason(await db.call(b, 'save_session_snapshot', s.id, 'AQID'))).toBe('not_member');
    const topic = `session:${s.id}`;
    expect(await db.as(b, 'select public.can_use_room_topic($1) as ok', [topic])).toEqual([
      { ok: false },
    ]);
    await expect(
      db.as(
        b,
        `insert into realtime.messages (topic, extension, payload) values ($1, 'broadcast', '{}')`,
        [topic],
        topic,
      ),
    ).rejects.toThrow(/row-level security/u);
    for (const who of [a, host]) {
      expect(await db.as(who, 'select public.can_use_room_topic($1) as ok', [topic])).toEqual([
        { ok: true },
      ]);
    }
    expect(await db.call(c, 'load_session_snapshot', s.id)).toMatchObject({
      ok: true,
      state: 'AQID',
    });
  });

  it('a person can be in several sessions at once', async () => {
    const { host, room, people } = await roomWith(4);
    const [a, b, c, d] = people as [string, string, string, string];
    await db.call(host, 'create_session', room.id, 'One', [a, b, c, d]);
    await db.call(host, 'create_session', room.id, 'Two', [a, c, d]);
    const names = (who: string) =>
      db.call(who, 'list_sessions', room.id).then((r) => sessionsOf(r).map((x) => x.name));
    expect(await names(a)).toEqual(['General', 'One', 'Two']);
    expect(await names(b)).toEqual(['General', 'One']);
  });

  it('the host renames, moves people and deletes; members follow at once', async () => {
    const { host, room, people } = await roomWith(3);
    const [a, b, c] = people as [string, string, string];
    const s = sessionOf(await db.call(host, 'create_session', room.id, 'Draft', [a, b]));
    const before = (
      await db.admin<{ sessions_rev: number }>(
        'select sessions_rev from public.rooms where id = $1',
        [room.id],
      )
    )[0]?.sessions_rev;
    expect(reason(await db.call(a, 'update_session', s.id, 'Mine', null))).toBe('not_host');
    const res = await db.call(host, 'update_session', s.id, 'Final', [b, c]);
    expect(sessionOf(res)).toMatchObject({ name: 'Final', members: [b, c] });
    expect(reason(await db.call(a, 'load_session_snapshot', s.id))).toBe('not_member');
    expect(reason(await db.call(c, 'load_session_snapshot', s.id))).toBe('ok');
    const after = (
      await db.admin<{ sessions_rev: number }>(
        'select sessions_rev from public.rooms where id = $1',
        [room.id],
      )
    )[0]?.sessions_rev;
    expect(after).toBeGreaterThan(before ?? 0);
    // the heartbeat tells every page that something changed
    expect(await db.call(a, 'touch_room', room.id)).toMatchObject({
      room: { sessions_rev: after },
    });
    // keep the name, change only the members
    expect(sessionOf(await db.call(host, 'update_session', s.id, null, [a]))).toMatchObject({
      name: 'Final',
      members: [a],
    });
    expect(reason(await db.call(a, 'delete_session', s.id))).toBe('not_host');
    expect(reason(await db.call(host, 'delete_session', s.id))).toBe('ok');
    expect(await db.admin('select * from public.sessions where id = $1', [s.id])).toEqual([]);
  });

  it('the default session cannot be deleted; at most 24 sessions per room', async () => {
    const { host, room } = await roomWith(0);
    const [general] = sessionsOf(await db.call(host, 'list_sessions', room.id));
    expect(reason(await db.call(host, 'delete_session', general?.id))).toBe('invalid');
    for (let i = 1; i < 24; i++) {
      expect(reason(await db.call(host, 'create_session', room.id, `S${String(i)}`, [host]))).toBe(
        'ok',
      );
    }
    expect(reason(await db.call(host, 'create_session', room.id, 'One too many', [host]))).toBe(
      'too_many',
    );
  });

  it('people removed from the room lose their sessions too', async () => {
    const { host, room, people } = await roomWith(2);
    const [a, b] = people as [string, string];
    const s = sessionOf(await db.call(host, 'create_session', room.id, 'Pair', [a, b]));
    await db.call(host, 'remove_member', room.id, a);
    expect(reason(await db.call(a, 'list_sessions', room.id))).toBe('not_member');
    expect(reason(await db.call(a, 'load_session_snapshot', s.id))).toBe('not_member');
    // and cannot be placed in a session again
    expect(reason(await db.call(host, 'update_session', s.id, null, [a, b]))).toBe('invalid');
  });

  it('a session copy is at most 8 MB', async () => {
    const { host, room } = await roomWith(0);
    const [general] = sessionsOf(await db.call(host, 'list_sessions', room.id));
    const big = Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64');
    expect(reason(await db.call(host, 'save_session_snapshot', general?.id, big))).toBe(
      'too_large',
    );
  });
});

describe('rooms of 16', () => {
  it('sixteen people fit with sixteen colours; the seventeenth is refused', async () => {
    const { host, room, people } = await roomWith(15);
    const slots = await db.as<{ slot: number }>(
      host,
      'select slot from public.room_members where room_id = $1 order by slot',
      [room.id],
    );
    expect(slots.map((s) => s.slot)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    const late = await db.user();
    expect(reason(await db.call(late, 'join_room', room.code, 'Late'))).toBe('full');
    // everyone is in the first session: nobody joins a room with nothing to open
    const [general] = sessionsOf(await db.call(host, 'list_sessions', room.id));
    expect(general?.members).toHaveLength(16);
    // a session can hold the whole room
    expect(reason(await db.call(host, 'create_session', room.id, 'All', [host, ...people]))).toBe(
      'ok',
    );
    // someone leaves; the next newcomer gets the seat and a place in the first session too
    expect(reason(await db.call(people[0] ?? '', 'leave_room', room.id))).toBe('ok');
    expect(reason(await db.call(late, 'join_room', room.code, 'Late'))).toBe('ok');
    const [after] = sessionsOf(await db.call(host, 'list_sessions', room.id));
    expect(after?.members).toHaveLength(17);
    expect(after?.members).toContain(late);
    expect(people).toHaveLength(15);
  });
});
