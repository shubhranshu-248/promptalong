import * as Y from 'yjs';
import { PINS_MAX, PIN_ANSWER_MAX, addPin, listPins, pinOf, removePin, type NewPin } from './pins';

const pin = (turnId: string, at: number, answer = 'An answer'): NewPin => ({
  sessionId: 's1',
  sessionName: 'Design',
  turnId,
  label: 'T1',
  prompt: 'A prompt',
  answer,
  by: 'aarav',
  byName: 'Aarav',
  at,
});

describe('pins', () => {
  it('pins once per turn, newest first, and syncs to everyone in the room', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.on('update', (u: Uint8Array) => {
      Y.applyUpdate(b, u);
    });
    expect(addPin(a, pin('t1', 1))).toBe('ok');
    expect(addPin(a, pin('t2', 2))).toBe('ok');
    expect(addPin(a, pin('t1', 3))).toBe('pinned');
    expect(listPins(b).map((p) => p.turnId)).toEqual(['t2', 't1']);
    expect(pinOf(b, 's1', 't1')).toMatchObject({ sessionName: 'Design', byName: 'Aarav' });
    const id = pinOf(a, 's1', 't1')?.id ?? '';
    removePin(a, id);
    expect(listPins(b).map((p) => p.turnId)).toEqual(['t2']);
  });

  it('keeps a long answer up to its limit and says it was cut; at most 50 pins', () => {
    const doc = new Y.Doc();
    addPin(doc, pin('long', 1, 'x'.repeat(PIN_ANSWER_MAX + 10)));
    const long = listPins(doc)[0];
    expect(long?.answer).toHaveLength(PIN_ANSWER_MAX);
    expect(long?.clipped).toBe(true);
    for (let i = 1; i < PINS_MAX; i++) addPin(doc, pin(`t${String(i)}`, i + 1));
    expect(listPins(doc)).toHaveLength(PINS_MAX);
    expect(addPin(doc, pin('one-more', 99))).toBe('full');
  });

  it('ignores a malformed pin from the network', () => {
    const doc = new Y.Doc();
    const bad = new Y.Map<unknown>();
    doc.getMap('pins').set('x', bad);
    bad.set('at', 'yesterday');
    expect(listPins(doc)).toEqual([]);
  });
});
