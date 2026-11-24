import {
  MemoryHub,
  promptFragment,
  promptText,
  readSettings,
  setRoomModel,
} from '@promptalong/core';
import type * as Y from 'yjs';
import { sendPrompt } from './send';
import { RoomSession } from './session';

const sessions: RoomSession[] = [];

function open(hub: MemoryHub, pid: string, name: string, at: number, create?: boolean) {
  const s = new RoomSession({
    code: 'K7QM2X',
    pid,
    name,
    transport: hub.createTransport(),
    now: () => at,
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

  it('the ninth person sees "room full" and does not take a seat', async () => {
    const hub = new MemoryHub();
    const eight = Array.from({ length: 8 }, (_, i) => open(hub, `p${i}aaaaaa`, `P${i}`, i + 1));
    await waitFor(() => eight.every((s) => s.getSnapshot().people.length === 8));
    const late = open(hub, 'zzzz9999', 'Late', 100);
    await waitFor(() => late.getSnapshot().full);
    await new Promise((r) => setTimeout(r, 200));
    expect(eight.every((s) => !s.getSnapshot().full)).toBe(true);
    await waitFor(() => eight.every((s) => s.getSnapshot().people.length === 8));
  });

  it('one Send: both people get the same answer, the prompt is cleared, "sending" is shown', async () => {
    const hub = new MemoryHub();
    const a = open(hub, 'aaaa1111', 'Aarav', 1, true);
    const b = open(hub, 'bbbb2222', 'Meera', 2);
    await waitFor(() => b.getSnapshot().settings !== null && b.getSnapshot().people.length === 2);
    const text = (promptFragment(a.doc).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    text.insert(0, '/short Make it 2 minutes');
    await waitFor(() => promptText(b.doc) === '/short Make it 2 minutes');
    const res = await sendPrompt(a);
    expect(res.ok).toBe(true);
    await waitFor(() =>
      b.getSnapshot().people.some((p) => p.pid === 'aaaa1111' && p.activity === 'sending'),
    );
    await waitFor(() => b.getSnapshot().turns[0]?.status === 'done');
    const [ta, tb] = [a.getSnapshot().turns[0], b.getSnapshot().turns[0]];
    expect(tb?.answer).toBe(ta?.answer);
    expect(tb?.answer).toMatch(/^Short answer to "Make it 2 minutes": done\.$/u);
    expect(tb?.provider.label).toBe('Demo model');
    expect(tb?.requestHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(promptText(a.doc)).toBe('');
    await waitFor(() => promptText(b.doc) === '' && b.getSnapshot().lock === null);
  });

  it('the room model is shared, never with a key', async () => {
    const hub = new MemoryHub();
    const a = open(hub, 'aaaa1111', 'Aarav', 1, true);
    const b = open(hub, 'bbbb2222', 'Meera', 2);
    await waitFor(() => b.getSnapshot().settings !== null);
    setRoomModel(a.doc, {
      kind: 'byok',
      endpoint: 'groq',
      model: 'llama-3.1-8b-instant',
      setBy: 'aaaa1111',
    });
    await waitFor(() => b.getSnapshot().model.kind === 'byok');
    expect(b.getSnapshot().model).toEqual({
      kind: 'byok',
      endpoint: 'groq',
      model: 'llama-3.1-8b-instant',
      setBy: 'aaaa1111',
    });
  });
});
