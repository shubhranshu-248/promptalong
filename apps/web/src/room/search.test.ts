import type { TurnView } from '@promptalong/core';
import { searchSessions } from './search';

const turn = (id: string, prompt: string, answer: string) =>
  ({ id, prompt: { text: prompt, spans: [] }, answer }) as unknown as TurnView;

const sources = [
  {
    id: 'a',
    name: 'Slides',
    turns: [turn('t1', 'Three slide titles', 'Problem, Demo, Ask'), turn('t2', 'Shorter', 'OK')],
    labels: { t1: 'T1', t2: 'T2' },
  },
  {
    id: 'b',
    name: 'Research',
    turns: [turn('u1', 'Survey numbers', `${'x '.repeat(80)}61 of 80 students lost a demo laptop`)],
    labels: { u1: 'T1' },
  },
];

describe('search across sessions', () => {
  it('every word, any case and order, in prompts and answers, one hit per turn', () => {
    expect(searchSessions(sources, 'demo').map((h) => [h.sessionName, h.label, h.where])).toEqual([
      ['Slides', 'T1', 'answer'],
      ['Research', 'T1', 'answer'],
    ]);
    expect(searchSessions(sources, 'TITLES three').map((h) => h.where)).toEqual(['prompt']);
    expect(searchSessions(sources, 'demo nothing-like-this')).toEqual([]);
    expect(searchSessions(sources, '   ')).toEqual([]);
  });

  it('shows the words around the match, cut with an ellipsis', () => {
    const [hit] = searchSessions(sources, 'students');
    expect(hit?.match).toBe('students');
    expect(hit?.before.startsWith('…')).toBe(true);
    expect(hit?.after).toBe(' lost a demo laptop');
  });
});
