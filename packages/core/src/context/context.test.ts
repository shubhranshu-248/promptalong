import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  CONTEXT_MAX_BYTES,
  CONTEXT_MAX_ITEMS,
  CONTEXT_ROOM_MAX_BYTES,
  MAIN_BRANCH,
  MemoryHub,
  RoomSync,
  StreamCoordinator,
  addContextItem,
  addTurn,
  answerReserve,
  assemble,
  assembleRoom,
  contextText,
  initRoom,
  promptFragment,
  listContext,
  listTurns,
  messageOverhead,
  promptBudget,
  readSystemLine,
  removeContextItem,
  roomBytes,
  setContextIncluded,
  setSystemLine,
  sha256Hex,
  tipOf,
  tokenBudget,
  updateContextItem,
  upsertPerson,
  writeFragment,
  type ContextKind,
  type SendRequest,
} from '../index';

function room(): Y.Doc {
  const doc = new Y.Doc();
  initRoom(doc, {
    name: 'Hackathon pitch',
    sendPolicy: 'everyone',
    hostPid: 'aarav',
    createdAt: 1,
  });
  upsertPerson(doc, 'aarav', { name: 'Aarav', slot: 1, joinedAt: 1 });
  upsertPerson(doc, 'meera', { name: 'Meera', slot: 2, joinedAt: 2 });
  return doc;
}

let n = 0;
function add(doc: Y.Doc, title: string, text: string, by = 'aarav', kind: ContextKind = 'note') {
  n += 1;
  return addContextItem(doc, {
    id: `c${String(n)}`,
    ownerUid: by,
    kind,
    title,
    text,
    createdAt: 100 + n,
  });
}

