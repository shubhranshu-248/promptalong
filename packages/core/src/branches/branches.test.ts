import * as Y from 'yjs';
import {
  MAIN_BRANCH,
  activeBranch,
  addTurn,
  applyFork,
  applyMerge,
  authorAt,
  createBranch,
  diff3,
  diffWords,
  draftFragment,
  forkPayload,
  fragmentWithSpans,
  historyMessages,
  initRoom,
  listBranches,
  listMergeEvents,
  listTurns,
  planMerge,
  promptText,
  readAuthors,
  readParagraphs,
  renameBranch,
  setActiveBranch,
  splitParagraphs,
  tipOf,
  turnLabels,
  turnsMap,
  turnsOnPath,
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
  branchId: string,
  text: string,
  by = 'aarav',
  answer = `answer to ${text}`,
) {
  clock += 1;
  const id = `t${String(clock)}`;
  doc.transact(() => {
    const a = addTurn(doc, {
      id,
      branchId,
      parentId: tipOf(doc, branchId),
      createdAt: clock,
      sentBy: by,
      senderName: by,
      promptText: text,
      spans: [{ from: 0, to: text.length, uid: by }],
      provider: { kind: 'mock', model: 'm', label: 'Demo model' },
      requestHash: 'h',
    });
    a.insert(0, answer);
    turnsMap(doc).get(id)?.set('status', 'done');
  });
  return id;
}

/** Types into a draft's first paragraph as `uid` (like the editor's author mark does). */
function type(doc: Y.Doc, branchId: string, text: string, uid: string, at?: number) {
  const para = draftFragment(doc, branchId).get(0) as Y.XmlElement;
  const t = para.get(0) as Y.XmlText;
  t.insert(at ?? t.length, text, { author: { uid } });
}

describe('word diff', () => {
  it('marks removed and added words and joins back to both texts', () => {
    const a = 'Keep the notes under 40 words each, and use the ask.';
    const b = 'Keep the notes to two short lines, and use the ask.';
    const parts = diffWords(a, b);
    expect(
      parts
        .filter((x) => x.type !== 'added')
        .map((x) => x.text)
        .join(''),
    ).toBe(a);
    expect(
      parts
        .filter((x) => x.type !== 'removed')
        .map((x) => x.text)
        .join(''),
    ).toBe(b);
    expect(parts.some((x) => x.type === 'removed' && x.text.includes('40'))).toBe(true);
    for (const x of parts) {
      const src = x.type === 'added' ? b : a;
      expect(src.slice(x.at, x.at + x.text.length)).toBe(x.text);
    }
  });
});

describe('diff3 (paragraph merge)', () => {
  const base = ['intro', 'notes under 40', 'ask'];
  it('takes each side’s change when only one side changed a region', () => {
    const chunks = diff3(
      base,
      ['intro!', 'notes under 40', 'ask'],
      ['intro', 'notes under 40', 'ask', 'P.S.'],
    );
    expect(chunks.every((c) => c.kind === 'ok')).toBe(true);
    expect(chunks.flatMap((c) => (c.kind === 'ok' ? c.items : []))).toEqual([
      'intro!',
      'notes under 40',
      'ask',
      'P.S.',
    ]);
  });
  it('reports a conflict when both changed the same paragraph differently', () => {
    const chunks = diff3(
      base,
      ['intro', 'notes under 35', 'ask'],
      ['intro', 'two short lines', 'ask'],
    );
    const conflicts = chunks.filter((c) => c.kind === 'conflict');
    expect(conflicts).toEqual([
      {
        kind: 'conflict',
        base: ['notes under 40'],
        ours: ['notes under 35'],
        theirs: ['two short lines'],
      },
    ]);
  });
  it('the same change on both sides is not a conflict', () => {
    expect(
      diff3(base, ['intro', 'x', 'ask'], ['intro', 'x', 'ask']).some((c) => c.kind === 'conflict'),
    ).toBe(false);
  });
  it('empty base: identical sides are clean, different sides conflict', () => {
    expect(diff3([], ['a'], ['a']).some((c) => c.kind === 'conflict')).toBe(false);
    expect(diff3([], ['a'], ['b']).filter((c) => c.kind === 'conflict')).toHaveLength(1);
  });
});

describe('author spans', () => {
  it('reads who wrote which part of the prompt, across paragraphs', () => {
    const doc = room();
    type(doc, MAIN_BRANCH, 'Make it ', 'aarav');
    type(doc, MAIN_BRANCH, '2 minutes', 'meera');
    const frag = draftFragment(doc, MAIN_BRANCH);
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
    const doc = room();
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
    writeFragment(draftFragment(doc, 'x'), paras);
    expect(readParagraphs(draftFragment(doc, 'x'))).toEqual(paras);
    const first = draftFragment(doc, 'x').get(0) as Y.XmlElement;
    expect(first.length).toBe(1);
  });
});

