/**
 * Long conversations and small models: when the history does not fit next to the context and the
 * new prompt, older turns are sent shortened, and if that is not enough the oldest are left out.
 * Every browser applies the same rule to the same text, so everyone sees the same request and the
 * context panel still shows exactly what Send posts. The newest turns stay whole as long as they
 * fit. Nothing in the room changes: only what is sent.
 */
export interface HistoryEntry {
  turnId: string;
  prompt: string;
  answer: string;
}

export interface FittedHistory {
  entries: HistoryEntry[];
  /** turns sent shortened */
  shortened: string[];
  /** turns left out */
  left: string[];
}

/** turns kept whole while anything older can be shortened */
export const KEEP_WHOLE = 2;
export const SHORT_PROMPT = 400;
export const SHORT_ANSWER = 600;
/** characters per token assumed for fitting (lower than the usual 4: Hindi and code use more) */
export const FIT_CHARS_PER_TOKEN = 3;

const size = (e: HistoryEntry) => e.prompt.length + e.answer.length;

export function shortenText(text: string, keep: number): string {
  if (text.length <= keep) return text;
  const cut = text.slice(0, keep).replace(/\s+\S*$/u, '');
  return `${cut} […shortened to fit: ${String(text.length - cut.length)} characters left out]`;
}

/** Fits the history into `maxChars` characters (prompts plus answers). */
export function fitHistory(history: readonly HistoryEntry[], maxChars: number): FittedHistory {
  let entries = history.map((e) => ({ ...e }));
  let total = entries.reduce((n, e) => n + size(e), 0);
  const shortened = new Set<string>();
  if (total <= maxChars) return { entries, shortened: [], left: [] };

  // 1. shorten, oldest first; the newest KEEP_WHOLE turns last of all
  const order = [
    ...entries.slice(0, Math.max(0, entries.length - KEEP_WHOLE)),
    ...entries.slice(Math.max(0, entries.length - KEEP_WHOLE)),
  ];
  for (const e of order) {
    if (total <= maxChars) break;
    const before = size(e);
    e.prompt = shortenText(e.prompt, SHORT_PROMPT);
    e.answer = shortenText(e.answer, SHORT_ANSWER);
    if (size(e) < before) {
      shortened.add(e.turnId);
      total -= before - size(e);
    }
  }

  // 2. leave out the oldest until it fits
  const left: string[] = [];
  while (total > maxChars && entries.length > 0) {
    const first = entries[0];
    if (!first) break;
    entries = entries.slice(1);
    total -= size(first);
    left.push(first.turnId);
    shortened.delete(first.turnId);
  }
  return { entries, shortened: [...shortened], left };
}
