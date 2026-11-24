import * as Y from 'yjs';

/**
 * Context items (U3, ADR-005): notes, pasted snippets and text files that people attach to the
 * room. Every item is its own map, so including or excluding one never rewrites its text.
 * Text only, UTF-8, at most 200 KB per item and 20 items per room.
 */
export const CONTEXT_FIELD = 'context';
export const CONTEXT_MAX_ITEMS = 20;
export const CONTEXT_MAX_BYTES = 200 * 1024;
export const CONTEXT_TITLE_MAX = 80;
export const SYSTEM_LINE_MAX = 2000;

export type ContextKind = 'note' | 'snippet' | 'file';

/** What the room shows about an item. The text itself is read with `contextText`. */
export interface ContextItemView {
  id: string;
  ownerUid: string;
  kind: ContextKind;
  title: string;
  included: boolean;
  /** who last included or excluded it (null = never toggled) */
  toggledBy: string | null;
  createdAt: number;
  /** UTF-8 size of the text */
  bytes: number;
  /** when the title or text last changed (the creation time until then) */
  updatedAt: number;
}

export interface NewContextItem {
  id: string;
  ownerUid: string;
  kind: ContextKind;
  title: string;
  text: string;
  createdAt: number;
}

export type AddContextResult =
  | { ok: true; item: ContextItemView }
  | { ok: false; reason: 'empty' | 'too-large' | 'room-full' | 'exists' };

const KINDS = new Set<string>(['note', 'snippet', 'file']);
const encoder = new TextEncoder();

export function contextMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(CONTEXT_FIELD);
}

export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

/** New lines as "\n", no byte-order mark, no trailing blank space: what is stored is what is sent. */
export function cleanContextText(text: string): string {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return body.replace(/\r\n?/gu, '\n').replace(/\s+$/u, '');
}

export function cleanContextTitle(input: string, fallback = 'Untitled'): string {
  const title = input.replace(/\s+/gu, ' ').trim().slice(0, CONTEXT_TITLE_MAX).trim();
  return title.length > 0 ? title : fallback;
}

function readItem(id: string, value: unknown): (ContextItemView & { text: string }) | null {
  if (!(value instanceof Y.Map)) return null;
  const item = value as Y.Map<unknown>;
  const kind = item.get('kind');
  const text = item.get('text');
  const ownerUid = item.get('ownerUid');
  const createdAt = item.get('createdAt');
  if (typeof kind !== 'string' || !KINDS.has(kind)) return null;
  // (a cheap bound: UTF-8 is never shorter than the UTF-16 length)
  if (typeof text !== 'string' || text.length === 0 || text.length > CONTEXT_MAX_BYTES) return null;
  if (typeof ownerUid !== 'string' || typeof createdAt !== 'number') return null;
  const title = item.get('title');
  const toggledBy = item.get('toggledBy');
  const bytes = item.get('bytes');
  const updatedAt = item.get('updatedAt');
  return {
    id,
    ownerUid: ownerUid.slice(0, 64),
    kind: kind as ContextKind,
    title: cleanContextTitle(typeof title === 'string' ? title : ''),
    included: item.get('included') !== false,
    toggledBy: typeof toggledBy === 'string' ? toggledBy.slice(0, 64) : null,
    createdAt,
    bytes: typeof bytes === 'number' && bytes >= text.length ? bytes : text.length,
    updatedAt: typeof updatedAt === 'number' ? updatedAt : createdAt,
    text,
  };
}

function readAll(doc: Y.Doc): (ContextItemView & { text: string })[] {
  const out: (ContextItemView & { text: string })[] = [];
  contextMap(doc).forEach((item, id) => {
    const view = readItem(id, item);
    if (view) out.push(view);
  });
  out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  // Two people adding the 20th item at the same moment: the same 20 win on every device.
  return out.slice(0, CONTEXT_MAX_ITEMS);
}

/** The room's context items in creation order (without their text). */
export function listContext(doc: Y.Doc): ContextItemView[] {
  return readAll(doc).map((item) => ({
    id: item.id,
    ownerUid: item.ownerUid,
    kind: item.kind,
    title: item.title,
    included: item.included,
    toggledBy: item.toggledBy,
    createdAt: item.createdAt,
    bytes: item.bytes,
    updatedAt: item.updatedAt,
  }));
}