describe('branches', () => {
  it('a branch from T1 retries T2 with its own draft; main is untouched', () => {
    const doc = room();
    const t1 = send(doc, MAIN_BRANCH, 'Pitch outline');
    const t2 = send(doc, MAIN_BRANCH, '2-minute pitch with a story', 'meera');
    const b = createBranch(doc, {
      id: 'b1',
      name: 'Shorter Version!',
      fromTurnId: t1,
      sourceBranch: MAIN_BRANCH,
      by: 'kabir',
      at: 50,
    });
    expect(b?.name).toBe('shorter-version');
    // the draft starts as the prompt that came after T1, with its author
    expect(fragmentWithSpans(draftFragment(doc, 'b1'))).toEqual({
      text: '2-minute pitch with a story',
      spans: [{ from: 0, to: 27, uid: 'meera' }],
    });
    expect(turnsOnPath(doc, 'b1').map((t) => t.id)).toEqual([t1]);
    expect(historyMessages(doc, 'b1').map((m) => m.content)).toEqual([
      'Pitch outline',
      'answer to Pitch outline',
    ]);
    const t2b = send(doc, 'b1', '90-second version', 'kabir');
    expect(turnsOnPath(doc, 'b1').map((t) => t.id)).toEqual([t1, t2b]);
    expect(turnsOnPath(doc, MAIN_BRANCH).map((t) => t.id)).toEqual([t1, t2]);
    expect(historyMessages(doc, MAIN_BRANCH)).toHaveLength(4);
    expect(historyMessages(doc, 'b1').map((m) => m.content)).not.toContain(
      '2-minute pitch with a story',
    );
    const labels = turnLabels(doc);
    expect([labels.get(t1), labels.get(t2), labels.get(t2b)]).toEqual(['T1', 'T2', 'T2b']);
    // nothing deleted
    expect(listTurns(doc)).toHaveLength(3);
  });

  it('names are unique, rename works, main cannot be renamed; switching is room-wide', () => {
    const doc = room();
    const t1 = send(doc, MAIN_BRANCH, 'a');
    expect(
      createBranch(doc, {
        id: 'x',
        name: 'try',
        fromTurnId: t1,
        sourceBranch: 'main',
        by: 'a',
        at: 1,
      }),
    ).not.toBeNull();
    expect(
      createBranch(doc, {
        id: 'y',
        name: 'try',
        fromTurnId: t1,
        sourceBranch: 'main',
        by: 'a',
        at: 2,
      }),
    ).toBeNull();
    expect(
      createBranch(doc, {
        id: 'z',
        name: 'main',
        fromTurnId: t1,
        sourceBranch: 'main',
        by: 'a',
        at: 3,
      }),
    ).toBeNull();
    expect(renameBranch(doc, 'x', 'Hindi mix')).toBe(true);
    expect(renameBranch(doc, MAIN_BRANCH, 'other')).toBe(false);
    expect(listBranches(doc).map((b) => b.name)).toEqual(['main', 'hindi-mix']);
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    setActiveBranch(doc, 'x', 'kabir');
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    expect(activeBranch(other)).toBe('x');
  });
});