function sent(doc: Y.Doc, text: string, answer: string): string {
  n += 1;
  const id = `t${String(n)}`;
  doc.transact(() => {
    const a = addTurn(doc, {
      id,
      branchId: MAIN_BRANCH,
      parentId: tipOf(doc),
      createdAt: 200 + n,
      sentBy: 'aarav',
      senderName: 'Aarav',
      promptText: text,
      spans: [],
      provider: { kind: 'mock', model: 'm', label: 'Demo model' },
      requestHash: '',
    });
    a.insert(0, answer);
    doc.getMap<Y.Map<unknown>>('turns').get(id)?.set('status', 'done');
  });
  return id;
}

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe('context items', () => {
  it('adds notes, snippets and files, included by default, in creation order', () => {
    const doc = room();
    expect(add(doc, 'judging-criteria.txt', '1. Real user problem', 'meera', 'file').ok).toBe(true);
    expect(add(doc, '  App   features  ', '- live map\r\n- photo + pin  \n\n').ok).toBe(true);
    const items = listContext(doc);
    expect(items.map((i) => [i.title, i.ownerUid, i.kind, i.included])).toEqual([
      ['judging-criteria.txt', 'meera', 'file', true],
      ['App features', 'aarav', 'note', true],
    ]);
    // new lines normalised, trailing space dropped: what is stored is what is sent
    expect(contextText(doc, items[1]?.id ?? '')).toBe('- live map\n- photo + pin');
    expect(items[1]?.bytes).toBe(24);
    expect(items[0]?.toggledBy).toBeNull();
  });

  it('refuses empty text, more than 1 MB and a 41st item', () => {
    const doc = room();
    expect(add(doc, 'empty', '  \n ')).toEqual({ ok: false, reason: 'empty' });
    expect(add(doc, 'big', 'a'.repeat(CONTEXT_MAX_BYTES + 1))).toEqual({
      ok: false,
      reason: 'too-large',
    });
    // 1 MB is measured in UTF-8 bytes, not characters
    expect(add(doc, 'hindi', 'न'.repeat(Math.floor(CONTEXT_MAX_BYTES / 3) + 1))).toEqual({
      ok: false,
      reason: 'too-large',
    });
    expect(add(doc, 'fits', 'a'.repeat(CONTEXT_MAX_BYTES)).ok).toBe(true);
    for (let i = 1; i < CONTEXT_MAX_ITEMS; i++)
      expect(add(doc, `n${String(i)}`, 'x').ok).toBe(true);
    expect(add(doc, 'one too many', 'x')).toEqual({ ok: false, reason: 'room-full' });
    expect(listContext(doc)).toHaveLength(CONTEXT_MAX_ITEMS);
  });

  it('keeps the room under 6 MB of context in all', () => {
    const doc = room();
    const full = Math.floor(CONTEXT_ROOM_MAX_BYTES / CONTEXT_MAX_BYTES);
    for (let i = 0; i < full; i++)
      expect(add(doc, `big${String(i)}`, 'a'.repeat(CONTEXT_MAX_BYTES)).ok).toBe(true);
    expect(roomBytes(listContext(doc))).toBe(full * CONTEXT_MAX_BYTES);
    expect(add(doc, 'one more', 'a'.repeat(CONTEXT_MAX_BYTES))).toEqual({
      ok: false,
      reason: 'room-size',
    });
    const first = listContext(doc)[0]?.id ?? '';
    expect(updateContextItem(doc, first, { text: 'small now' })).toBe('ok');
    expect(add(doc, 'fits again', 'a'.repeat(CONTEXT_MAX_BYTES - 100)).ok).toBe(true);
  });

  it('excluding records who did it and never touches the text', () => {
    const doc = room();
    const r = add(doc, 'Old pitch draft', 'We help students find things.', 'aarav');
    if (!r.ok) throw new Error('not added');
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    expect(setContextIncluded(doc, r.item.id, false, 'meera')).toBe(true);
    expect(setContextIncluded(doc, r.item.id, false, 'aarav')).toBe(false); // already excluded
    const item = listContext(doc)[0];
    expect(item?.included).toBe(false);
    expect(item?.toggledBy).toBe('meera');
    expect(contextText(doc, r.item.id)).toBe('We help students find things.');
    // the toggle is a tiny update: the text is not sent again
    expect(updates.reduce((a, u) => a + u.length, 0)).toBeLessThan(120);
  });

  it('two people toggling and editing at the same moment end up the same', () => {
    const a = room();
    const r = add(a, 'Survey numbers', '61 of 80 students');
    if (!r.ok) throw new Error('not added');
    const b = new Y.Doc();
    sync(a, b);
    setContextIncluded(a, r.item.id, false, 'aarav');
    updateContextItem(b, r.item.id, { title: 'Survey (final)', text: '64 of 80 students' }, 900);
    add(b, 'From Meera', 'second item', 'meera');
    sync(a, b);
    expect(listContext(a)).toEqual(listContext(b));
    const first = listContext(a)[0];
    expect([first?.title, first?.included, first?.toggledBy, first?.updatedAt]).toEqual([
      'Survey (final)',
      false,
      'aarav',
      900,
    ]);
    expect(contextText(a, r.item.id)).toBe('64 of 80 students');
    expect(JSON.stringify(assembleRoom(a))).toBe(JSON.stringify(assembleRoom(b)));
  });

  it('edits keep the limits; remove deletes the item', () => {
    const doc = room();
    const r = add(doc, 'Notes', 'one');
    if (!r.ok) throw new Error('not added');
    expect(updateContextItem(doc, r.item.id, { text: '   ' })).toBe('empty');
    expect(updateContextItem(doc, r.item.id, { text: 'a'.repeat(CONTEXT_MAX_BYTES + 1) })).toBe(
      'too-large',
    );
    expect(updateContextItem(doc, 'nope', { title: 'x' })).toBe('missing');
    expect(contextText(doc, r.item.id)).toBe('one');
    expect(removeContextItem(doc, r.item.id)).toBe(true);
    expect(listContext(doc)).toEqual([]);
  });

  it('ignores malformed items that arrive from the network', () => {
    const doc = room();
    const map = doc.getMap<unknown>('context');
    map.set('plain', { kind: 'note', text: 'not a map' });
    const noText = new Y.Map<unknown>();
    noText.set('kind', 'note');
    noText.set('ownerUid', 'x');
    noText.set('createdAt', 1);
    map.set('no-text', noText);
    const huge = new Y.Map<unknown>();
    huge.set('kind', 'file');
    huge.set('ownerUid', 'x');
    huge.set('createdAt', 1);
    huge.set('text', 'a'.repeat(CONTEXT_MAX_BYTES + 5));
    map.set('huge', huge);
    expect(listContext(doc)).toEqual([]);
    expect(assembleRoom(doc).messages).toEqual([{ role: 'user', content: '' }]);
  });

  it('the room line is trimmed, capped and remembers who set it', () => {
    const doc = room();
    setSystemLine(doc, '  You are helping a team prepare a hackathon pitch.\r\n ', 'meera');
    expect(readSystemLine(doc)).toBe('You are helping a team prepare a hackathon pitch.');
    setSystemLine(doc, 'x'.repeat(5000), 'aarav');
    expect(readSystemLine(doc)).toHaveLength(2000);
  });
});

