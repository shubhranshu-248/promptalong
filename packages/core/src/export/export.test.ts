import * as Y from 'yjs';
import {
  MAIN_BRANCH,
  addContextItem,
  addTurn,
  exportFileName,
  exportJson,
  exportMarkdown,
  initRoom,
  isMarkedDeleted,
  isMarkedRemoved,
  lockedBy,
  markDeleted,
  markRemoved,
  readLocked,
  readSettings,
  removedPeople,
  setContextIncluded,
  setSystemLine,
  tipOf,
  upsertPerson,
  writeHost,
  writeLocked,
} from '../index';

const AT = Date.UTC(2026, 10, 25, 9, 30);

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
  setSystemLine(doc, 'You are helping a team prepare a pitch.', 'aarav');
  addContextItem(doc, {
    id: 'c1',
    ownerUid: 'meera',
    kind: 'file',
    title: 'judging-criteria.txt',
    text: '1. Real user problem\n2. Working demo',
    createdAt: 5,
  });
  addContextItem(doc, {
    id: 'c2',
    ownerUid: 'aarav',
    kind: 'note',
    title: 'Old pitch draft',
    text: 'We help students.',
    createdAt: 6,
  });
  setContextIncluded(doc, 'c2', false, 'meera');
  return doc;
}

function turn(
  doc: Y.Doc,
  id: string,
  text: string,
  answer: string,
  extra: {
    status?: string;
    spans?: { from: number; to: number; uid: string }[];
  } = {},
): void {
  doc.transact(() => {
    const a = addTurn(doc, {
      id,
      branchId: MAIN_BRANCH,
      parentId: tipOf(doc),
      createdAt: AT + Number(id.slice(1)) * 60_000,
      sentBy: 'meera',
      senderName: 'Meera',
      promptText: text,
      spans: extra.spans ?? [],
      provider: { kind: 'byok', model: 'gpt-4o-mini', endpoint: 'openai', label: 'GPT-4o mini' },
      requestHash: 'a'.repeat(64),
      context: [
        {
          itemId: 'c1',
          title: 'judging-criteria.txt',
          ownerUid: 'meera',
          ownerName: 'Meera',
          kind: 'file',
          bytes: 35,
          tokens: 12,
          exact: true,
          hash: 'b'.repeat(64),
        },
      ],
      systemLine: 'You are helping a team prepare a pitch.',
    });
    a.insert(0, answer);
    const map = doc.getMap<Y.Map<unknown>>('turns').get(id);
    map?.set('status', extra.status ?? 'done');
    map?.set('usage', { input: 1284, output: 212 });
  });
}

