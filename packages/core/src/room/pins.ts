import * as Y from 'yjs';

/**
 * Pins: answers someone kept for the whole room. A pin holds a copy of the prompt and the answer,
 * because a session is private and a pin is meant for everyone in the room: pinning is sharing.
 */
export const PINS_MAX = 50;
export const PIN_PROMPT_MAX = 600;
export const PIN_ANSWER_MAX = 20_000;

export interface PinView {
  id: string;
  sessionId: string;
  sessionName: string;
  turnId: string;
  /** the turn's label in its session ("T3") */
  label: string;
  prompt: string;
  answer: string;
  /** true when the answer was longer than a pin keeps */
  clipped: boolean;
  by: string;
  byName: string;
  at: number;
}

export type NewPin = Omit<PinView, 'id' | 'clipped'>;

function pinsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('pins');
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The pin of one turn, if it is pinned. */
export function pinOf(doc: Y.Doc, sessionId: string, turnId: string): PinView | null {
  return listPins(doc).find((p) => p.sessionId === sessionId && p.turnId === turnId) ?? null;
}

/** Pins a turn's answer for the room ('pinned': it is already; 'full': the room has 50). */
export function addPin(doc: Y.Doc, pin: NewPin): 'ok' | 'pinned' | 'full' {
  if (pinOf(doc, pin.sessionId, pin.turnId)) return 'pinned';
  const map = pinsMap(doc);
  if (map.size >= PINS_MAX) return 'full';
  const id = `${pin.sessionId}:${pin.turnId}`.slice(0, 140);
  const entry = new Y.Map<unknown>();
  doc.transact(() => {
    map.set(id, entry);
    entry.set('sessionId', pin.sessionId.slice(0, 64));
    entry.set('sessionName', pin.sessionName.slice(0, 40));
    entry.set('turnId', pin.turnId.slice(0, 64));
    entry.set('label', pin.label.slice(0, 8));
    entry.set('prompt', pin.prompt.slice(0, PIN_PROMPT_MAX));
    entry.set('answer', pin.answer.slice(0, PIN_ANSWER_MAX));
    entry.set('clipped', pin.answer.length > PIN_ANSWER_MAX);
    entry.set('by', pin.by.slice(0, 64));
    entry.set('byName', pin.byName.slice(0, 24));
    entry.set('at', pin.at);
  });
  return 'ok';
}

export function removePin(doc: Y.Doc, id: string): void {
  pinsMap(doc).delete(id);
}

/** Every pin, newest first. Anything malformed (it comes from the network) is left out. */
export function listPins(doc: Y.Doc): PinView[] {
  const out: PinView[] = [];
  pinsMap(doc).forEach((m, id) => {
    if (!(m instanceof Y.Map)) return;
    const at = m.get('at');
    const sessionId = str(m.get('sessionId'), 64);
    const turnId = str(m.get('turnId'), 64);
    if (typeof at !== 'number' || !sessionId || !turnId) return;
    out.push({
      id,
      sessionId,
      sessionName: str(m.get('sessionName'), 40),
      turnId,
      label: str(m.get('label'), 8),
      prompt: str(m.get('prompt'), PIN_PROMPT_MAX),
      answer: str(m.get('answer'), PIN_ANSWER_MAX),
      clipped: m.get('clipped') === true,
      by: str(m.get('by'), 64),
      byName: str(m.get('byName'), 24),
      at,
    });
  });
  return out.sort((a, b) => b.at - a.at);
}