describe('assembly', () => {
  it('room line, included items in creation order, history, then the prompt', () => {
    const doc = room();
    setSystemLine(doc, 'You are helping a team prepare a hackathon pitch.', 'aarav');
    add(doc, 'judging-criteria.txt', '1. Real user problem (30%)', 'meera');
    const old = add(doc, 'Old pitch draft', 'We help students.', 'aarav');
    add(doc, 'Survey numbers', '61 of 80 students lost something.', 'ishita-who-left');
    if (old.ok) setContextIncluded(doc, old.item.id, false, 'meera');
    sent(doc, 'Write a 2 minute pitch', 'Opening (20 s).');
    writeFragment(promptFragment(doc), [{ text: '  Now three slide titles  ', spans: [] }]);

    const a = assembleRoom(doc);
    expect(a.messages).toEqual([
      {
        role: 'system',
        content:
          'You are helping a team prepare a hackathon pitch.\n\n' +
          '[context: judging-criteria.txt · Meera]\n1. Real user problem (30%)\n\n' +
          '[context: Survey numbers · someone]\n61 of 80 students lost something.',
      },
      { role: 'user', content: 'Write a 2 minute pitch' },
      { role: 'assistant', content: 'Opening (20 s).' },
      { role: 'user', content: 'Now three slide titles' },
    ]);
    expect(a.segments.map((s) => [s.kind, s.role, s.message])).toEqual([
      ['system', 'system', 0],
      ['context', 'system', 0],
      ['context', 'system', 0],
      ['history', 'user', 1],
      ['history', 'assistant', 2],
      ['prompt', 'user', 3],
    ]);
    expect(a.items.map((i) => i.title)).toEqual(['judging-criteria.txt', 'Survey numbers']);
    // every message is exactly its segments joined: nothing hidden in between
    const system = a.segments.filter((s) => s.message === 0).map((s) => s.text);
    expect(system.join('\n\n')).toBe(a.messages[0]?.content);
  });

  it('with no room line and nothing included the request is history + prompt only', () => {
    const doc = room();
    const r = add(doc, 'Notes', 'private for now');
    if (r.ok) setContextIncluded(doc, r.item.id, false, 'aarav');
    sent(doc, 'first', 'answer one');
    expect(assembleRoom(doc, { prompt: 'second' }).messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer one' },
      { role: 'user', content: 'second' },
    ]);
  });

  it('is pure: the same input gives the same output and the input is not changed', () => {
    const input = {
      systemLine: ' be brief ',
      items: [
        {
          id: 'a',
          ownerUid: 'u1',
          kind: 'note' as const,
          title: 'T',
          text: 'x',
          included: true,
          bytes: 1,
        },
      ],
      ownerName: () => 'Meera',
      history: [{ turnId: 't1', prompt: 'p', answer: 'a' }],
      prompt: 'now',
    };
    const copy = JSON.stringify(input);
    expect(JSON.stringify(assemble(input))).toBe(JSON.stringify(assemble(input)));
    expect(JSON.stringify(input)).toBe(copy);
    expect(assemble(input).messages[0]?.content).toBe('be brief\n\n[context: T · Meera]\nx');
  });
});

