import * as Y from 'yjs';
import {
  MAIN_BRANCH,
  addTurn,
  authorAt,
  conversation,
  fragmentWithSpans,
  historyMessages,
  initRoom,
  promptFragment,
  promptText,
  readParagraphs,
  splitParagraphs,
  tipOf,
  turnLabels,
  turnsMap,
  writeFragment,
  type Para,
} from '../index';

const p = (text: string, uid = ''): Para => ({
  text,
  spans: uid && text ? [{ from: 0, to: text.length, uid }] : [],
});

function room(): Y.Doc {
  const doc = new Y.Doc();
  initRoom(doc, { name: 'r', sendPolicy: 'everyone', hostPid: 'aarav', createdAt: 1 });
  return doc;
}

let clock = 10;
function send(
  doc: Y.Doc,
  text: string,
  status = 'done',
  answer = `answer to ${text}`,
  branchId = MAIN_BRANCH,
) {
  clock += 1;
  const id = `t${String(clock)}`;
  doc.transact(() => {
    const a = addTurn(doc, {
      id,
      branchId,
      parentId: tipOf(doc),
      createdAt: clock,
      sentBy: 'aarav',
      senderName: 'aarav',
      promptText: text,
      spans: [{ from: 0, to: text.length, uid: 'aarav' }],
      provider: { kind: 'mock', model: 'm', label: 'Demo model' },
      requestHash: 'h',
    });
    a.insert(0, answer);
    turnsMap(doc).get(id)?.set('status', status);
  });
  return id;
}

/** Types into the draft's first paragraph as `uid` (like the editor's author mark does). */
function type(doc: Y.Doc, text: string, uid: string) {
  const para = promptFragment(doc).get(0) as Y.XmlElement;
  const t = para.get(0) as Y.XmlText;
  t.insert(t.length, text, { author: { uid } });
}

describe('conversation', () => {
  it('is one line of turns, oldest first, labelled T1, T2, T3', () => {
    const doc = room();
    expect(conversation(doc)).toEqual([]);
    expect(tipOf(doc)).toBeNull();
    const t1 = send(doc, 'first');
    const t2 = send(doc, 'second');
    const t3 = send(doc, 'third');
    expect(conversation(doc).map((t) => t.id)).toEqual([t1, t2, t3]);
    expect(conversation(doc)[1]?.parentId).toBe(t1);
    expect(tipOf(doc)).toBe(t3);
    expect(Object.fromEntries(turnLabels(doc))).toEqual({ [t1]: 'T1', [t2]: 'T2', [t3]: 'T3' });
  });

  it('history sends finished answers only: no failed or still-streaming turns', () => {
    const doc = room();
    send(doc, 'first');
    send(doc, 'broken', 'failed', 'partial');
    send(doc, 'stopped early', 'stopped', 'half');
    send(doc, 'empty', 'done', '   ');
    expect(historyMessages(doc)).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer to first' },
      { role: 'user', content: 'stopped early' },
      { role: 'assistant', content: 'half' },
    ]);
  });

  it('turns that an older version wrote on another line are not shown', () => {
    const doc = room();
    const t1 = send(doc, 'first');
    send(doc, 'old branch turn', 'done', 'x', 'b1');
    expect(conversation(doc).map((t) => t.id)).toEqual([t1]);
  });
});

describe('author spans', () => {
  it('reads who wrote which part of the prompt, across paragraphs', () => {
    const doc = room();
    type(doc, 'Make it ', 'aarav');
    type(doc, '2 minutes', 'meera');
    const frag = promptFragment(doc);
    const second = new Y.XmlElement('paragraph');
    frag.insert(1, [second]);
    second.insert(0, [new Y.XmlText()]);
    (second.get(0) as Y.XmlText).insert(0, 'End with one ask', { author: { uid: 'kabir' } });
    const { text, spans } = fragmentWithSpans(frag);
    expect(text).toBe('Make it 2 minutes\nEnd with one ask');
    expect(text).toBe(promptText(doc));
    expect(spans).toEqual([
      { from: 0, to: 8, uid: 'aarav' },
      { from: 8, to: 17, uid: 'meera' },
      { from: 18, to: 34, uid: 'kabir' },
    ]);
    expect(authorAt(spans, 9)).toBe('meera');
    expect(splitParagraphs(text, spans)[1]).toEqual(p('End with one ask', 'kabir'));
  });

  it('writeFragment keeps authors and uses one text node per paragraph', () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment('x');
    const paras = [
      {
        text: 'Hello world',
        spans: [
          { from: 0, to: 6, uid: 'a' },
          { from: 6, to: 11, uid: 'b' },
        ],
      },
      p('second', 'c'),
    ];
    writeFragment(frag, paras);
    expect(readParagraphs(frag)).toEqual(paras);
    expect((frag.get(0) as Y.XmlElement).length).toBe(1);
  });
});
