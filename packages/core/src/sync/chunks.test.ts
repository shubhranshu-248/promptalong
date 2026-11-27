import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  CHUNK_CHARS,
  ChunkedTransport,
  MemoryHub,
  Reassembler,
  RoomSync,
  parseWireMessage,
  bytesToBase64,
  splitMessage,
  type Transport,
  type WireMessage,
} from './index';

const big = (chars: number) => 'A'.repeat(chars);

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('message parts', () => {
  it('short messages are sent as they are', () => {
    const m: WireMessage = { t: 'update', from: 'a', seq: 1, d: 'AQ==' };
    expect(splitMessage(m)).toEqual([m]);
  });

  it('long payloads become numbered parts that each fit one broadcast', () => {
    const m: WireMessage = { t: 'sync2', from: 'a', to: 'b', d: big(CHUNK_CHARS * 2 + 7) };
    const parts = splitMessage(m);
    expect(parts).toHaveLength(3);
    for (const [i, p] of parts.entries()) {
      expect(p.d.length).toBeLessThanOrEqual(CHUNK_CHARS);
      expect(p.c).toMatchObject({ i, n: 3 });
      expect(p.to).toBe('b');
      // each part survives the network check, and stays under the 256 KB broadcast limit
      expect(parseWireMessage(JSON.parse(JSON.stringify(p)))).toEqual(p);
      expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThan(256 * 1024);
    }
  });

  it('parts come back whole in any order; duplicates and strays are ignored', () => {
    const m: WireMessage = { t: 'update', from: 'a', seq: 4, d: big(CHUNK_CHARS) + 'xyz' };
    const [p0, p1] = splitMessage(m);
    if (!p0 || !p1) throw new Error('no parts');
    const r = new Reassembler();
    expect(r.push(p1)).toBeNull();
    expect(r.push(p1)).toBeNull();
    expect(r.size).toBe(1);
    expect(r.push(p0)).toEqual(m);
    expect(r.size).toBe(0);
  });

  it('an unfinished message is dropped after a minute', () => {
    let now = 0;
    const r = new Reassembler(() => now);
    const [p0] = splitMessage({ t: 'update', from: 'a', d: big(CHUNK_CHARS + 1) });
    if (!p0) throw new Error('no part');
    r.push(p0);
    now = 61_000;
    r.push({ t: 'update', from: 'b', d: 'AQ==' });
    expect(r.size).toBe(0);
  });

  it('the network check refuses broken part markers', () => {
    const base = { t: 'update', from: 'a', d: 'AQ==' };
    expect(parseWireMessage({ ...base, c: { id: 'x', i: 2, n: 2 } })).toBeNull();
    expect(parseWireMessage({ ...base, c: { id: 'x', i: 0, n: 1 } })).toBeNull();
    expect(parseWireMessage({ ...base, c: { id: '', i: 0, n: 2 } })).toBeNull();
    expect(parseWireMessage({ ...base, c: { id: 'x', i: 0, n: 999 } })).toBeNull();
  });
});

describe('ChunkedTransport', () => {
  it('a 1 MB change reaches the other person through parts no larger than one broadcast', async () => {
    const hub = new MemoryHub();
    const largest = { value: 0 };
    const sentParts = { value: 0 };
    const wrap = (t: Transport): Transport => {
      const send = t.send.bind(t);
      t.send = (m) => {
        largest.value = Math.max(largest.value, m.d.length);
        if (m.d.length > 1000) sentParts.value += 1;
        send(m);
      };
      return new ChunkedTransport(t, { rate: 1000 });
    };
    const docs = [new Y.Doc(), new Y.Doc()];
    const syncs = docs.map(
      (doc) =>
        new RoomSync(doc, new Awareness(doc), wrap(hub.createTransport()), {
          coalesceMs: 5,
          coalesceBusyMs: 5,
          awarenessThrottleMs: 5,
          resyncMs: 60_000,
          aloneAfterMs: 40,
        }),
    );
    for (const s of syncs) s.connect();
    const [a, b] = docs;
    if (!a || !b) throw new Error('no docs');
    a.getText('t').insert(0, 'x'.repeat(1024 * 1024));
    await waitFor(() => b.getText('t').length === 1024 * 1024);
    expect(b.getText('t').toJSON()).toBe(a.getText('t').toJSON());
    expect(largest.value).toBeLessThanOrEqual(CHUNK_CHARS);
    // 1 MB of ordinary text is compressed first: far fewer parts than ~9 uncompressed ones
    expect(sentParts.value).toBeLessThan(4);
    for (const s of syncs) s.destroy();
  });

  it('incompressible data still arrives (sent in parts without compression)', async () => {
    const hub = new MemoryHub();
    const a = new ChunkedTransport(hub.createTransport(), { rate: 1000 });
    const b = new ChunkedTransport(hub.createTransport(), { rate: 1000 });
    const got: WireMessage[] = [];
    b.onMessage((m) => got.push(m));
    a.connect();
    b.connect();
    const noise = new Uint8Array(300_000);
    for (let i = 0; i < noise.length; i += 65_536)
      crypto.getRandomValues(noise.subarray(i, i + 65_536));
    const d = bytesToBase64(noise);
    a.send({ t: 'update', from: 'a', d });
    await waitFor(() => got.length === 1);
    expect(got[0]?.d).toBe(d);
    expect(got[0]?.z).toBeUndefined();
  });
});
