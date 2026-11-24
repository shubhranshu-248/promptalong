import * as Y from 'yjs';

/**
 * Prompt provenance (U2, ADR-004): every piece of prompt text carries the participant id of the
 * person who typed it. In the editor that is a ProseMirror mark `author {uid}`; in Yjs it is the
 * text formatting attribute `author: {uid}` (y-prosemirror stores marks that way).
 */
export interface Span {
  from: number;
  to: number;
  uid: string;
}

export interface Para {
  text: string;
  /** offsets inside this paragraph */
  spans: Span[];
}

const AUTHOR = 'author';

function uidOf(attrs: unknown): string {
  if (typeof attrs !== 'object' || attrs === null) return '';
  const mark = (attrs as Record<string, unknown>)[AUTHOR];
  if (typeof mark !== 'object' || mark === null) return '';
  const uid = (mark as Record<string, unknown>).uid;
  return typeof uid === 'string' ? uid.slice(0, 64) : '';
}

function addSpan(spans: Span[], from: number, to: number, uid: string): void {
  if (!uid || to <= from) return;
  const last = spans.at(-1);
  if (last?.uid === uid && last.to === from) last.to = to;
  else spans.push({ from, to, uid });
}

function readInto(node: Y.XmlElement | Y.XmlText, para: Para): void {
  if (node instanceof Y.XmlText) {
    const delta = node.toDelta() as { insert?: unknown; attributes?: unknown }[];
    for (const op of delta) {
      if (typeof op.insert !== 'string') continue;
      const from = para.text.length;
      para.text += op.insert;
      addSpan(para.spans, from, para.text.length, uidOf(op.attributes));
    }
    return;
  }
  if (node.nodeName === 'hardBreak') {
    para.text += '\n';
    return;
  }
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlElement || child instanceof Y.XmlText) readInto(child, para);
  }
}

/** The paragraphs of a prompt fragment, each with its author spans. */
export function readParagraphs(fragment: Y.XmlFragment): Para[] {
  return fragment.toArray().map((node) => {
    const para: Para = { text: '', spans: [] };
    if (node instanceof Y.XmlElement || node instanceof Y.XmlText) readInto(node, para);
    return para;
  });
}

/** Paragraphs joined by new lines, with spans moved to whole-text offsets. */
export function joinParagraphs(paras: readonly Para[]): { text: string; spans: Span[] } {
  let text = '';
  const spans: Span[] = [];
  paras.forEach((p, i) => {
    if (i > 0) text += '\n';
    const base = text.length;
    for (const s of p.spans) addSpan(spans, base + s.from, base + s.to, s.uid);
    text += p.text;
  });
  return { text, spans };
}

/** Text + spans of a whole fragment (what Send freezes into a turn). */
export function fragmentWithSpans(fragment: Y.XmlFragment): { text: string; spans: Span[] } {
  return joinParagraphs(readParagraphs(fragment));
}

/** Splits a frozen prompt (text + spans) back into paragraphs. */
export function splitParagraphs(text: string, spans: readonly Span[]): Para[] {
  const out: Para[] = [];
  let start = 0;
  for (const line of text.split('\n')) {
    const end = start + line.length;
    const para: Para = { text: line, spans: [] };
    for (const s of spans) {
      const from = Math.max(s.from, start);
      const to = Math.min(s.to, end);
      if (to > from) addSpan(para.spans, from - start, to - start, s.uid);
    }
    out.push(para);
    start = end + 1;
  }
  return out;
}

/** Trims a prompt's text and moves its spans with it. */
export function trimWithSpans(
  text: string,
  spans: readonly Span[],
): { text: string; spans: Span[] } {
  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();
  const out: Span[] = [];
  for (const s of spans)
    addSpan(out, Math.max(0, s.from - lead), Math.min(trimmed.length, s.to - lead), s.uid);
  return { text: trimmed, spans: out };
}

/** The author of each character range: who wrote position `at` (empty = unknown). */
export function authorAt(spans: readonly Span[], at: number): string {
  for (const s of spans) if (at >= s.from && at < s.to) return s.uid;
  return '';
}

/** Builds a paragraph element holding ONE text node (see initRoom), keeping author attributes. */
export function paragraphElement(para: Para): Y.XmlElement {
  const el = new Y.XmlElement('paragraph');
  const text = new Y.XmlText();
  el.insert(0, [text]);
  // Yjs types must be integrated before formatting inserts are applied: fill after insertion.
  queueFill.set(text, para);
  return el;
}

const queueFill = new WeakMap<Y.XmlText, Para>();

/** Writes the queued text of paragraphs created with paragraphElement (call after inserting them). */
export function fillParagraphs(elements: readonly Y.XmlElement[]): void {
  for (const el of elements) {
    const text = el.get(0);
    if (!(text instanceof Y.XmlText)) continue;
    const para = queueFill.get(text);
    if (!para) continue;
    queueFill.delete(text);
    let at = 0;
    const cuts = new Set<number>([0, para.text.length]);
    for (const s of para.spans) {
      cuts.add(s.from);
      cuts.add(s.to);
    }
    const points = [...cuts].filter((c) => c >= 0 && c <= para.text.length).sort((x, y) => x - y);
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i] ?? 0;
      const to = points[i + 1] ?? from;
      const piece = para.text.slice(from, to);
      const uid = authorAt(para.spans, from);
      text.insert(at, piece, uid ? { [AUTHOR]: { uid } } : {});
      at += piece.length;
    }
  }
}

/** Replaces everything in a fragment with these paragraphs (used for new branch drafts / forks). */
export function writeFragment(fragment: Y.XmlFragment, paras: readonly Para[]): void {
  const doc = fragment.doc;
  const run = () => {
    if (fragment.length > 0) fragment.delete(0, fragment.length);
    const list = paras.length > 0 ? paras : [{ text: '', spans: [] }];
    const els = list.map(paragraphElement);
    fragment.insert(0, els);
    fillParagraphs(els);
  };
  if (doc) doc.transact(run);
  else run();
}