describe('Send with context', () => {
  const made: { co: StreamCoordinator; sync: RoomSync }[] = [];
  afterEach(() => {
    for (const p of made.splice(0)) {
      p.co.destroy();
      p.sync.destroy();
    }
  });

  function peer(hub: MemoryHub, pid: string) {
    const doc = new Y.Doc();
    const s = new RoomSync(doc, new Awareness(doc), hub.createTransport(), {
      coalesceMs: 2,
      coalesceBusyMs: 2,
      awarenessThrottleMs: 2,
      resyncMs: 60_000,
      aloneAfterMs: 20,
    });
    const co = new StreamCoordinator(doc, {
      pid,
      session: `${pid}-s`,
      name: () => pid,
      peers: () => made.length - 1,
      online: () => true,
      claimMs: 20,
      flushMs: 5,
    });
    s.connect();
    made.push({ co, sync: s });
    return { doc, co };
  }

  async function until(check: () => boolean, ms = 3000): Promise<void> {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  it('posts exactly the assembled body and freezes the context with the turn', async () => {
    const hub = new MemoryHub();
    const a = peer(hub, 'aarav');
    const b = peer(hub, 'meera');
    initRoom(a.doc, { name: 'r', sendPolicy: 'everyone', hostPid: 'aarav', createdAt: 1 });
    upsertPerson(a.doc, 'aarav', { name: 'Aarav', slot: 1, joinedAt: 1 });
    upsertPerson(a.doc, 'meera', { name: 'Meera', slot: 2, joinedAt: 2 });
    setSystemLine(a.doc, 'Be brief.', 'aarav');
    add(a.doc, 'judging-criteria.txt', '1. Real user problem', 'meera');
    const off = add(a.doc, 'Old draft', 'not sent', 'aarav');
    if (off.ok) setContextIncluded(a.doc, off.item.id, false, 'meera');
    writeFragment(promptFragment(a.doc), [{ text: 'Make it 2 minutes', spans: [] }]);
    await until(() => listContext(b.doc).length === 2);

    const build: SendRequest['buildBody'] = (messages) =>
      JSON.stringify({ model: 'm', messages, stream: true });
    // what any participant's panel shows before Send
    const shown = build(assembleRoom(b.doc).messages);

    const posted: string[] = [];
    const res = await a.co.send({
      promptText: 'Make it 2 minutes',
      provider: { kind: 'mock', model: 'm', label: 'Demo model' },
      buildBody: build,
      tokens: (text) => ({ tokens: text.length, exact: true }),
      // eslint-disable-next-line @typescript-eslint/require-await -- a fake model with no delay
      stream: async function* (body: string) {
        posted.push(body);
        yield { text: 'ok', done: true };
      },
      clearPrompt: true,
      describeError: () => ({ code: 'other', message: 'x' }),
    });
    expect(res.ok).toBe(true);
    await until(() => listTurns(b.doc)[0]?.status === 'done');

    expect(posted).toEqual([shown]);
    const turn = listTurns(b.doc)[0];
    expect(turn?.requestHash).toBe(await sha256Hex(shown));
    expect(turn?.systemLine).toBe('Be brief.');
    expect(turn?.context).toEqual([
      {
        itemId: 'c' + String(n - 1),
        title: 'judging-criteria.txt',
        ownerUid: 'meera',
        ownerName: 'Meera',
        kind: 'note',
        bytes: 20,
        tokens: '[context: judging-criteria.txt · Meera]\n1. Real user problem'.length,
        exact: true,
        hash: await sha256Hex('1. Real user problem'),
      },
    ]);

    // later changes to the room do not change what the turn records
    removeContextItem(a.doc, turn?.context[0]?.itemId ?? '');
    await until(() => listContext(b.doc).length === 1);
    expect(listTurns(b.doc)[0]?.context[0]?.title).toBe('judging-criteria.txt');
  });
});

describe('token budget', () => {
  it('keeps room for the answer: at most 8,192 tokens or a quarter of a smaller window', () => {
    expect(answerReserve(8192)).toBe(2048);
    expect(promptBudget(8192)).toBe(6144);
    expect(answerReserve(2048)).toBe(512);
    expect(answerReserve(128_000)).toBe(8192);
    expect(promptBudget(128_000)).toBe(119_808);
    expect(promptBudget(1_048_576)).toBe(1_040_384);
    expect(messageOverhead(0)).toBe(0);
    expect(messageOverhead(3)).toBe(15);
  });

  it('splits what is used into prompt + history and each person’s context', () => {
    const view = tokenBudget({
      contextWindow: 8192,
      messageTokens: [904, 300, 150, 30], // system (context), history, history, prompt
      itemTokens: [
        { itemId: 'a', ownerUid: 'meera', tokens: 412 },
        { itemId: 'b', ownerUid: 'aarav', tokens: 320 },
        { itemId: 'c', ownerUid: 'meera', tokens: 172 },
      ],
    });
    expect(view.used).toBe(904 + 300 + 150 + 30 + 19);
    expect(view.limit).toBe(6144);
    expect(view.over).toBe(0);
    expect(view.owners).toEqual([
      { uid: 'meera', tokens: 584 },
      { uid: 'aarav', tokens: 320 },
    ]);
    expect(view.base + 584 + 320).toBe(view.used);
  });

  it('reports how many tokens to remove when it does not fit', () => {
    const view = tokenBudget({
      contextWindow: 4096,
      messageTokens: [3500, 200],
      itemTokens: [{ itemId: 'a', ownerUid: 'meera', tokens: 3490 }],
    });
    expect(view.limit).toBe(3072);
    expect(view.over).toBe(3500 + 200 + 11 - 3072);
  });
});
