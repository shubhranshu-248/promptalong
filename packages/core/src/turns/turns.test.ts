import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  MemoryHub,
  RoomSync,
  StreamCoordinator,
  clearPrompt,
  initRoom,
  listTurns,
  promptFragment,
  promptText,
  readLock,
  sha256Hex,
  type CoordinatorOptions,
  type SendRequest,
  type StreamChunkLike,
} from '../index';

interface Peer {
  pid: string;
  doc: Y.Doc;
  sync: RoomSync;
  co: StreamCoordinator;
  online: boolean;
}

const all: Peer[] = [];

function peer(hub: MemoryHub, pid: string, opts: Partial<CoordinatorOptions> = {}): Peer {
  const doc = new Y.Doc();
  const sync = new RoomSync(doc, new Awareness(doc), hub.createTransport(), {
    coalesceMs: 2,
    coalesceBusyMs: 2,
    awarenessThrottleMs: 2,
    resyncMs: 60_000,
    aloneAfterMs: 20,
  });
  const p: Peer = { pid, doc, sync, online: true } as Peer;
  p.co = new StreamCoordinator(doc, {
    pid,
    session: `${pid}-s`,
    name: () => pid.toUpperCase(),
    peers: () => all.filter((x) => x !== p && x.online).length,
    online: () => p.online,
    claimMs: 30,
    beatMs: 20,
    staleMs: 120,
    flushMs: 5,
    checkMs: 10,
    ...opts,
  });
  sync.connect();
  all.push(p);
  return p;
}

afterEach(() => {
  for (const p of all.splice(0)) {
    p.co.destroy();
    p.sync.destroy();
  }
});

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** A fake model: yields the given pieces with a small delay; can be held open until released. */
function model(pieces: string[], delay = 3) {
  const seen: { body: string }[] = [];
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const stream = async function* (body: string, signal: AbortSignal) {
    seen.push({ body });
    for (const text of pieces) {
      await new Promise((r) => setTimeout(r, delay));
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      yield { text } as StreamChunkLike;
    }
    yield { text: '', done: true, usage: { input: 3, output: pieces.length } };
  };
  const held = async function* (body: string, signal: AbortSignal) {
    seen.push({ body });
    yield { text: 'partial ' } as StreamChunkLike;
    await Promise.race([
      gate,
      new Promise((_r, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }),
    ]);
    yield { text: 'end', done: true } as StreamChunkLike;
  };
  return { stream, held, seen, release: () => release?.() };
}

function request(stream: SendRequest['stream'], prompt = 'Make it 2 minutes'): SendRequest {
  return {
    promptText: prompt,
    provider: { kind: 'mock', model: 'mock-pitch-coach', label: 'Demo model' },
    buildBody: (messages) => JSON.stringify({ model: 'mock-pitch-coach', messages, stream: true }),
    stream,
    clearPrompt: true,
    describeError: (e) => ({ code: 'other', message: e instanceof Error ? e.message : 'x' }),
  };
}

async function room(n: number) {
  const hub = new MemoryHub();
  const peers = Array.from({ length: n }, (_, i) => peer(hub, `p${String(i + 1)}`));
  const [first] = peers;
  if (!first) throw new Error('no peers');
  initRoom(first.doc, { name: 'r', sendPolicy: 'everyone', hostPid: 'p1', createdAt: 1 });
  await until(() => peers.every((p) => p.doc.getMap('settings').has('createdAt')));
  return { hub, peers };
}