describe('merge', () => {
  function setup() {
    const doc = room();
    const t1 = send(doc, MAIN_BRANCH, 'Pitch outline');
    writeFragment(draftFragment(doc, MAIN_BRANCH), [
      p('Now turn this into slide titles.', 'aarav'),
      p('Keep the notes under 40 words each.', 'meera'),
      p('Use the ask as the last slide.', 'aarav'),
    ]);
    createBranch(doc, {
      id: 'b1',
      name: 'shorter',
      fromTurnId: t1,
      sourceBranch: MAIN_BRANCH,
      by: 'kabir',
      at: 50,
    });
    return doc;
  }

  it('clean: the branch changed one paragraph, main another - both land, authors kept', () => {
    const doc = setup();
    const theirs = draftFragment(doc, 'b1');
    writeFragment(theirs, [
      p('Now turn this into slide titles.', 'aarav'),
      p('Keep the notes under 40 words each.', 'meera'),
      p('Use the ask as the last slide. Open in Hinglish.', 'ishita'),
    ]);
    const mainFrag = draftFragment(doc, MAIN_BRANCH);
    writeFragment(mainFrag, [
      p('Now turn this into THREE slide titles.', 'aarav'),
      p('Keep the notes under 40 words each.', 'meera'),
      p('Use the ask as the last slide.', 'aarav'),
    ]);
    const plan = planMerge(doc, 'b1', MAIN_BRANCH);
    expect(plan.conflicts).toBe(0);
    applyMerge(doc, plan, [], { id: 'm1', by: 'kabir', at: 99 });
    expect(readParagraphs(mainFrag)).toEqual([
      p('Now turn this into THREE slide titles.', 'aarav'),
      p('Keep the notes under 40 words each.', 'meera'),
      p('Use the ask as the last slide. Open in Hinglish.', 'ishita'),
    ]);
    expect(listMergeEvents(doc)).toEqual([
      { id: 'm1', type: 'merge', from: 'b1', into: 'main', by: 'kabir', at: 99, conflicts: 0 },
    ]);
    // the branch keeps its draft (nothing is deleted)
    expect(readParagraphs(draftFragment(doc, 'b1'))[2]?.text).toContain('Hinglish');
  });

  it('conflict: keep ours / theirs / both', () => {
    for (const [choice, expected] of [
      ['ours', ['Keep the notes under 35 words each.']],
      ['theirs', ['Keep the notes to two short lines.']],
      ['both', ['Keep the notes under 35 words each.', 'Keep the notes to two short lines.']],
    ] as const) {
      const doc = setup();
      writeFragment(draftFragment(doc, 'b1'), [
        p('Now turn this into slide titles.', 'aarav'),
        p('Keep the notes to two short lines.', 'kabir'),
        p('Use the ask as the last slide.', 'aarav'),
      ]);
      writeFragment(draftFragment(doc, MAIN_BRANCH), [
        p('Now turn this into slide titles.', 'aarav'),
        p('Keep the notes under 35 words each.', 'meera'),
        p('Use the ask as the last slide.', 'aarav'),
      ]);
      const plan = planMerge(doc, 'b1', MAIN_BRANCH);
      expect(plan.conflicts).toBe(1);
      applyMerge(doc, plan, [choice], { id: 'm', by: 'kabir', at: 1 });
      const texts = readParagraphs(draftFragment(doc, MAIN_BRANCH)).map((x) => x.text);
      expect(texts).toEqual([
        'Now turn this into slide titles.',
        ...expected,
        'Use the ask as the last slide.',
      ]);
    }
  });

  it('untouched paragraphs are kept as they are: someone typing there loses nothing', () => {
    const doc = setup();
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    writeFragment(draftFragment(doc, 'b1'), [
      p('Now turn this into slide titles.', 'aarav'),
      p('Keep the notes to two short lines.', 'kabir'),
      p('Use the ask as the last slide.', 'aarav'),
    ]);
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    // Meera types in paragraph 1 of main on another device while Kabir merges
    const firstOnOther = (draftFragment(other, MAIN_BRANCH).get(0) as Y.XmlElement).get(
      0,
    ) as Y.XmlText;
    firstOnOther.insert(0, 'PLEASE ', { author: { uid: 'meera' } });
    applyMerge(doc, planMerge(doc, 'b1', MAIN_BRANCH), [], { id: 'm', by: 'kabir', at: 1 });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const texts = readParagraphs(draftFragment(doc, MAIN_BRANCH)).map((x) => x.text);
    expect(texts).toEqual([
      'PLEASE Now turn this into slide titles.',
      'Keep the notes to two short lines.',
      'Use the ask as the last slide.',
    ]);
    expect(readParagraphs(draftFragment(other, MAIN_BRANCH)).map((x) => x.text)).toEqual(texts);
  });

  it('an empty draft merges the side’s last sent prompt', () => {
    const doc = room();
    const t1 = send(doc, MAIN_BRANCH, 'base prompt');
    createBranch(doc, {
      id: 'b1',
      name: 'b',
      fromTurnId: t1,
      sourceBranch: MAIN_BRANCH,
      by: 'k',
      at: 1,
    });
    send(doc, 'b1', 'branch prompt', 'kabir');
    const plan = planMerge(doc, 'b1', MAIN_BRANCH);
    applyMerge(doc, plan, plan.conflicts ? ['theirs'] : [], { id: 'm', by: 'k', at: 2 });
    expect(promptText(doc)).toBe('branch prompt');
    expect(fragmentWithSpans(draftFragment(doc, MAIN_BRANCH)).spans).toEqual([
      { from: 0, to: 13, uid: 'kabir' },
    ]);
  });
});

describe('fork', () => {
  it('copies the path up to a turn with prompts, authors, answers; streaming becomes interrupted', () => {
    const doc = room();
    const t1 = send(doc, MAIN_BRANCH, 'one', 'aarav');
    const t2 = send(doc, MAIN_BRANCH, 'two', 'meera');
    send(doc, MAIN_BRANCH, 'three', 'kabir');
    turnsMap(doc).get(t2)?.set('status', 'streaming');
    const payload = forkPayload(doc, {
      branchId: MAIN_BRANCH,
      uptoTurnId: t2,
      fromCode: 'K7QM2X',
      names: (pid) =>
        ({ aarav: { name: 'Aarav', slot: 1 }, meera: { name: 'Meera', slot: 2 } })[pid] ?? null,
    });
    if (!payload) throw new Error('no payload');
    // the payload travels through history.state (structured clone)
    const copy = structuredClone(payload);
    const fresh = room();
    applyFork(fresh, copy);
    const turns = listTurns(fresh);
    expect(turns.map((t) => [t.prompt.text, t.answer, t.status])).toEqual([
      ['one', 'answer to one', 'done'],
      ['two', 'answer to two', 'interrupted'],
    ]);
    expect(turns[1]?.parentId).toBe(t1);
    expect(turns[1]?.prompt.spans).toEqual([{ from: 0, to: 3, uid: 'meera' }]);
    expect(readAuthors(fresh).get('meera')).toEqual({ name: 'Meera', slot: 2, from: 'K7QM2X' });
    expect(turnsOnPath(fresh, MAIN_BRANCH)).toHaveLength(2);
  });
});
