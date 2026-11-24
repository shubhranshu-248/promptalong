import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  MemoryHub,
  RoomSync,
  parseWireMessage,
  type MemoryTransport,
  type RoomSyncOptions,
} from './index';

interface Peer {
  doc: Y.Doc;
  text: Y.Text;
  awareness: Awareness;
  transport: MemoryTransport;
  sync: RoomSync;
}

const FAST: RoomSyncOptions = {
  coalesceMs: 5,
  coalesceBusyMs: 10,
  awarenessThrottleMs: 5,
  resyncMs: 60_000,
  aloneAfterMs: 40,
};

const peers: Peer[] = [];

function makePeer(hub: MemoryHub, options: RoomSyncOptions = FAST, connect = true): Peer {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const transport = hub.createTransport();
  const sync = new RoomSync(doc, awareness, transport, options);
  if (connect) sync.connect();
  const peer = { doc, text: doc.getText('t'), awareness, transport, sync };
  peers.push(peer);
  return peer;
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  for (const p of peers.splice(0)) {
    p.sync.destroy();
    p.awareness.destroy();
  }
});

describe('RoomSync', () => {
  it('syncs edits between two people, both ways', async () => {
    const hub = new MemoryHub();
    const a = makePeer(hub);
    const b = makePeer(hub);
    a.text.insert(0, 'hello');
    await waitFor(() => b.text.toJSON() === 'hello');
    b.text.insert(5, ' world');
    await waitFor(() => a.text.toJSON() === 'hello world');
  });

  it('a late joiner receives what was written before', async () => {
    const hub = new MemoryHub();
    const a = makePeer(hub);
    a.text.insert(0, 'written before you came');
    await sleep(20);
    const b = makePeer(hub);
    await waitFor(() => b.text.toJSON() === 'written before you came');
    expect(b.sync.state).toBe('synced');
  });

  it('says "alone" when nobody answers, then "synced" when someone joins', async () => {
    const hub = new MemoryHub();
    const a = makePeer(hub);
    await waitFor(() => a.sync.state === 'alone');
    makePeer(hub);
    await waitFor(() => a.sync.state === 'synced');
  });

  it('four people typing at the same time converge with no lost or duplicated characters', async () => {
    const hub = new MemoryHub(7);
    hub.delayMs = 3;
    const group = [makePeer(hub), makePeer(hub), makePeer(hub), makePeer(hub)];
    await sleep(30);
    const letters = ['a', 'b', 'c', 'd'];
    for (let round = 0; round < 40; round++) {
      group.forEach((p, i) => {
        const pos = Math.floor(hub.random() * (p.text.length + 1));
        p.text.insert(pos, letters[i] ?? '?');
      });
      await sleep(1);
    }
    const first = group[0];
    if (!first) throw new Error('no peers');
    await waitFor(() => group.every((p) => p.text.toJSON() === first.text.toJSON()));
    const final = first.text.toJSON();
    expect(final).toHaveLength(160);
    for (const l of letters) expect(final.split(l).length - 1).toBe(40);
  });

  it('recovers from dropped messages (gap re-sync and periodic re-sync)', async () => {
    const hub = new MemoryHub(3);
    const a = makePeer(hub, { ...FAST, resyncMs: 60 });
    const b = makePeer(hub, { ...FAST, resyncMs: 60 });
    await waitFor(() => a.sync.state === 'synced' && b.sync.state === 'synced');
    hub.dropRate = 0.4;
    for (let i = 0; i < 60; i++) {
      a.text.insert(a.text.length, 'x');
      if (i % 2 === 0) b.text.insert(0, 'y');
      await sleep(7);
    }
    hub.dropRate = 0;
    await waitFor(() => a.text.toJSON() === b.text.toJSON(), 5000);
    expect(a.text.length).toBe(90);
    expect(a.sync.stats.gaps + b.sync.stats.gaps).toBeGreaterThan(0);
  });

  it('keeps edits made offline and merges them on reconnect', async () => {
    const hub = new MemoryHub();
    const a = makePeer(hub);
    const b = makePeer(hub);
    a.text.insert(0, 'shared ');
    await waitFor(() => b.text.toJSON() === 'shared ');
    b.transport.setNetwork(false);
    expect(b.sync.state).toBe('offline');
    b.text.insert(b.text.length, 'offline-b ');
    a.text.insert(a.text.length, 'online-a ');
    await sleep(30);
    expect(a.text.toJSON()).not.toContain('offline-b');
    b.transport.setNetwork(true);
    await waitFor(() => a.text.toJSON() === b.text.toJSON());
    expect(a.text.toJSON()).toContain('offline-b');
    expect(a.text.toJSON()).toContain('online-a');
  });

  it('coalesces fast typing into few messages', async () => {
    const hub = new MemoryHub();
    const a = makePeer(hub, { ...FAST, coalesceMs: 50 });
    const b = makePeer(hub, { ...FAST, coalesceMs: 50 });
    await waitFor(() => b.sync.state === 'synced');
    const before = a.sync.stats.byType.update ?? 0;
    for (let i = 0; i < 100; i++) a.text.insert(i, 'k'); // 100 keystrokes in one burst
    await waitFor(() => b.text.length === 100);
    expect((a.sync.stats.byType.update ?? 0) - before).toBeLessThanOrEqual(2);
  });

  it('shares awareness and removes a person who leaves', async () => {
    const hub = new MemoryHub();
    const a = makePeer(hub);
    const b = makePeer(hub);
    a.awareness.setLocalStateField('user', { name: 'Aarav' });
    await waitFor(() => {
      const s = b.awareness.getStates().get(a.awareness.clientID) as
        { user?: { name?: string } } | undefined;
      return s?.user?.name === 'Aarav';
    });
    expect(b.sync.peerCount).toBe(1);
    a.sync.destroy();
    await waitFor(() => !b.awareness.getStates().has(a.awareness.clientID));
  });

  it('ignores messages meant for someone else and malformed data', async () => {
    const hub = new MemoryHub();
    const a = makePeer(hub);
    const b = makePeer(hub);
    await waitFor(() => b.sync.state === 'synced');
    const rogue = hub.createTransport();
    rogue.connect();
    rogue.send({ t: 'update', from: 'rogue', seq: 1, d: '!!!not-base64!!!' });
    rogue.send({ t: 'update', from: 'rogue', seq: 2, d: 'AAAA' });
    rogue.send({ t: 'sync2', from: 'rogue', to: 'someone-else', d: 'AAAA' });
    await sleep(20);
    a.text.insert(0, 'still fine');
    await waitFor(() => b.text.toJSON() === 'still fine');
    rogue.disconnect();
  });
});

describe('parseWireMessage', () => {
  it('accepts a valid message', () => {
    expect(parseWireMessage({ t: 'update', from: 'abc', seq: 3, d: 'AQ==' })).toEqual({
      t: 'update',
      from: 'abc',
      seq: 3,
      d: 'AQ==',
    });
  });

  it.each([
    null,
    'text',
    { t: 'nope', from: 'a', d: '' },
    { t: 'aw', from: '', d: '' },
    { t: 'aw', from: 'a', d: 5 },
    { t: 'aw', from: 'a', d: '', to: 3 },
    { t: 'update', from: 'a', d: '', seq: 1.5 },
  ])('rejects %j', (value) => {
    expect(parseWireMessage(value)).toBeNull();
  });
});