describe('shared stream', () => {
  it('one Send -> every participant ends with the same answer, status and request hash', async () => {
    const { peers } = await room(4);
    const [a] = peers;
    if (!a) return;
    const m = model(['Opening ', '(20 s). ', 'Last ', 'semester, ', 'Ishita…']);
    const res = await a.co.send(request(m.stream));
    expect(res.ok).toBe(true);
    await until(() => peers.every((p) => listTurns(p.doc)[0]?.status === 'done'));
    const views = peers.map((p) => listTurns(p.doc)[0]);
    expect(new Set(views.map((v) => v?.answer)).size).toBe(1);
    expect(views[0]?.answer).toBe('Opening (20 s). Last semester, Ishita…');
    expect(views[0]?.requestHash).toBe(await sha256Hex(m.seen[0]?.body ?? ''));
    expect(views[0]?.usage).toEqual({ input: 3, output: 5 });
    expect(views.every((v) => v?.sentBy === 'p1' && v.senderName === 'P1')).toBe(true);
    expect(peers.every((p) => readLock(p.doc) === null)).toBe(true);
  });

  it('the next Send includes the history and points at the previous turn', async () => {
    const { peers } = await room(2);
    const [a, b] = peers;
    if (!a || !b) return;
    const m = model(['first answer']);
    await a.co.send(request(m.stream, 'first'));
    await until(() => listTurns(b.doc)[0]?.status === 'done' && readLock(b.doc) === null);
    await b.co.send(request(m.stream, 'second'));
    await until(() => listTurns(a.doc)[1]?.status === 'done');
    const body = JSON.parse(m.seen[1]?.body ?? '{}') as { messages: unknown[] };
    expect(body.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second' },
    ]);
    const turns = listTurns(a.doc);
    expect(turns[1]?.parentId).toBe(turns[0]?.id);
  });

  it('Send is locked while someone else is streaming', async () => {
    const { peers } = await room(2);
    const [a, b] = peers;
    if (!a || !b) return;
    const m = model([]);
    await a.co.send(request(m.held));
    await until(() => readLock(b.doc)?.turnId != null);
    expect(await b.co.send(request(m.stream))).toMatchObject({ ok: false, reason: 'busy' });
    m.release();
    await until(() => listTurns(b.doc)[0]?.status === 'done' && readLock(b.doc) === null);
    expect(m.seen).toHaveLength(1);
  });

  it('two Sends at the same instant: exactly one model call, everyone agrees on the winner', async () => {
    const { peers } = await room(3);
    const [a, b] = peers;
    if (!a || !b) return;
    const m = model(['x']);
    const [ra, rb] = await Promise.all([
      a.co.send(request(m.stream)),
      b.co.send(request(m.stream)),
    ]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    expect([ra, rb].find((r) => !r.ok)).toMatchObject({ reason: 'lost' });
    await until(() => peers.every((p) => listTurns(p.doc)[0]?.status === 'done'));
    expect(m.seen).toHaveLength(1);
    expect(peers.every((p) => listTurns(p.doc).length === 1)).toBe(true);
  });

  it('anyone can Stop: the answer so far is kept and marked stopped by them', async () => {
    const { peers } = await room(3);
    const [a, , c] = peers;
    if (!a || !c) return;
    const m = model([]);
    const res = await a.co.send(request(m.held));
    if (!res.ok) throw new Error('send failed');
    await until(() => listTurns(c.doc)[0]?.answer === 'partial ');
    c.co.requestStop(res.turnId);
    await until(() => peers.every((p) => listTurns(p.doc)[0]?.status === 'stopped'));
    expect(listTurns(a.doc)[0]).toMatchObject({ stoppedBy: 'p3', answer: 'partial ' });
    expect(peers.every((p) => readLock(p.doc) === null)).toBe(true);
  });

  it('a model error is recorded (scrubbed by the caller) and Send is free again', async () => {
    const { peers } = await room(2);
    const [a, b] = peers;
    if (!a || !b) return;
    const failing = async function* (): AsyncIterable<StreamChunkLike> {
      await Promise.resolve();
      yield { text: 'half' };
      throw new Error('invalid or expired key');
    };
    await a.co.send(request(failing));
    await until(() => listTurns(b.doc)[0]?.status === 'failed');
    expect(listTurns(b.doc)[0]?.error).toMatchObject({ message: 'invalid or expired key' });
    expect(readLock(b.doc)).toBeNull();
  });

  it('sender closes the page mid-stream -> interrupted at once, text so far kept', async () => {
    const { peers } = await room(2);
    const [a, b] = peers;
    if (!a || !b) return;
    const m = model([]);
    await a.co.send(request(m.held));
    await until(() => listTurns(b.doc)[0]?.answer === 'partial ');
    a.co.destroy();
    a.sync.flush();
    await until(() => listTurns(b.doc)[0]?.status === 'interrupted');
    expect(listTurns(b.doc)[0]).toMatchObject({ interruptedReason: 'left', answer: 'partial ' });
    expect(readLock(b.doc)).toBeNull();
  });

  it('sender loses the connection -> others mark it interrupted after the heartbeat stops', async () => {
    const { peers } = await room(2);
    const [a, b] = peers;
    if (!a || !b) return;
    const m = model([]);
    await a.co.send(request(m.held));
    await until(() => listTurns(b.doc)[0]?.answer === 'partial ');
    a.sync.destroy(); // network gone, page still open
    a.online = false;
    await until(() => listTurns(b.doc)[0]?.status === 'interrupted', 3000);
    expect(listTurns(b.doc)[0]?.interruptedReason).toBe('lost');
    expect(readLock(b.doc)).toBeNull();
    m.release();
  });

  it('letters a co-writer types during the claim window are sent, not cleared away', async () => {
    const { peers } = await room(2);
    const [a, b] = peers;
    if (!a || !b) return;
    const textOf = (p: Peer) => (promptFragment(p.doc).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    textOf(b).insert(0, 'Make it 2 minutes');
    await until(() => promptText(a.doc) === 'Make it 2 minutes');
    const m = model(['ok']);
    // A clicks Send with the text it has now; B keeps typing while A waits for its claim.
    const sending = a.co.send(request(m.stream, promptText(a.doc)));
    textOf(b).insert(textOf(b).length, ' and end with one clear ask');
    await until(() => promptText(a.doc).endsWith('ask'));
    expect((await sending).ok).toBe(true);
    await until(() => peers.every((p) => listTurns(p.doc)[0]?.status === 'done'));
    const sent = listTurns(b.doc)[0]?.prompt.text ?? '';
    // every letter is either in the sent prompt or still in the editor - none is lost
    expect(sent + promptText(b.doc)).toBe('Make it 2 minutes and end with one clear ask');
    expect(m.seen[0]?.body).toContain(sent);
    expect(listTurns(b.doc)[0]?.requestHash).toBe(await sha256Hex(m.seen[0]?.body ?? ''));
  });

  it('an empty prompt is not sent', async () => {
    const { peers } = await room(1);
    expect(await peers[0]?.co.send(request(model([]).stream, '   '))).toMatchObject({
      ok: false,
      reason: 'empty',
    });
  });
});

describe('clearPrompt', () => {
  it('keeps the shared paragraph and text node, and keeps letters typed concurrently', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    initRoom(a, { name: 'r', sendPolicy: 'everyone', hostPid: 'p1', createdAt: 1 });
    const text = () => (promptFragment(a).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    text().insert(0, 'old prompt');
    const extra = new Y.XmlElement('paragraph');
    extra.insert(0, [new Y.XmlText('second line')]);
    promptFragment(a).insert(1, [extra]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const node = text();
    // b types at the end while a clears
    ((promptFragment(b).get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(10, ' NEW');
    clearPrompt(a);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(promptText(a)).toBe(' NEW');
    expect(promptText(b)).toBe(' NEW');
    expect(text()).toBe(node);
    expect(promptFragment(a).length).toBe(1);
  });
});
