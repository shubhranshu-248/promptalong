import { MemoryHub, promptFragment, promptText } from '@promptalong/core';
import type * as Y from 'yjs';
import { MemoryServer } from '../backend/memory-backend';
import type { RoomInfo } from '../backend/types';
import { RoomSession } from './session';

const sessions: RoomSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.stop();
});

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

const TIMINGS = { heartbeatMs: 25, saveQuietMs: 20, saveMaxWaitMs: 60 };

async function open(
  world: MemoryServer,
  uid: string,
  name: string,
  at: number,
  create = false,
): Promise<{ session: RoomSession; room: RoomInfo }> {
  const backend = world.backendFor(uid);
  const res = create
    ? await backend.createRoom({ code: 'K7QM2X', name: 'Hackathon pitch' })
    : await backend.joinRoom('K7QM2X');
  if (!res.ok) throw new Error(res.reason);
  const session = new RoomSession({
    code: 'K7QM2X',
    pid: uid,
    name,
    transport: backend.transport(),
    access: { backend, room: res.room, slot: res.slot, ...TIMINGS },
    now: () => at,
    ...(create ? { create: { name: 'Hackathon pitch', sendPolicy: 'everyone' as const } } : {}),
  });
  session.start();
  sessions.push(session);
  return { session, room: res.room };
}

function type(doc: Y.Doc, text: string) {
  const node = (promptFragment(doc).get(0) as Y.XmlElement).get(0) as Y.XmlText;
  node.insert(node.length, text);
}

