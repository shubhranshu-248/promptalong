import * as Y from 'yjs';
import { MAIN_BRANCH } from '../room/doc';
import { turnsMap, type TurnView } from '../turns/turns';
import { turnsOnPath } from './branches';

/**
 * Fork room (ADR-004): a new room gets the turns along the chosen path. Author ids and names are
 * kept as a frozen list marked with the room they came from. Model keys are never part of a room,
 * so they cannot be copied.
 */
export const AUTHORS_FIELD = 'authors';

export interface FrozenAuthor {
  name: string;
  slot: number;
  from: string;
}

export interface ForkPayload {
  fromCode: string;
  turns: TurnView[];
  authors: Record<string, FrozenAuthor>;
}

export function authorsMap(doc: Y.Doc): Y.Map<FrozenAuthor> {
  return doc.getMap<FrozenAuthor>(AUTHORS_FIELD);
}

/** The turns of `branchId` up to and including `uptoTurnId`, plus the people who wrote them. */
export function forkPayload(
  doc: Y.Doc,
  input: {
    branchId: string;
    uptoTurnId: string;
    fromCode: string;
    names: (pid: string) => { name: string; slot: number } | null;
  },
): ForkPayload | null {
  const path = turnsOnPath(doc, input.branchId);
  const end = path.findIndex((t) => t.id === input.uptoTurnId);
  if (end < 0) return null;
  const turns = path.slice(0, end + 1);
  const authors: Record<string, FrozenAuthor> = {};
  const add = (pid: string) => {
    if (!pid || authors[pid]) return;
    const who = input.names(pid);
    if (who) authors[pid] = { name: who.name, slot: who.slot, from: input.fromCode };
  };
  for (const t of turns) {
    add(t.sentBy);
    for (const s of t.prompt.spans) add(s.uid);
    if (t.stoppedBy) add(t.stoppedBy);
  }
  return { fromCode: input.fromCode, turns, authors };
}

/** Writes a fork's turns into a new room's document as its main history. */
export function applyFork(doc: Y.Doc, payload: ForkPayload): void {
  doc.transact(() => {
    let parent: string | null = null;
    for (const t of payload.turns.slice(0, 500)) {
      const map = new Y.Map<unknown>();
      map.set('branchId', MAIN_BRANCH);
      map.set('parentId', parent);
      map.set('createdAt', t.createdAt);
      map.set('sentBy', t.sentBy);
      map.set('senderName', t.senderName);
      map.set('prompt', { text: t.prompt.text, spans: t.prompt.spans.map((s) => ({ ...s })) });
      map.set('provider', { ...t.provider });
      map.set('requestHash', t.requestHash);
      // a stream cannot continue in another room
      map.set('status', t.status === 'streaming' ? 'interrupted' : t.status);
      if (t.status === 'streaming') map.set('interruptedReason', 'lost');
      map.set('answer', new Y.Text(t.answer));
      if (t.usage) map.set('usage', { ...t.usage });
      if (t.durationMs !== undefined) map.set('durationMs', t.durationMs);
      if (t.error) map.set('error', { ...t.error });
      if (t.stoppedBy) map.set('stoppedBy', t.stoppedBy);
      if (t.interruptedReason) map.set('interruptedReason', t.interruptedReason);
      map.set('forkedFrom', payload.fromCode);
      turnsMap(doc).set(t.id, map);
      parent = t.id;
    }
    const authors = authorsMap(doc);
    // the payload arrives through history.state: check each field at runtime
    for (const [pid, raw] of Object.entries(payload.authors as Record<string, unknown>).slice(
      0,
      200,
    )) {
      const a = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
      if (typeof a.name !== 'string') continue;
      authors.set(pid.slice(0, 64), {
        name: a.name.slice(0, 24),
        slot: typeof a.slot === 'number' && Number.isInteger(a.slot) ? a.slot : 1,
        from: typeof a.from === 'string' ? a.from.slice(0, 12) : '',
      });
    }
  });
}

/** Frozen authors of a forked room (pid -> name, colour slot, room they came from). */
export function readAuthors(doc: Y.Doc): Map<string, FrozenAuthor> {
  const out = new Map<string, FrozenAuthor>();
  authorsMap(doc).forEach((a, pid) => {
    if (typeof a === 'object' && typeof a.name === 'string' && typeof a.slot === 'number') {
      out.set(pid, { name: a.name, slot: a.slot, from: typeof a.from === 'string' ? a.from : '' });
    }
  });
  return out;
}
