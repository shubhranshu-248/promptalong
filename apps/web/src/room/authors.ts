import type { Span } from '@promptalong/core';
import { presenceHex } from '@promptalong/ui';
import type { RosterEntry } from './session';

export type Roster = Record<string, RosterEntry>;

/** Display name of an author ("you" for this browser). */
export function authorName(roster: Roster, uid: string, me?: string): string {
  if (uid && uid === me) return 'you';
  return roster[uid]?.name ?? 'someone who left';
}

export function authorColor(roster: Roster, uid: string): string {
  return presenceHex(roster[uid]?.slot ?? 1).color;
}

/** The distinct authors of a prompt, in order of first appearance. */
export function authorsOf(spans: readonly Span[]): string[] {
  const seen: string[] = [];
  for (const s of spans) if (s.uid && !seen.includes(s.uid)) seen.push(s.uid);
  return seen;
}
