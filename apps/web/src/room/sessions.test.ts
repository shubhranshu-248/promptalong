import {
  MAIN_BRANCH,
  MemoryHub,
  addContextItem,
  addTurn,
  assembleRoom,
  isRoomItemIncluded,
  listTurns,
  promptFragment,
  promptText,
  setRoomItemIncluded,
  tipOf,
} from '@promptalong/core';
import * as Y from 'yjs';
import { MemoryServer } from '../backend/memory-backend';
import type { RoomInfo } from '../backend/types';
import { sendPrompt } from './send';
import { RoomSession } from './session';
import type { SessionConn } from './session-conn';

const open = new Set<RoomSession>();
afterEach(() => {
  for (const s of open) s.stop();
  open.clear();
});

const until = async (check: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

const TIMINGS = { heartbeatMs: 25, saveQuietMs: 20, saveMaxWaitMs: 60 };

async function enter(
  world: MemoryServer,
  uid: string,
  at: number,
  create = false,
): Promise<{ room: RoomSession; info: RoomInfo }> {
  const backend = world.backendFor(uid);
  const res = create
    ? await backend.createRoom({ code: 'K7QM2X', name: 'Hackathon' })
    : await backend.joinRoom('K7QM2X');
  if (!res.ok) throw new Error(res.reason);
  const room = new RoomSession({
    code: 'K7QM2X',
    pid: uid,
    name: `${uid.slice(0, 1).toUpperCase()}${uid.slice(1)}`,
    transport: backend.transport(),
    access: { backend, room: res.room, slot: res.slot, ...TIMINGS },
    now: () => at,
    ...(create ? { create: { name: 'Hackathon', sendPolicy: 'everyone' as const } } : {}),
  });
  room.start();
  open.add(room);
  return { room, info: res.room };
}

/** Waits for a session to be open in this page with its prompt ready. */
async function ready(room: RoomSession, id: string): Promise<SessionConn> {
  let conn: SessionConn | null = null;
  await until(() => {
    conn = room.conn(id);
    return conn?.getSnapshot().promptReady === true;
  });
  return conn as unknown as SessionConn;
}

function type(doc: Y.Doc, text: string) {
  const node = (promptFragment(doc).get(0) as Y.XmlElement).get(0) as Y.XmlText;
  node.insert(node.length, text);
}

const ids = (room: RoomSession) => room.getSnapshot().sessions.map((s) => s.name);

describe('sessions of a room', () => {
  it('a private session: its members and the host get it, the others never do', async () => {
    const world = new MemoryServer(new MemoryHub());
    const a = await enter(world, 'aarav', 1, true);
    const b = await enter(world, 'meera', 2);
    const c = await enter(world, 'kabir', 3);
    await until(() => [a, b, c].every((p) => p.room.getSnapshot().sessions.length === 1));
    const general = a.room.getSnapshot().sessions[0]?.id ?? '';

    // only the host can make one
    expect(await b.room.createSession('Side', ['meera'])).toEqual({
      ok: false,
      reason: 'not-host',
    });
    const res = await a.room.createSession('Design', ['aarav', 'meera']);
    if (!res.ok) throw new Error(res.reason);
    const design = res.session.id;
    // the host's page opens the new session at once
    expect(a.room.getSnapshot().activeId).toBe(design);

    await until(() => ids(b.room).includes('Design'));
    expect(ids(a.room)).toEqual(['General', 'Design']);
    await new Promise((r) => setTimeout(r, 60));
    expect(ids(c.room)).toEqual(['General']);
    expect(c.room.conn(design)).toBeNull();

    // what is written in Design reaches Meera, never Kabir's page
    const [da, db] = [await ready(a.room, design), await ready(b.room, design)];
    type(da.doc, 'Slide outline');
    await until(() => promptText(db.doc) === 'Slide outline');
    expect(promptFragment(db.doc).length).toBe(1);
    expect(await world.backendFor('kabir').loadSessionSnapshot(design)).toBeNull();
    // General is untouched
    expect(promptText((await ready(c.room, general)).doc)).toBe('');
  });

  it('one person in two sessions at once; the other one counts what is new', async () => {
    const world = new MemoryServer(new MemoryHub());
    const a = await enter(world, 'aarav', 1, true);
    const b = await enter(world, 'meera', 2);
    await until(() => b.room.getSnapshot().sessions.length === 1);
    const general = b.room.getSnapshot().sessions[0]?.id ?? '';
    const res = await a.room.createSession('Code', ['aarav', 'meera']);
    if (!res.ok) throw new Error(res.reason);
    const code = res.session.id;
    await until(() => ids(b.room).includes('Code'));
    // Meera stays in General; Aarav works in Code
    expect(b.room.getSnapshot().activeId).toBe(general);
    const ca = await ready(a.room, code);
    await ready(b.room, code);
    type(ca.doc, '/short a demo script');
    const sent = await sendPrompt(ca);
    expect(sent.ok).toBe(true);
    await until(() => b.room.getSnapshot().sessions.find((s) => s.id === code)?.unread === 2);
    // where people are is shown in the room
    await until(() => b.room.getSnapshot().people.find((p) => p.pid === 'aarav')?.viewing === code);
    // opening it reads it, and Meera's own row says where she is
    b.room.setActive(code);
    expect(b.room.getSnapshot().people.find((p) => p.me)?.viewing).toBe(code);
    expect(b.room.getSnapshot().sessions.find((s) => s.id === code)?.unread).toBe(0);
    expect(b.room.getSnapshot().sessions.find((s) => s.id === general)?.unread).toBe(0);
    expect(b.room.conn(code)?.getSnapshot().turns).toHaveLength(1);
    // each session shows who has it open: Meera sees Aarav in Code, and herself
    await until(
      () =>
        b.room
          .conn(code)
          ?.getSnapshot()
          .people.map((p) => p.pid)
          .join() === 'aarav,meera',
    );
    // and in General, where she no longer is, nobody
    await until(() => b.room.conn(general)?.getSnapshot().people.length === 0);
  });

  it('room context reaches every session; a session can switch an item off for itself', async () => {
    const world = new MemoryServer(new MemoryHub());
    const a = await enter(world, 'aarav', 1, true);
    await until(() => a.room.getSnapshot().sessions.length === 1);
    const general = a.room.getSnapshot().sessions[0]?.id ?? '';
    const res = await a.room.createSession('Design', ['aarav']);
    if (!res.ok) throw new Error(res.reason);
    const [g, d] = [await ready(a.room, general), await ready(a.room, res.session.id)];
    addContextItem(a.room.doc, {
      id: 'brief',
      ownerUid: 'aarav',
      kind: 'note',
      title: 'Brief',
      text: 'Campus lost-and-found map.',
      createdAt: 1,
    });
    addContextItem(d.doc, {
      id: 'palette',
      ownerUid: 'aarav',
      kind: 'note',
      title: 'Palette',
      text: 'Teal and sand.',
      createdAt: 2,
    });
    const blocks = (s: SessionConn) =>
      assembleRoom(s.doc, { room: a.room.doc }).items.map((i) => i.title);
    expect(blocks(g)).toEqual(['Brief']);
    expect(blocks(d)).toEqual(['Brief', 'Palette']);
    setRoomItemIncluded(d.doc, 'brief', false);
    expect(blocks(d)).toEqual(['Palette']);
    expect(isRoomItemIncluded(g.doc, 'brief')).toBe(true);
    expect(blocks(g)).toEqual(['Brief']);
  });

  it('a session is saved on the server and opens later with nobody else online', async () => {
    const world = new MemoryServer(new MemoryHub());
    const a = await enter(world, 'aarav', 1, true);
    await until(() => a.room.getSnapshot().sessions.length === 1);
    const general = a.room.getSnapshot().sessions[0]?.id ?? '';
    type((await ready(a.room, general)).doc, 'Saved words');
    const stored = world.sessionById(general)?.session;
    await until(() => (stored?.saves.length ?? 0) >= 1);
    a.room.stop();
    open.delete(a.room);

    const b = await enter(world, 'meera', 2);
    const gb = await ready(b.room, general);
    await until(() => promptText(gb.doc) === 'Saved words');
    // one prompt, not one per page
    expect(promptFragment(gb.doc).length).toBe(1);
  });

  it('a member taken out of a session loses it at once', async () => {
    const world = new MemoryServer(new MemoryHub());
    const a = await enter(world, 'aarav', 1, true);
    const b = await enter(world, 'meera', 2);
    const res = await a.room.createSession('Design', ['aarav', 'meera']);
    if (!res.ok) throw new Error(res.reason);
    await until(() => ids(b.room).includes('Design'));
    b.room.setActive(res.session.id);
    expect(await a.room.updateSession(res.session.id, { members: ['aarav'] })).toMatchObject({
      ok: true,
    });
    await until(() => !ids(b.room).includes('Design'));
    expect(b.room.conn(res.session.id)).toBeNull();
    // Meera is moved to a session she is still in
    expect(b.room.getSnapshot().activeId).toBe(b.room.getSnapshot().sessions[0]?.id);
    // the first session cannot be deleted; others can
    const generalId = a.room.getSnapshot().sessions.find((s) => s.isDefault)?.id ?? '';
    expect(await a.room.deleteSession(generalId)).toEqual({ ok: false, reason: 'invalid' });
    expect(await a.room.deleteSession(res.session.id)).toEqual({ ok: true });
    await until(() => ids(a.room).length === 1);
  });

  it('a room saved before sessions existed: its first session takes the conversation over once', async () => {
    const world = new MemoryServer(new MemoryHub());
    const a = await enter(world, 'aarav', 1, true);
    await until(() => a.room.getSnapshot().sessions.length === 1);
    a.room.stop();
    open.delete(a.room);

    // the old room copy: a conversation and a prompt in the room document
    const old = new Y.Doc();
    const stored = world.rooms.get([...world.rooms.keys()][0] ?? '');
    if (!stored?.snapshot) throw new Error('no room copy');
    Y.applyUpdate(old, stored.snapshot);
    old.transact(() => {
      const answer = addTurn(old, {
        id: 't-old',
        branchId: MAIN_BRANCH,
        parentId: tipOf(old),
        createdAt: 5,
        sentBy: 'aarav',
        senderName: 'Aarav',
        promptText: 'An old question',
        spans: [],
        provider: { kind: 'mock', model: 'demo', label: 'Demo model' },
        requestHash: '',
        context: [],
        systemLine: '',
      });
      answer.insert(0, 'An old answer');
      old.getMap<Y.Map<unknown>>('turns').get('t-old')?.set('status', 'done');
    });
    stored.snapshot = Y.encodeStateAsUpdate(old);

    const b = await enter(world, 'meera', 2);
    await until(() => b.room.getSnapshot().sessions.length === 1);
    const general = b.room.getSnapshot().sessions[0]?.id ?? '';
    const g = await ready(b.room, general);
    await until(() => listTurns(g.doc).length === 1);
    expect(listTurns(g.doc)[0]?.answer).toBe('An old answer');
    // only the conversation moved: the session has no room name, people or room context
    expect(g.doc.getMap('settings').get('name')).toBeUndefined();
    expect(g.doc.getMap('people').size).toBe(0);
    expect(promptFragment(g.doc).length).toBe(1);
    // a second page does not copy it again
    const c = await enter(world, 'kabir', 3);
    const gc = await ready(c.room, general);
    await until(() => listTurns(gc.doc).length === 1);
    await new Promise((r) => setTimeout(r, 80));
    expect(listTurns(gc.doc)).toHaveLength(1);
    expect(listTurns(g.doc)).toHaveLength(1);
  });
});