/** Items with their text, in creation order (assembly, fork). */
export function listContextWithText(doc: Y.Doc): (ContextItemView & { text: string })[] {
  return readAll(doc);
}

export function contextText(doc: Y.Doc, id: string): string | null {
  return readItem(id, contextMap(doc).get(id))?.text ?? null;
}

/** Adds an item, included by default. Refused when empty, over 200 KB or the room has 20. */
export function addContextItem(doc: Y.Doc, input: NewContextItem): AddContextResult {
  const text = cleanContextText(input.text);
  if (text.trim().length === 0) return { ok: false, reason: 'empty' };
  const bytes = utf8Bytes(text);
  if (bytes > CONTEXT_MAX_BYTES) return { ok: false, reason: 'too-large' };
  const map = contextMap(doc);
  if (map.has(input.id)) return { ok: false, reason: 'exists' };
  if (listContext(doc).length >= CONTEXT_MAX_ITEMS) return { ok: false, reason: 'room-full' };
  const item = new Y.Map<unknown>();
  item.set('ownerUid', input.ownerUid);
  item.set('kind', input.kind);
  item.set('title', cleanContextTitle(input.title));
  item.set('text', text);
  item.set('bytes', bytes);
  item.set('included', true);
  item.set('createdAt', input.createdAt);
  map.set(input.id, item);
  const view = listContext(doc).find((i) => i.id === input.id);
  return view ? { ok: true, item: view } : { ok: false, reason: 'room-full' };
}

/** Includes or excludes an item for the whole room and records who did it. */
export function setContextIncluded(doc: Y.Doc, id: string, included: boolean, by: string): boolean {
  const item = contextMap(doc).get(id);
  if (!(item instanceof Y.Map) || !readItem(id, item)) return false;
  if ((item.get('included') !== false) === included) return false;
  doc.transact(() => {
    item.set('included', included);
    item.set('toggledBy', by);
  });
  return true;
}

/** Changes an item's title and / or text (same limits as adding). */
export function updateContextItem(
  doc: Y.Doc,
  id: string,
  patch: { title?: string; text?: string },
  at: number = Date.now(),
): 'ok' | 'missing' | 'empty' | 'too-large' {
  const item = contextMap(doc).get(id);
  if (!(item instanceof Y.Map) || !readItem(id, item)) return 'missing';
  let text: string | undefined;
  let bytes = 0;
  if (patch.text !== undefined) {
    text = cleanContextText(patch.text);
    if (text.trim().length === 0) return 'empty';
    bytes = utf8Bytes(text);
    if (bytes > CONTEXT_MAX_BYTES) return 'too-large';
  }
  doc.transact(() => {
    let changed = false;
    if (patch.title !== undefined) {
      const title = cleanContextTitle(patch.title);
      if (title !== item.get('title')) {
        item.set('title', title);
        changed = true;
      }
    }
    if (text !== undefined && text !== item.get('text')) {
      item.set('text', text);
      item.set('bytes', bytes);
      changed = true;
    }
    if (changed) item.set('updatedAt', at);
  });
  return 'ok';
}

export function removeContextItem(doc: Y.Doc, id: string): boolean {
  const map = contextMap(doc);
  if (!map.has(id)) return false;
  map.delete(id);
  return true;
}

/** The room line: an optional system line that everyone can see and edit ('' = none). */
export function readSystemLine(doc: Y.Doc): string {
  const v = doc.getMap('settings').get('systemLine');
  return typeof v === 'string' ? v.slice(0, SYSTEM_LINE_MAX) : '';
}

export function setSystemLine(doc: Y.Doc, line: string, by: string): void {
  const clean = line.replace(/\r\n?/gu, '\n').trim().slice(0, SYSTEM_LINE_MAX).trim();
  if (clean === readSystemLine(doc)) return;
  const settings = doc.getMap('settings');
  doc.transact(() => {
    settings.set('systemLine', clean);
    settings.set('systemLineBy', by);
  });
}

export function systemLineBy(doc: Y.Doc): string | null {
  const by = doc.getMap('settings').get('systemLineBy');
  return typeof by === 'string' ? by.slice(0, 64) : null;
}
