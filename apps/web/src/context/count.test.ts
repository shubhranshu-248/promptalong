import { countO200k } from './count';

// Reference values from the o200k_base encoding: the counts an OpenAI-family model reports for the
// same text. If a tokenizer update changes one of them, the budget is no longer "exact".
const FIXTURES: readonly (readonly [string, number])[] = [
  ['', 0],
  ['hello world', 2],
  ['Everyone prompts. One answer.', 6],
  [
    'Make it 2 minutes, add a story about a real student, and end with one clear ask for the judges.',
    24,
  ],
  ['a\n\nb', 3],
  ['नमस्ते दुनिया', 5],
  [
    '[context: judging-criteria.txt · Meera]\n1. Real user problem (30%)  2. Working demo (30%)',
    28,
  ],
];

describe('token counts (o200k_base)', () => {
  it.each(FIXTURES)('%j -> %i tokens', (text, tokens) => {
    expect(countO200k(text)).toBe(tokens);
  });

  it('text that looks like a control token is counted as plain text, not refused', () => {
    expect(countO200k('<|endoftext|> hi')).toBe(8);
  });

  it('a 200 KB item is counted in well under a second', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(4500);
    const started = performance.now();
    expect(countO200k(text)).toBe(45_001);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