describe('rooms with a server', () => {
  it('a new room is saved at once, and opens later with nobody else online', async () => {
    const world = new MemoryServer(new MemoryHub());
    const a = await open(world, 'aarav', 'Aarav', 1, true);
    const stored = world.rooms.get(a.room.id);
    await until(() => (stored?.saves.length ?? 0) >= 1);
    type(a.session.doc, 'Draft a 2-minute pitch');
    await until(() => (stored?.saves.length ?? 0) >= 2);
    a.session.stop();

    // days later, another device: no peer answers, the room comes from the server
    const b = await open(world, 'meera', 'Meera', 2);
    await until(() => promptText(b.session.doc) === 'Draft a 2-minute pitch');
    expect(b.session.getSnapshot().settings?.name).toBe('Hackathon pitch');
    expect(b.session.getSnapshot().managed).toBe(true);
  });

  it('only the person who has been here longest saves; the next one takes over when they leave', async () => {
    const world = new MemoryServer(new MemoryHub());
    const a = await open(world, 'aarav', 'Aarav', 1, true);
    const b = await open(world, 'meera', 'Meera', 2);
    const stored = world.rooms.get(a.room.id);
    await until(() => b.session.getSnapshot().people.length === 2);
    await until(() => (stored?.saves.length ?? 0) >= 1);
    type(b.session.doc, 'typed by Meera');
    await until(() => promptText(a.session.doc) === 'typed by Meera');
    await until(() => stored?.saves.at(-1)?.by === 'aarav' && stored.saves.length >= 2);
    expect(new Set(stored?.saves.map((s) => s.by))).toEqual(new Set(['aarav']));

    a.session.stop();
    await until(() => b.session.getSnapshot().people.length === 1);
    type(b.session.doc, ' and more');
    await until(() => stored?.saves.at(-1)?.by === 'meera');
  });

  it('lock: the server decides, the room shows it to everyone', async () => {
    const world = new MemoryServer(new MemoryHub());
    const a = await open(world, 'aarav', 'Aarav', 1, true);
    const b = await open(world, 'meera', 'Meera', 2);
    await until(() => b.session.getSnapshot().people.length === 2);

    expect(await b.session.setLocked(true)).toEqual({ ok: false, reason: 'not-host' });
    expect(b.session.getSnapshot().locked).toBe(false);
    expect(await a.session.setLocked(true)).toEqual({ ok: true });
    await until(() => b.session.getSnapshot().locked);
    expect(b.session.getSnapshot().lockedBy).toBe('aarav');
    // the server refuses a new person; people with a seat still get in
    expect(await world.backendFor('kabir').joinRoom('K7QM2X')).toMatchObject({
      ok: false,
      reason: 'locked',
    });
    expect(await world.backendFor('meera').joinRoom('K7QM2X')).toMatchObject({ ok: true });

    // a newcomer after unlocking learns the lock state from the server before the document arrives
    await a.session.setLocked(false);
    await until(() => !b.session.getSnapshot().locked);
  });

  it('a removed person is sent out by what the server says, not by a mark anyone could write', async () => {
    const world = new MemoryServer(new MemoryHub());
    const a = await open(world, 'aarav', 'Aarav', 1, true);
    const b = await open(world, 'meera', 'Meera', 2);
    const c = await open(world, 'kabir', 'Kabir', 3);
    await until(() => c.session.getSnapshot().people.length === 3);

    // Kabir writes a false "Meera was removed" mark: Meera asks the server and stays
    c.session.doc.getMap('access').set('removed:meera', true);
    await new Promise((r) => setTimeout(r, 80));
    expect(b.session.getSnapshot().ended).toBeNull();

    expect(await b.session.removePerson('kabir')).toEqual({ ok: false, reason: 'not-host' });
    expect(await a.session.removePerson('kabir')).toEqual({ ok: true });
    await until(() => c.session.getSnapshot().ended === 'removed');
    expect(await world.backendFor('kabir').joinRoom('K7QM2X')).toMatchObject({
      ok: false,
      reason: 'removed',
    });
    // the others carry on, and Kabir's page no longer receives what they write
    type(a.session.doc, 'after the removal');
    await until(() => promptText(b.session.doc) === 'after the removal');
    expect(promptText(c.session.doc)).toBe('');
  });

  it('make host: the new host can lock, the old one cannot', async () => {
    const world = new MemoryServer(new MemoryHub());
    const a = await open(world, 'aarav', 'Aarav', 1, true);
    const b = await open(world, 'meera', 'Meera', 2);
    await until(() => b.session.getSnapshot().people.length === 2);
    expect(await a.session.makeHost('meera')).toEqual({ ok: true });
    await until(() => b.session.getSnapshot().settings?.hostPid === 'meera');
    expect(await a.session.setLocked(true)).toEqual({ ok: false, reason: 'not-host' });
    expect(await b.session.setLocked(true)).toEqual({ ok: true });
    await until(() => a.session.getSnapshot().locked);
  });

  it('delete room: everyone who has it open is sent out', async () => {
    const world = new MemoryServer(new MemoryHub());
    const a = await open(world, 'aarav', 'Aarav', 1, true);
    const b = await open(world, 'meera', 'Meera', 2);
    await until(() => b.session.getSnapshot().people.length === 2);
    expect(await b.session.deleteRoom()).toEqual({ ok: false, reason: 'not-host' });
    expect(await a.session.deleteRoom()).toEqual({ ok: true });
    expect(a.session.getSnapshot().ended).toBe('deleted');
    await until(() => b.session.getSnapshot().ended === 'deleted');
    expect(await world.backendFor('kabir').joinRoom('K7QM2X')).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });

  it('offline: the heartbeat fails quietly and nobody is sent out', async () => {
    const world = new MemoryServer(new MemoryHub());
    const a = await open(world, 'aarav', 'Aarav', 1, true);
    world.online = false;
    type(a.session.doc, 'written offline');
    await new Promise((r) => setTimeout(r, 120));
    expect(a.session.getSnapshot().ended).toBeNull();
    world.online = true;
    const stored = world.rooms.get(a.room.id);
    // the change made offline reaches the server once it answers again
    await until(() => {
      const last = stored?.snapshot;
      return last !== null && last !== undefined && (stored?.saves.length ?? 0) >= 1;
    });
    const b = await open(world, 'meera', 'Meera', 2);
    await until(() => promptText(b.session.doc) === 'written offline');
  });
});
