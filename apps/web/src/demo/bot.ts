import {
  MAIN_BRANCH,
  addContextItem,
  createBranch,
  draftFragment,
  listContext,
  listTurns,
  randomId,
  readLock,
  setContextIncluded,
  turnsOnPath,
  type ContextKind,
} from '@promptalong/core';
import type { Provider } from '@promptalong/providers';
import * as Y from 'yjs';
import { sendPrompt } from '../room/send';
import type { RoomSession } from '../room/session';

/** The letters of a text node, without formatting. */
function plainOf(text: Y.XmlText): string {
  const delta = text.toDelta() as { insert?: unknown }[]; // Yjs types the delta loosely
  return delta.map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');
}

export type Where = 'end' | { before: string } | { after: string };

/** Waits `ms`, or rejects at once when the demo is stopped (Replay, leaving the page). */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Stopped', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(new DOMException('Stopped', 'AbortError'));
    };
    signal.addEventListener('abort', stop, { once: true });
  });
}

export interface BotTiming {
  /** milliseconds per typed letter (words appear whole when `wholeWords` is on) */
  letterMs: number;
  /** type a word at a time (prefers-reduced-motion) */
  wholeWords: boolean;
  /** the model the scripted people press Send with (null = the room's model) */
  provider: Provider | null;
}

/**
 * One scripted teammate. It is a real participant: its own room document, awareness and sync over
 * the in-page channel, so everything it does reaches the visitor the way a person's edits would.
 */
export class DemoBot {
  private cursor: Y.RelativePosition | null = null;

  constructor(
    readonly session: RoomSession,
    private readonly timing: BotTiming,
  ) {}

  get pid(): string {
    return this.session.pid;
  }

  /** The text node of the prompt's first paragraph (the one shared text node, see initRoom). */
  private textNode(): Y.XmlText | null {
    const paragraph = draftFragment(this.session.doc, MAIN_BRANCH).get(0);
    if (!(paragraph instanceof Y.XmlElement)) return null;
    const text = paragraph.get(0);
    return text instanceof Y.XmlText ? text : null;
  }

  private indexOf(where: Where, text: Y.XmlText): number {
    const plain = plainOf(text);
    if (where === 'end') return plain.length;
    if ('before' in where) {
      const at = plain.lastIndexOf(where.before);
      return at < 0 ? plain.length : at;
    }
    const at = plain.lastIndexOf(where.after);
    return at < 0 ? plain.length : at + where.after.length;
  }

  private cursorIndex(text: Y.XmlText): number {
    if (!this.cursor) return text.length;
    const abs = Y.createAbsolutePositionFromRelativePosition(this.cursor, this.session.doc);
    return abs?.type === text ? Math.min(abs.index, text.length) : text.length;
  }

  /** Shows this person's caret (or selection) to everyone, like the editor does. */
  private showCursor(text: Y.XmlText, anchor: number, head = anchor): void {
    const rel = (i: number): unknown =>
      Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, i));
    this.session.awareness.setLocalStateField('cursor', { anchor: rel(anchor), head: rel(head) });
  }

  hideCursor(): void {
    this.session.awareness.setLocalStateField('cursor', null);
    this.session.setActivity('idle');
  }

  /** Types `words` at `where`, a letter (or a word) at a time, marked as this person's text. */
  async type(words: string, where: Where, signal: AbortSignal): Promise<void> {
    const start = this.textNode();
    if (!start) return;
    this.cursor = Y.createRelativePositionFromTypeIndex(start, this.indexOf(where, start), -1);
    const pieces = this.timing.wholeWords ? (words.match(/\s*\S+/gu) ?? []) : Array.from(words);
    for (const [n, piece] of pieces.entries()) {
      const text = this.textNode();
      if (!text) return;
      const at = this.cursorIndex(text);
      this.session.doc.transact(() => {
        text.insert(at, piece, { author: { uid: this.pid } });
      });
      this.cursor = Y.createRelativePositionFromTypeIndex(text, at + piece.length, -1);
      this.showCursor(text, at + piece.length);
      this.session.setActivity('typing');
      // a little uneven, like real typing (the same every run)
      const jitter = ((n * 37) % 11) - 5;
      const ms = this.timing.wholeWords
        ? this.timing.letterMs * 5
        : this.timing.letterMs + jitter * 4;
      await pause(Math.max(8, ms), signal);
    }
  }

  /** Waits until this person's copy of the prompt holds `piece` (someone else's typing arrived). */
  async sees(piece: string, signal: AbortSignal): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const text = this.textNode();
      if (text && plainOf(text).includes(piece)) return;
      await pause(40, signal);
    }
  }

  /** Selects a piece of the prompt for a moment ("selecting" in the people list). */
  select(piece: string): void {
    const text = this.textNode();
    if (!text) return;
    const plain = plainOf(text);
    const at = plain.lastIndexOf(piece);
    if (at < 0) return;
    this.showCursor(text, at, at + piece.length);
    this.session.setActivity('selecting');
  }

  addContext(item: { title: string; kind: ContextKind; text: string }): string {
    const id = randomId();
    addContextItem(this.session.doc, {
      id,
      ownerUid: this.pid,
      kind: item.kind,
      title: item.title,
      text: item.text,
      createdAt: Date.now(),
    });
    return id;
  }

  exclude(title: string): void {
    const item = listContext(this.session.doc).find((i) => i.title === title);
    if (item) setContextIncluded(this.session.doc, item.id, false, this.pid);
  }

  /** A branch from the n-th turn on main (1 = the first). */
  branch(name: string, fromTurn: number): void {
    const from = turnsOnPath(this.session.doc, MAIN_BRANCH)[fromTurn - 1];
    if (!from) return;
    createBranch(this.session.doc, {
      id: randomId(),
      name,
      fromTurnId: from.id,
      sourceBranch: MAIN_BRANCH,
      by: this.pid,
      at: Date.now(),
    });
  }

  /**
   * Presses Send (the prompt is frozen and cleared before this returns). If someone else is
   * sending - the visitor may press Send at any moment - it waits for them and tries again.
   */
  async send(signal: AbortSignal): Promise<string | null> {
    this.hideCursor();
    for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
      const res = await sendPrompt(
        this.session,
        undefined,
        undefined,
        this.timing.provider ?? undefined,
      );
      if (res.ok) return res.turnId;
      if (res.reason !== 'busy' && res.reason !== 'lost') return null;
      while (readLock(this.session.doc)) await pause(150, signal);
    }
    return null;
  }

  /** Waits until a turn's answer has finished streaming. */
  async waitFor(turnId: string, signal: AbortSignal): Promise<void> {
    for (;;) {
      const turn = listTurns(this.session.doc).find((t) => t.id === turnId);
      if (turn?.status !== 'streaming') return;
      await pause(100, signal);
    }
  }

  async sendAndWait(signal: AbortSignal): Promise<void> {
    const turnId = await this.send(signal);
    if (turnId) await this.waitFor(turnId, signal);
  }
}