describe('export', () => {
  it('Markdown: every turn with who wrote the prompt, the context used and the model', () => {
    const doc = room();
    turn(doc, 't1', 'Write a 2 minute pitch\nfor the judges', 'Opening (20 s).', {
      spans: [
        { from: 0, to: 22, uid: 'aarav' },
        { from: 22, to: 37, uid: 'meera' },
      ],
    });
    turn(doc, 't2', 'Now shorter', 'Half as long.', { status: 'stopped' });
    const md = exportMarkdown(doc, {
      includeContext: true,
      includeAuthors: true,
      code: 'K7QM2X',
      exportedAt: AT,
    });
    expect(md).toBe(
      [
        '# Hackathon pitch',
        '',
        'Room K7Q-M2X · 2 turns · exported 2026-11-25',
        '',
        '## Turn 1 - sent by Meera',
        '',
        '**Prompt** (Aarav, Meera)',
        '',
        '> Write a 2 minute pitch',
        '> for the judges',
        '',
        'Room line: You are helping a team prepare a pitch.',
        'Context: judging-criteria.txt (Meera)',
        'Model: GPT-4o mini · 1,284 tokens in, 212 out',
        '',
        'Opening (20 s).',
        '',
        '## Turn 2 - sent by Meera',
        '',
        '**Prompt**',
        '',
        '> Now shorter',
        '',
        'Room line: You are helping a team prepare a pitch.',
        'Context: judging-criteria.txt (Meera)',
        'Model: GPT-4o mini · 1,284 tokens in, 212 out',
        'Status: stopped',
        '',
        'Half as long.',
        '',
        '## Context items',
        '',
        '### judging-criteria.txt (Meera, file)',
        '',
        '> 1. Real user problem',
        '> 2. Working demo',
        '',
        '### Old pitch draft (Aarav, note, excluded)',
        '',
        '> We help students.',
        '',
      ].join('\n'),
    );
  });

  it('without context and without names: nothing of either is left', () => {
    const doc = room();
    turn(doc, 't1', 'Write a pitch', 'Opening.', { spans: [{ from: 0, to: 13, uid: 'aarav' }] });
    const options = {
      includeContext: false,
      includeAuthors: false,
      code: 'K7QM2X',
      exportedAt: AT,
    };
    for (const text of [exportMarkdown(doc, options), exportJson(doc, options)]) {
      expect(text).not.toMatch(/Aarav|Meera/u);
      expect(text).not.toMatch(/judging-criteria|Old pitch draft|helping a team/u);
      expect(text).toContain('Person 1');
    }
    // the same person keeps the same stand-in everywhere
    const json = JSON.parse(exportJson(doc, options)) as {
      turns: { sentBy: string; prompt: { segments: { author: string }[] } }[];
    };
    expect(json.turns[0]?.sentBy).toBe('Person 1');
    expect(json.turns[0]?.prompt.segments[0]?.author).toBe('Person 2');
  });

  it('JSON: the full record of the conversation', () => {
    const doc = room();
    turn(doc, 't1', 'first', 'answer one', { spans: [{ from: 0, to: 5, uid: 'aarav' }] });
    turn(doc, 't2', 'second', 'answer two');
    const json = JSON.parse(
      exportJson(doc, {
        includeContext: true,
        includeAuthors: true,
        code: 'K7QM2X',
        exportedAt: AT,
      }),
    ) as Record<string, unknown> & {
      turns: Record<string, unknown>[];
      contextItems: unknown[];
    };
    expect(json).toMatchObject({
      app: 'PromptAlong',
      format: 1,
      exportedAt: '2026-11-25T09:30:00.000Z',
      room: { name: 'Hackathon pitch', code: 'K7QM2X' },
      roomLine: 'You are helping a team prepare a pitch.',
    });
    expect(json).not.toHaveProperty('branches');
    expect(json.turns.map((t) => [t.label, t.answer])).toEqual([
      ['T1', 'answer one'],
      ['T2', 'answer two'],
    ]);
    expect(json.turns[0]).toMatchObject({
      sentBy: 'Meera',
      prompt: { text: 'first', segments: [{ from: 0, to: 5, text: 'first', author: 'Aarav' }] },
      context: [{ title: 'judging-criteria.txt', owner: 'Meera', sha256: 'b'.repeat(64) }],
      model: { kind: 'byok', model: 'gpt-4o-mini', label: 'GPT-4o mini', endpoint: 'openai' },
      requestSha256: 'a'.repeat(64),
      status: 'done',
      usage: { input: 1284, output: 212 },
    });
    expect(json.contextItems).toHaveLength(2);
  });

  it('never contains a model key: the room document has nowhere to keep one', () => {
    const doc = room();
    // someone tries to smuggle a key into the room's model choice
    doc
      .getMap('settings')
      .set('model', { kind: 'byok', model: 'm', endpoint: 'openai', key: 'sk-secret-123' });
    turn(doc, 't1', 'first', 'answer');
    const options = {
      includeContext: true,
      includeAuthors: true,
      code: 'K7QM2X',
      exportedAt: AT,
    };
    expect(exportJson(doc, options)).not.toContain('sk-secret-123');
    expect(exportMarkdown(doc, options)).not.toContain('sk-secret-123');
    expect(Object.keys(JSON.parse(exportJson(doc, options)) as object)).not.toContain('key');
  });

  it('an empty room and file names', () => {
    const doc = room();
    const md = exportMarkdown(doc, {
      includeContext: false,
      includeAuthors: true,
      code: 'K7QM2X',
      exportedAt: AT,
    });
    expect(md).toContain('0 turns');
    expect(md).toContain('Nothing has been sent in this room yet.');
    expect(exportFileName('Hackathon pitch!', AT, 'md')).toBe('hackathon-pitch-2026-11-25.md');
    expect(exportFileName('  ', AT, 'json')).toBe('room-2026-11-25.json');
  });
});

describe('access marks in the room document', () => {
  it('lock, removals, deletion and the shown host', () => {
    const doc = room();
    expect(readLocked(doc)).toBe(false);
    expect(lockedBy(doc)).toBeNull();
    writeLocked(doc, true, 'aarav');
    expect([readLocked(doc), lockedBy(doc)]).toEqual([true, 'aarav']);
    writeLocked(doc, false, 'meera');
    expect([readLocked(doc), lockedBy(doc)]).toEqual([false, 'meera']);

    markRemoved(doc, 'kabir');
    expect(isMarkedRemoved(doc, 'kabir')).toBe(true);
    expect(isMarkedRemoved(doc, 'meera')).toBe(false);
    expect(removedPeople(doc)).toEqual(['kabir']);

    expect(isMarkedDeleted(doc)).toBe(false);
    markDeleted(doc);
    expect(isMarkedDeleted(doc)).toBe(true);

    writeHost(doc, 'meera');
    expect(readSettings(doc)?.hostPid).toBe('meera');
  });
});
