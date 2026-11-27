import {
  MemoryHub,
  promptFragment,
  promptText,
  readSettings,
  setRoomModel,
} from '@promptalong/core';
import type * as Y from 'yjs';
import { sendPrompt } from './send';
import { sessionHubFor, sessionOpen } from '../test/sessions';
import { RoomSession } from './session';

const sessions: RoomSession[] = [];

function open(hub: MemoryHub, pid: string, name: string, at: number, create?: boolean) {
  const s = new RoomSession({
    code: 'K7QM2X',
    pid,
    name,
    transport: hub.createTransport(),
    sessionTransport: () => sessionHubFor(hub).createTransport(),
    now: () => at,
    prepare: create === true,
    ...(create ? { create: { name: 'Hackathon pitch', sendPolicy: 'host' as const } } : {}),
  });
  s.start();
  sessions.push(s);
  return s;
}

async function waitFor(check: () => boolean, ms = 4000) {
  const t = Date.now();
  while (!check()) {
    if (Date.now() - t > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

afterEach(() => {
  for (const s of sessions.splice(0)) s.stop();
});

describe('RoomSession', () => {
  it('the creator writes the settings and everyone sees them', async () => {
    const hub = new MemoryHub();
    const host = open(hub, 'aaaa1111', 'Aarav', 1, true);
    const guest = open(hub, 'bbbb2222', 'Meera', 2);
    await waitFor(() => guest.getSnapshot().settings?.name === 'Hackathon pitch');
    expect(readSettings(guest.doc)?.sendPolicy).toBe('host');
    await waitFor(() => guest.getSnapshot().people.length === 2);
    const people = guest.getSnapshot().people;
    expect(people.find((p) => p.pid === 'aaaa1111')?.host).toBe(true);
    expect(people.find((p) => p.me)?.name).toBe('Meera');
    expect(host.getSnapshot().people).toHaveLength(2);
  });

  it('gives people different colour slots in join order', async () => {
    const hub = new MemoryHub();
    const a = open(hub, 'aaaa1111', 'Aarav', 1);
    const b = open(hub, 'bbbb2222', 'Meera', 2);
    const c = open(hub, 'cccc3333', 'Kabir', 3);
    await waitFor(() => [a, b, c].every((s) => s.getSnapshot().people.length === 3));
    await waitFor(() => {
      const slots = [a, b, c].map((s) => s.getSnapshot().me.slot);
      return new Set(slots).size === 3;
    });
    expect([a, b, c].map((s) => s.getSnapshot().me.slot)).toEqual([1, 2, 3]);
  });

  it('shares what each person is doing and their new name', async () => {
    const hub = new MemoryHub();
    const a = open(hub, 'aaaa1111', 'Aarav', 1);
    const b = open(hub, 'bbbb2222', 'Meera', 2);
    await waitFor(() => b.getSnapshot().people.length === 2);
    a.setActivity('typing');
    await waitFor(() =>
      b.getSnapshot().people.some((p) => p.pid === 'aaaa1111' && p.activity === 'typing'),
    );
    a.rename('Aarav R');
    await waitFor(() => b.getSnapshot().people.some((p) => p.name === 'Aarav R'));
  });

  it('the 17th person sees "room full" and does not take a seat', async () => {
    const hub = new MemoryHub();
    const all = Array.from({ length: 16 }, (_, i) =>
      open(hub, `p${String(i).padStart(2, '0')}aaaaa`, `P${String(i)}`, i + 1),
    );
    await waitFor(() => all.every((s) => s.getSnapshot().people.length === 16), 8000);
    await waitFor(() => new Set(all.map((s) => s.getSnapshot().me.slot)).size === 16);
    const late = open(hub, 'zzzz9999', 'Late', 100);
    await waitFor(() => late.getSnapshot().full);
    await new Promise((r) => setTimeout(r, 200));
    expect(all.every((s) => !s.getSnapshot().full)).toBe(true);
    await waitFor(() => all.every((s) => s.getSnapshot().people.length === 16));
  }, 15_000);

  it('one Send: both people get the same answer, the prompt is cleared, "sending" is shown', async () => {
    const hub = new MemoryHub();
    const a = open(hub, 'aaaa1111', 'Aarav', 1, true);
    const b = open(hub, 'bbbb2222', 'Meera', 2);
    await waitFor(() => b.getSnapshot().settings !== null && b.getSnapshot().people.length === 2);
    const [sa, sb] = await Promise.all([sessionOpen(a), sessionOpen(b)]);
    const text = (promptFragment(sa.doc).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    text.insert(0, '/short Make it 2 minutes');
    await waitFor(() => promptText(sb.doc) === '/short Make it 2 minutes');
    // one prompt: the session's paragraph was written once, by Aarav's page
    expect(promptFragment(sb.doc).length).toBe(1);
    const res = await sendPrompt(sa);
    expect(res.ok).toBe(true);
    await waitFor(() =>
      b.getSnapshot().people.some((p) => p.pid === 'aaaa1111' && p.activity === 'sending'),
    );
    await waitFor(() => sb.getSnapshot().turns[0]?.status === 'done');
    const [ta, tb] = [sa.getSnapshot().turns[0], sb.getSnapshot().turns[0]];
    expect(tb?.answer).toBe(ta?.answer);
    expect(tb?.answer).toMatch(/^Short answer to "Make it 2 minutes": done\.$/u);
    expect(tb?.provider.label).toBe('Demo model');
    expect(tb?.requestHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(promptText(sa.doc)).toBe('');
    await waitFor(() => promptText(sb.doc) === '' && sb.getSnapshot().lock === null);
    // the room's document holds no conversation
    expect(a.doc.getMap('turns').size).toBe(0);
  });

  it('the room model is shared, never with a key', async () => {
    const hub = new MemoryHub();
    const a = open(hub, 'aaaa1111', 'Aarav', 1, true);
    const b = open(hub, 'bbbb2222', 'Meera', 2);
    await waitFor(() => b.getSnapshot().settings !== null);
    const sb = await sessionOpen(b);
    setRoomModel(a.doc, {
      kind: 'byok',
      endpoint: 'groq',
      model: 'llama-3.1-8b-instant',
      setBy: 'aaaa1111',
    });
    await waitFor(() => b.getSnapshot().model.kind === 'byok');
    // the session follows the room's model until it picks its own
    await waitFor(() => sb.getSnapshot().model.kind === 'byok');
    expect(sb.getSnapshot().model).toEqual({
      kind: 'byok',
      endpoint: 'groq',
      model: 'llama-3.1-8b-instant',
      setBy: 'aaaa1111',
    });
  });
});
