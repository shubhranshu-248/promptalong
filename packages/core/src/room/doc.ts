import * as Y from 'yjs';

/** Names of the shared types in a room document (ADR-002). */
export const FIELD = {
  prompt: 'prompt',
  settings: 'settings',
  people: 'people',
} as const;

export type SendPolicy = 'everyone' | 'host';

export interface RoomSettings {
  name: string;
  sendPolicy: SendPolicy;
  hostPid: string;
  createdAt: number;
}

export interface PersonRecord {
  name: string;
  slot: number;
  joinedAt: number;
}

export const DEFAULT_ROOM_NAME = 'Untitled room';
export const ROOM_NAME_MAX = 60;

export function promptFragment(doc: Y.Doc): Y.XmlFragment {
  return doc.getXmlFragment(FIELD.prompt);
}

/** The line every turn belongs to (turns keep the field for older rooms). */
export const MAIN_BRANCH = 'main';

function settingsMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(FIELD.settings);
}

export function peopleMap(doc: Y.Doc): Y.Map<PersonRecord> {
  return doc.getMap<PersonRecord>(FIELD.people);
}

export function cleanRoomName(input: string): string {
  const name = input.replace(/\s+/gu, ' ').trim().slice(0, ROOM_NAME_MAX).trim();
  return name.length > 0 ? name : DEFAULT_ROOM_NAME;
}

/**
 * Writes the room settings once, when the room is created. Later calls are ignored, so a second
 * "creator" can never overwrite an existing room.
 */
export function initRoom(doc: Y.Doc, settings: RoomSettings): boolean {
  const map = settingsMap(doc);
  if (map.has('createdAt')) return false;
  doc.transact(() => {
    map.set('name', cleanRoomName(settings.name));
    map.set('sendPolicy', settings.sendPolicy);
    map.set('hostPid', settings.hostPid);
    map.set('createdAt', settings.createdAt);
    // One empty paragraph holding one empty text node, written once by the creator. If each editor
    // created its own first paragraph or text node, people who start typing at the same moment
    // would get separate paragraphs, or duplicated letters when the editor merges the text nodes.
    const prompt = promptFragment(doc);
    if (prompt.length === 0) {
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText()]);
      prompt.insert(0, [paragraph]);
    }
  });
  return true;
}

/**
 * Prepares a session document: its shared prompt gets its one empty paragraph (written once, by
 * whoever creates the session - see initRoom for why) and the time it was made. False when it was
 * prepared before.
 */
export function initSession(doc: Y.Doc, createdAt: number): boolean {
  const meta = doc.getMap<unknown>('meta');
  if (meta.has('createdAt') || promptFragment(doc).length > 0) return false;
  doc.transact(() => {
    meta.set('createdAt', createdAt);
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText()]);
    promptFragment(doc).insert(0, [paragraph]);
  });
  return true;
}

/** True once the session document has its prompt (made by its creator, or loaded). */
export function isSessionReady(doc: Y.Doc): boolean {
  return promptFragment(doc).length > 0;
}

/** The room settings, or null while they have not arrived yet. */
export function readSettings(doc: Y.Doc): RoomSettings | null {
  const map = settingsMap(doc);
  const name = map.get('name');
  const sendPolicy = map.get('sendPolicy');
  const hostPid = map.get('hostPid');
  const createdAt = map.get('createdAt');
  if (
    typeof name !== 'string' ||
    (sendPolicy !== 'everyone' && sendPolicy !== 'host') ||
    typeof hostPid !== 'string' ||
    typeof createdAt !== 'number'
  ) {
    return null;
  }
  return { name, sendPolicy, hostPid, createdAt };
}

/** Records (or updates) a person in the room's people list. */
export function upsertPerson(doc: Y.Doc, pid: string, person: PersonRecord): void {
  const map = peopleMap(doc);
  const current = map.get(pid);
  if (
    current?.name === person.name &&
    current.slot === person.slot &&
    current.joinedAt === person.joinedAt
  ) {
    return;
  }
  map.set(pid, person);
}

/** Plain text of a prompt draft (paragraphs joined by new lines). */
export function promptText(doc: Y.Doc): string {
  return promptFragment(doc)
    .toArray()
    .map((node) => (node instanceof Y.XmlElement || node instanceof Y.XmlText ? xmlText(node) : ''))
    .join('\n');
}

function xmlText(node: Y.XmlElement | Y.XmlText): string {
  if (node instanceof Y.XmlText) {
    const delta = node.toDelta() as { insert?: unknown }[]; // Yjs types the delta loosely
    return delta.map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');
  }
  if (node.nodeName === 'hardBreak') return '\n';
  return node
    .toArray()
    .map((child) =>
      child instanceof Y.XmlElement || child instanceof Y.XmlText ? xmlText(child) : '',
    )
    .join('');
}

/**
 * Empties the shared prompt after Send. The first paragraph and its one text node are kept (only
 * their text is deleted), so letters someone is typing at this moment are never lost and the next
 * prompt starts from the same shared text node (see initRoom).
 */
export function clearPrompt(doc: Y.Doc): void {
  const prompt = promptFragment(doc);
  doc.transact(() => {
    const first = prompt.get(0);
    if (first instanceof Y.XmlElement && first.nodeName === 'paragraph') {
      if (prompt.length > 1) prompt.delete(1, prompt.length - 1);
      const text = first.get(0);
      if (first.length > 1) first.delete(1, first.length - 1);
      if (text instanceof Y.XmlText) {
        if (text.length > 0) text.delete(0, text.length);
      } else {
        if (first.length > 0) first.delete(0, first.length);
        first.insert(0, [new Y.XmlText()]);
      }
    } else {
      if (prompt.length > 0) prompt.delete(0, prompt.length);
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText()]);
      prompt.insert(0, [paragraph]);
    }
  });
}

/** The room's model choice as stored (validated by the providers package when read). */
export function readRoomModel(doc: Y.Doc): unknown {
  return settingsMap(doc).get('model');
}

/** Sets the room's model: kind, model, endpoint and who picked it. Never a key. */
export function setRoomModel(
  doc: Y.Doc,
  choice: { kind: string; model: string; endpoint?: string; setBy?: string },
): void {
  const clean: Record<string, string> = { kind: choice.kind, model: choice.model };
  if (choice.endpoint) clean.endpoint = choice.endpoint;
  if (choice.setBy) clean.setBy = choice.setBy;
  settingsMap(doc).set('model', clean);
}
