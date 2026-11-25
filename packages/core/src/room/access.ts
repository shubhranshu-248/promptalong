import type * as Y from 'yjs';

/**
 * What the room document mirrors from the server about access, so everyone sees it at once:
 * whether the room is locked, who was removed, and that the room was deleted. The server decides
 * (ADR-006); these marks are only for showing it. A client that sees itself removed asks the
 * server before it leaves, so a false mark written by someone else does nothing.
 */
export const ACCESS_FIELD = 'access';

function accessMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(ACCESS_FIELD);
}

export function readLocked(doc: Y.Doc): boolean {
  return accessMap(doc).get('locked') === true;
}

/** Who locked or unlocked the room last (null = never). */
export function lockedBy(doc: Y.Doc): string | null {
  const by = accessMap(doc).get('lockedBy');
  return typeof by === 'string' ? by.slice(0, 64) : null;
}

export function writeLocked(doc: Y.Doc, locked: boolean, by: string): void {
  if (readLocked(doc) === locked) return;
  const map = accessMap(doc);
  doc.transact(() => {
    map.set('locked', locked);
    map.set('lockedBy', by);
  });
}

export function markRemoved(doc: Y.Doc, pid: string): void {
  accessMap(doc).set(`removed:${pid}`, true);
}

export function isMarkedRemoved(doc: Y.Doc, pid: string): boolean {
  return accessMap(doc).get(`removed:${pid}`) === true;
}

/** Everyone the host removed (they keep their name on what they wrote). */
export function removedPeople(doc: Y.Doc): string[] {
  const out: string[] = [];
  accessMap(doc).forEach((value, key) => {
    if (value === true && key.startsWith('removed:')) out.push(key.slice('removed:'.length));
  });
  return out.sort();
}

export function markDeleted(doc: Y.Doc): void {
  accessMap(doc).set('deleted', true);
}

export function isMarkedDeleted(doc: Y.Doc): boolean {
  return accessMap(doc).get('deleted') === true;
}

/** The host shown in the room (the server holds the real one). */
export function writeHost(doc: Y.Doc, pid: string): void {
  const settings = doc.getMap('settings');
  if (settings.get('hostPid') !== pid) settings.set('hostPid', pid);
}
