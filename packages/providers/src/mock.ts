import { MOCK_MODELS } from './catalog/index';
import { ProviderError } from './errors';
import { approxTokens, sleep } from './streams';
import type { ChatRequest, ModelInfo, Provider, StreamChunk } from './types';

/**
 * The demo model: scripted answers, no network, no key. The same request always produces the same
 * chunks (same text, same split), so every test run and every demo looks the same.
 *
 * Two prompt prefixes exist for demos and tests: "/fail" answers with a rate-limit error and
 * "/short" gives a one-sentence answer.
 */
export interface MockOptions {
  /** delay between chunks in ms (default 40) */
  chunkMs?: number;
}

const SCRIPTS: readonly ((topic: string) => string)[] = [
  (t) =>
    `Here is a first pass at "${t}".\n\n` +
    'Opening (20 s). Start with one real person and one concrete moment: a student who lost something important two days before exams and spent four days looking for it.\n\n' +
    'Problem (25 s). Everyone has the tool already, but nobody uses it, because nobody knows where it is or what is already in it.\n\n' +
    'Solution (40 s). Put every item on one live map. Snap a photo, drop a pin, and the owner gets a match in minutes instead of days.\n\n' +
    'Ask (15 s). End with one clear, specific request for the judges, with a number in it.',
  (t) =>
    `Three slide titles for "${t}":\n\n` +
    '1. "Four days of looking" - open with the story, pause after the last day.\n' +
    '2. "Why nobody uses it" - one sentence, one picture, no bullet points.\n' +
    '3. "Found in minutes" - show the map, then the match notification.\n\n' +
    'Speaker notes: keep each under 40 words and finish on the ask from the closing line.',
  (t) =>
    `Summary of "${t}" in one table:\n\n` +
    '| Question | Answer | Count |\n|---|---|---|\n' +
    '| Lost something on campus this term | Yes | 31 of 40 |\n' +
    '| Checked the lost-and-found desk | No | 27 of 31 |\n' +
    '| Would post a found item on a map | Yes | 36 of 40 |\n\n' +
    'Takeaway: the need is real and the habit is missing, which is exactly the gap the idea fills.',
  (t) =>
    `A sharper version of "${t}":\n\n` +
    'Lead with the result, not the feature. Cut every sentence that does not move the story forward. ' +
    'Replace general words with one number the audience can remember, and make the last line a question ' +
    'they can answer with yes. Read it aloud once: if a line makes you take a breath in the middle, split it.',
];

/** FNV-1a, enough to pick a script deterministically. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function topicOf(prompt: string): string {
  const words = prompt.replace(/\s+/gu, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return 'your prompt';
  const short = words.slice(0, 8).join(' ');
  return words.length > 8 ? `${short}…` : short;
}

export function mockAnswer(req: ChatRequest): string {
  const last = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const prompt = last.trim();
  if (prompt.startsWith('/short')) return `Short answer to "${topicOf(prompt.slice(6))}": done.`;
  const turn = req.messages.filter((m) => m.role === 'user').length;
  const script = SCRIPTS[(hash(prompt) + turn) % SCRIPTS.length] ?? SCRIPTS[0];
  return script ? script(topicOf(prompt)) : '';
}

/** Splits text into chunks of one to three words (spaces kept), the same way every time. */
export function mockChunks(text: string): string[] {
  const parts = text.match(/\S+\s*/gu) ?? [];
  const chunks: string[] = [];
  let i = 0;
  let n = 0;
  const leading = /^\s+/u.exec(text)?.[0] ?? '';
  while (i < parts.length) {
    const size = 1 + ((hash(text) + n) % 3);
    chunks.push(parts.slice(i, i + size).join(''));
    i += size;
    n += 1;
  }
  if (leading && chunks.length > 0) chunks[0] = leading + (chunks[0] ?? '');
  return chunks;
}

export class MockProvider implements Provider {
  readonly kind = 'mock' as const;
  private readonly chunkMs: number;

  constructor(options: MockOptions = {}) {
    this.chunkMs = options.chunkMs ?? 40;
  }

  available() {
    return Promise.resolve({ ok: true as const });
  }

  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve([...MOCK_MODELS]);
  }

  buildRequestBody(req: ChatRequest): string {
    return JSON.stringify({ model: req.model, messages: req.messages, stream: true });
  }

  async *stream(body: string, signal: AbortSignal): AsyncIterable<StreamChunk> {
    const req = JSON.parse(body) as ChatRequest;
    const last = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const input = approxTokens(req.messages.map((m) => m.content).join('\n'));
    if (last.trim().startsWith('/fail')) {
      await sleep(Math.max(this.chunkMs, 1) * 5, signal);
      throw new ProviderError('rate-limit', 'rate limit reached, try again in 20 s', 429);
    }
    const answer = mockAnswer(req);
    for (const text of mockChunks(answer)) {
      await sleep(this.chunkMs, signal);
      yield { text };
    }
    yield { text: '', done: true, usage: { input, output: approxTokens(answer) } };
  }
}
