import type * as Y from 'yjs';
import { historyEntries } from '../history/history';
import { fragmentWithSpans, trimWithSpans, type Span } from '../provenance/spans';
import { promptFragment, peopleMap } from '../room/doc';
import {
  listContextWithText,
  readSystemLine,
  type ContextItemView,
  type ContextKind,
} from './context';

/**
 * The one place a request is put together (ADR-005, "Honest context"). The context panel and Send
 * both call this, so what the panel shows is what is sent:
 *   1. one leading system message: the room line (if any), then every included context item in
 *      creation order, each as "[context: {title} · {owner}]\n{text}", separated by a blank line
 *   2. the conversation so far (prompt + answer of every finished turn)
 *   3. the prompt
 * Nothing else is added. With no room line and no included item there is no system message.
 */
export interface AssembledMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type SegmentKind = 'system' | 'context' | 'history' | 'prompt';

/** One source's share of the request, for the readable view and the per-source token counts. */
export interface Segment {
  kind: SegmentKind;
  role: AssembledMessage['role'];
  /** the text this source contributes, exactly as it appears inside its message */
  text: string;
  /** index of its message in `messages` */
  message: number;
  itemId?: string;
  ownerUid?: string;
  title?: string;
  turnId?: string;
}

export interface AssembleItem {
  id: string;
  ownerUid: string;
  kind: ContextKind;
  title: string;
  text: string;
  included: boolean;
  bytes: number;
}

export interface AssembleInput {
  systemLine: string;
  items: readonly AssembleItem[];
  ownerName: (uid: string) => string;
  history: readonly { turnId: string; prompt: string; answer: string }[];
  prompt: string;
}

export interface AssembledItem {
  itemId: string;
  ownerUid: string;
  ownerName: string;
  kind: ContextKind;
  title: string;
  bytes: number;
  /** the wrapped block as sent: "[context: title · owner]\ntext" */
  block: string;
  /** the item's own text (hashed into the turn record) */
  text: string;
}

export interface Assembled {
  messages: AssembledMessage[];
  segments: Segment[];
  /** the included items, in the order they are sent */
  items: AssembledItem[];
  systemLine: string;
}

export const CONTEXT_SEPARATOR = '\n\n';

export function contextBlock(title: string, owner: string, text: string): string {
  return `[context: ${title} · ${owner}]\n${text}`;
}

export function assemble(input: AssembleInput): Assembled {
  const messages: AssembledMessage[] = [];
  const segments: Segment[] = [];
  const items: AssembledItem[] = [];
  const parts: string[] = [];
  const systemLine = input.systemLine.trim();

  if (systemLine) {
    parts.push(systemLine);
    segments.push({ kind: 'system', role: 'system', text: systemLine, message: 0 });
  }
  for (const item of input.items) {
    if (!item.included) continue;
    const ownerName = input.ownerName(item.ownerUid);
    const block = contextBlock(item.title, ownerName, item.text);
    parts.push(block);
    segments.push({
      kind: 'context',
      role: 'system',
      text: block,
      message: 0,
      itemId: item.id,
      ownerUid: item.ownerUid,
      title: item.title,
    });
    items.push({
      itemId: item.id,
      ownerUid: item.ownerUid,
      ownerName,
      kind: item.kind,
      title: item.title,
      bytes: item.bytes,
      block,
      text: item.text,
    });
  }
  if (parts.length > 0) messages.push({ role: 'system', content: parts.join(CONTEXT_SEPARATOR) });

  for (const turn of input.history) {
    segments.push({
      kind: 'history',
      role: 'user',
      text: turn.prompt,
      message: messages.length,
      turnId: turn.turnId,
    });
    messages.push({ role: 'user', content: turn.prompt });
    segments.push({
      kind: 'history',
      role: 'assistant',
      text: turn.answer,
      message: messages.length,
      turnId: turn.turnId,
    });
    messages.push({ role: 'assistant', content: turn.answer });
  }

  segments.push({ kind: 'prompt', role: 'user', text: input.prompt, message: messages.length });
  messages.push({ role: 'user', content: input.prompt });
  return { messages, segments, items, systemLine };
}

/** The draft prompt as Send freezes it: trimmed, with its author spans. */
export function draftPrompt(doc: Y.Doc): { text: string; spans: Span[] } {
  const draft = fragmentWithSpans(promptFragment(doc));
  return trimWithSpans(draft.text, draft.spans);
}

/**
 * The name written into a context block. It is read from the room document only (the people
 * list), so every device builds the same bytes.
 */
export function contextOwnerName(doc: Y.Doc, uid: string): string {
  const person = peopleMap(doc).get(uid) as { name?: unknown } | undefined;
  if (typeof person?.name === 'string' && person.name) return person.name.slice(0, 24);
  return 'someone';
}

/** The session's switch for one of the room's context items (room items are on by default). */
export const ROOM_CONTEXT_OFF = 'roomContextOff';

export function isRoomItemIncluded(session: Y.Doc, itemId: string): boolean {
  return session.getMap<boolean>(ROOM_CONTEXT_OFF).get(itemId) !== true;
}

export function setRoomItemIncluded(session: Y.Doc, itemId: string, included: boolean): void {
  const off = session.getMap<boolean>(ROOM_CONTEXT_OFF);
  if (included) off.delete(itemId);
  else off.set(itemId, true);
}

/**
 * Assembles the request (prompt = the shared draft unless given). With `room`, the document is a
 * session of that room: the room's instructions and context items come first (each switched on or
 * off for this session alone), then the session's own instructions and items. Names come from the
 * room's people list, so every device builds the same bytes.
 */
export type ScopedContextItem = ContextItemView & { text: string; scope: 'room' | 'session' };

/**
 * The context items a session sends, in order: the room's items (each on unless this session
 * switched it off), then the session's own. Send and the context panel both read this list.
 */
export function sessionContextItems(doc: Y.Doc, room: Y.Doc | null = null): ScopedContextItem[] {
  const own = listContextWithText(doc).map((i) => ({ ...i, scope: 'session' as const }));
  if (!room) return own;
  return [
    ...listContextWithText(room).map((i) => ({
      ...i,
      included: isRoomItemIncluded(doc, i.id),
      scope: 'room' as const,
    })),
    ...own,
  ];
}

export function assembleRoom(
  doc: Y.Doc,
  options: { prompt?: string; room?: Y.Doc | null } = {},
): Assembled {
  const room = options.room ?? null;
  const people = room ?? doc;
  const lines = room ? [readSystemLine(room), readSystemLine(doc)] : [readSystemLine(doc)];
  const items = sessionContextItems(doc, room);
  return assemble({
    systemLine: lines
      .map((l) => l.trim())
      .filter(Boolean)
      .join(CONTEXT_SEPARATOR),
    items,
    ownerName: (uid) => contextOwnerName(people, uid),
    history: historyEntries(doc),
    prompt: options.prompt ?? draftPrompt(doc).text,
  });
}
