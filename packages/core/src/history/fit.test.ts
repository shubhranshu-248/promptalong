import * as Y from 'yjs';
import { assembleRoom } from '../context/assemble';
import { MAIN_BRANCH } from '../room/doc';
import { addTurn } from '../turns/turns';
import { fitHistory, shortenText, SHORT_ANSWER } from './fit';
import { tipOf } from './history';

const entry = (id: string, chars: number) => ({
  turnId: id,
  prompt: `Question ${id}`,
  answer: 'word '.repeat(Math.ceil(chars / 5)).slice(0, chars),
});

describe('fitting the history to the model', () => {
  it('leaves a history that fits untouched', () => {
    const h = [entry('t1', 100), entry('t2', 100)];
    expect(fitHistory(h, 10_000)).toEqual({ entries: h, shortened: [], left: [] });
  });

  it('shortens the oldest turns first and keeps the newest whole', () => {
    const h = [entry('t1', 5000), entry('t2', 5000), entry('t3', 5000), entry('t4', 800)];
    const fit = fitHistory(h, 8000);
    expect(fit.left).toEqual([]);
    expect(fit.shortened).toEqual(['t1', 't2']);
    expect(fit.entries[0]?.answer.length).toBeLessThan(SHORT_ANSWER + 80);
    expect(fit.entries[0]?.answer).toMatch(/\[…shortened to fit: \d+ characters left out\]$/u);
    expect(fit.entries[2]?.answer).toBe(h[2]?.answer);
    expect(fit.entries[3]?.answer).toBe(h[3]?.answer);
  });

  it('leaves the oldest out when shortening is not enough', () => {
    const h = Array.from({ length: 10 }, (_, i) => entry(`t${String(i + 1)}`, 3000));
    const fit = fitHistory(h, 3000);
    expect(fit.left[0]).toBe('t1');
    expect(fit.entries.at(-1)?.turnId).toBe('t10');
    const total = fit.entries.reduce((n, e) => n + e.prompt.length + e.answer.length, 0);
    expect(total).toBeLessThanOrEqual(3000);
    expect(fit.shortened.every((id) => !fit.left.includes(id))).toBe(true);
  });

  it('cuts at a word, not in the middle of one', () => {
    expect(shortenText('alpha beta gamma delta', 13)).toBe(
      'alpha beta […shortened to fit: 12 characters left out]',
    );
  });

  it('the room request fits a small model; with a big one everything is whole', () => {
    const doc = new Y.Doc();
    for (let i = 1; i <= 12; i++) {
      const answer = addTurn(doc, {
        id: `t${String(i)}`,
        branchId: MAIN_BRANCH,
        parentId: tipOf(doc),
        createdAt: i,
        sentBy: 'a',
        senderName: 'A',
        promptText: `Question ${String(i)}`,
        spans: [],
        provider: { kind: 'mock', model: 'demo', label: 'Demo model' },
        requestHash: '',
        context: [],
        systemLine: '',
      });
      answer.insert(0, 'An answer that goes on. '.repeat(200));
      doc
        .getMap<Y.Map<unknown>>('turns')
        .get(`t${String(i)}`)
        ?.set('status', 'done');
    }
    const small = assembleRoom(doc, { prompt: 'Next', contextWindow: 8192 });
    const chars = small.messages.reduce((n, m) => n + m.content.length, 0);
    expect(chars / 3).toBeLessThan(8192);
    expect(small.fitted.shortened.length + small.fitted.left.length).toBeGreaterThan(0);
    expect(small.messages.at(-1)?.content).toBe('Next');
    const big = assembleRoom(doc, { prompt: 'Next', contextWindow: 1_048_576 });
    expect(big.fitted).toEqual({ shortened: [], left: [] });
    expect(big.messages).toHaveLength(25);
  });
});
