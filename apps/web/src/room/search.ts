import type { TurnView } from '@promptalong/core';

export interface SearchSource {
  id: string;
  name: string;
  turns: TurnView[];
  labels: Record<string, string>;
}

export interface SearchHit {
  sessionId: string;
  sessionName: string;
  turnId: string;
  label: string;
  /** where the words were found */
  where: 'prompt' | 'answer';
  /** a short piece of text around the first match */
  before: string;
  match: string;
  after: string;
}

export const SEARCH_MAX_HITS = 60;
const AROUND = 60;

function words(query: string): string[] {
  return query.toLocaleLowerCase().split(/\s+/u).filter(Boolean).slice(0, 8);
}

function snippet(text: string, at: number, length: number) {
  const start = Math.max(0, at - AROUND);
  const end = Math.min(text.length, at + length + AROUND);
  const flat = (s: string) => s.replace(/\s+/gu, ' ');
  return {
    before: `${start > 0 ? '…' : ''}${flat(text.slice(start, at))}`,
    match: flat(text.slice(at, at + length)),
    after: `${flat(text.slice(at + length, end))}${end < text.length ? '…' : ''}`,
  };
}

/**
 * Finds turns whose prompt or answer holds every word of the query (any order, any case). The
 * newest first within a session, the open session first. Runs in this browser on the sessions
 * this person may open: nothing is sent anywhere.
 */
export function searchSessions(sources: SearchSource[], query: string): SearchHit[] {
  const need = words(query);
  if (need.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const source of sources) {
    for (const turn of [...source.turns].reverse()) {
      for (const where of ['prompt', 'answer'] as const) {
        const text = where === 'prompt' ? turn.prompt.text : turn.answer;
        const lower = text.toLocaleLowerCase();
        if (!need.every((w) => lower.includes(w))) continue;
        const first = need[0] ?? '';
        const at = lower.indexOf(first);
        hits.push({
          sessionId: source.id,
          sessionName: source.name,
          turnId: turn.id,
          label: source.labels[turn.id] ?? '',
          where,
          ...snippet(text, at, first.length),
        });
        break; // one hit per turn
      }
      if (hits.length >= SEARCH_MAX_HITS) return hits;
    }
  }
  return hits;
}
