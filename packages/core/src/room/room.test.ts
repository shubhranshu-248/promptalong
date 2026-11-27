import * as Y from 'yjs';
import {
  DEFAULT_ROOM_NAME,
  chooseSlot,
  cleanRoomName,
  initRoom,
  isOverCapacity,
  peopleMap,
  promptFragment,
  promptText,
  readSettings,
  upsertPerson,
  type PresentPerson,
} from './index';

describe('room document', () => {
  it('writes settings only once', () => {
    const doc = new Y.Doc();
    expect(readSettings(doc)).toBeNull();
    expect(
      initRoom(doc, {
        name: ' Hackathon   pitch ',
        sendPolicy: 'everyone',
        hostPid: 'p1',
        createdAt: 1,
      }),
    ).toBe(true);
    expect(initRoom(doc, { name: 'Other', sendPolicy: 'host', hostPid: 'p2', createdAt: 2 })).toBe(
      false,
    );
    expect(promptFragment(doc).length).toBe(1);
    expect(promptFragment(doc).toJSON()).toBe('<paragraph></paragraph>');
    expect((promptFragment(doc).get(0) as Y.XmlElement).get(0)).toBeInstanceOf(Y.XmlText);
    expect(readSettings(doc)).toEqual({
      name: 'Hackathon pitch',
      sendPolicy: 'everyone',
      hostPid: 'p1',
      createdAt: 1,
    });
  });

  it('cleans room names', () => {
    expect(cleanRoomName('   ')).toBe(DEFAULT_ROOM_NAME);
    expect(cleanRoomName('x'.repeat(100))).toHaveLength(60);
  });

  it('upserts people without needless writes', () => {
    const doc = new Y.Doc();
    let writes = 0;
    doc.on('update', () => writes++);
    upsertPerson(doc, 'p1', { name: 'Aarav', slot: 1, joinedAt: 5 });
    upsertPerson(doc, 'p1', { name: 'Aarav', slot: 1, joinedAt: 5 });
    expect(writes).toBe(1);
    expect(peopleMap(doc).get('p1')?.name).toBe('Aarav');
  });

  it('reads the prompt as plain text', () => {
    const doc = new Y.Doc();
    const frag = promptFragment(doc);
    const p1 = new Y.XmlElement('paragraph');
    p1.insert(0, [new Y.XmlText('First line')]);
    const p2 = new Y.XmlElement('paragraph');
    p2.insert(0, [new Y.XmlText('Second')]);
    frag.insert(0, [p1, p2]);
    expect(promptText(doc)).toBe('First line\nSecond');
  });
});

describe('colour slots', () => {
  const p = (pid: string, slot: number, joinedAt: number): PresentPerson => ({
    pid,
    slot,
    joinedAt,
  });

  it('gives the first free slot in join order', () => {
    expect(chooseSlot(p('me', 0, 10), [])).toBe(1);
    expect(chooseSlot(p('me', 0, 10), [p('a', 1, 1), p('b', 2, 2)])).toBe(3);
    expect(chooseSlot(p('me', 0, 10), [p('a', 1, 1), p('b', 3, 2)])).toBe(2);
  });

  it('keeps a returning person their old slot when it is free', () => {
    expect(chooseSlot(p('me', 5, 10), [p('a', 1, 1)])).toBe(5);
  });

  it('never takes a slot from someone already here', () => {
    expect(chooseSlot(p('me', 1, 10), [p('a', 1, 1)])).toBe(2);
  });

  it('two people joining at once end up with different slots', () => {
    const x = p('x', 0, 50);
    const y = p('y', 0, 50);
    const sx = chooseSlot(x, [{ ...y, slot: 1 }]);
    const sy = chooseSlot({ ...y, slot: 1 }, [{ ...x, slot: 1 }]);
    // x has priority (same time, smaller id): x keeps 1, y moves
    expect(chooseSlot({ ...x, slot: 1 }, [{ ...y, slot: 1 }])).toBe(1);
    expect(sy).toBe(2);
    expect(sx).toBe(1); // x outranks y, so x may take 1 even though y picked it first
  });

  it('the 17th person is over capacity, the first sixteen are not', () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => p(`p${i}`, i + 1, i));
    expect(isOverCapacity(p('late', 0, 100), sixteen)).toBe(true);
    const [firstPerson, ...rest] = sixteen;
    if (!firstPerson) throw new Error('missing');
    expect(isOverCapacity(firstPerson, [...rest, p('late', 16, 100)])).toBe(false);
    expect(chooseSlot(p('late', 0, 100), sixteen.slice(0, 15))).toBe(16);
  });
});
