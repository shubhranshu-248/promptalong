import type * as Y from 'yjs';
import { historyMessages, tipOf } from '../branches/branches';
import { fragmentWithSpans, trimWithSpans, type Span } from '../provenance/spans';
import { MAIN_BRANCH, clearPrompt, draftFragment } from '../room/doc';
import {
  LOCK_FIELD,
  addTurn,
  sha256Hex,
  turnsMap,
  type TurnError,
  type TurnProvider,
} from './turns';

/**
 * One shared stream per room (ADR-003; ADR-002 P3 addendum).
 *
 * - Send lock: a `lock` entry {pid, session, turnId, beat} written by the sender, with a heartbeat
 *   every 2 s. Everyone else treats it as gone after 10 s without a heartbeat change (measured on
 *   their own clock, so clock skew does not matter) and marks the turn interrupted.
 * - Claim window: when others are online the sender waits ~300 ms after writing the lock and only
 *   calls the model if the lock is still theirs, so two Sends at the same instant never both call a
 *   model (Yjs resolves concurrent writes to the same key the same way on every device).
 * - The answer streams into the turn's Y.Text in 150 ms batches: everyone renders the same text,
 *   and late joiners or reloads get the answer so far through normal sync.
 * - Stop: anyone writes `stopRequestedBy` on the turn; the sender's browser aborts the model call.
 */
export interface LockHolder {
  pid: string;
  session: string;
  name: string;
  turnId: string | null;
  beat: number;
}

export interface StreamChunkLike {
  text: string;
  done?: boolean;
  usage?: { input: number; output: number };
}

export interface SendRequest {
  promptText: string;
  /** author spans of promptText (Retry); a normal Send reads them from the draft */
  spans?: Span[];
  /** the branch the turn belongs to (default main) */
  branchId?: string;
  provider: TurnProvider;
  /** builds the exact body from the messages (shown by the panel, posted by Send) */
  buildBody: (messages: { role: 'user' | 'assistant' | 'system'; content: string }[]) => string;
  stream: (body: string, signal: AbortSignal) => AsyncIterable<StreamChunkLike>;
  /** clear the shared prompt when the turn starts (normal Send) - false for Retry */
  clearPrompt: boolean;
  /** turns a thrown error into something safe to show to everyone */
  describeError: (error: unknown) => TurnError;
}

export type SendResult =
  | { ok: true; turnId: string }
  | { ok: false; reason: 'busy' | 'lost' | 'empty' | 'not-allowed'; holder?: LockHolder };

export interface CoordinatorOptions {
  pid: string;
  session: string;
  name: () => string;
  /** people online besides me */
  peers: () => number;
  /** true while synced with the room (staleness is only judged when online) */
  online: () => boolean;
  now?: () => number;
  claimMs?: number;
  beatMs?: number;
  staleMs?: number;
  flushMs?: number;
  checkMs?: number;
  newId?: () => string;
}

function lockMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(LOCK_FIELD);
}

export function readLock(doc: Y.Doc): LockHolder | null {
  const v = lockMap(doc).get('current') as Record<string, unknown> | undefined;
  if (typeof v !== 'object') return null;
  if (typeof v.pid !== 'string' || typeof v.session !== 'string') return null;
  return {
    pid: v.pid.slice(0, 64),
    session: v.session.slice(0, 64),
    name: typeof v.name === 'string' ? v.name.slice(0, 24) : '',
    turnId: typeof v.turnId === 'string' ? v.turnId.slice(0, 64) : null,
    beat: typeof v.beat === 'number' ? v.beat : 0,
  };
}

const wait = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });

export class StreamCoordinator {
  readonly doc: Y.Doc;
  private readonly o: Required<CoordinatorOptions>;
  private active: { turnId: string; ctrl: AbortController; reason: 'stop' | 'left' | null } | null =
    null;
  private beatTimer: ReturnType<typeof setInterval> | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private lastBeat: { key: string; seenAt: number } | null = null;
  private destroyed = false;

  constructor(doc: Y.Doc, options: CoordinatorOptions) {
    this.doc = doc;
    this.o = {
      now: Date.now,
      claimMs: 300,
      beatMs: 2000,
      staleMs: 10_000,
      flushMs: 150,
      checkMs: 1000,
      newId: () => crypto.randomUUID(),
      ...options,
    };
    lockMap(doc).observe(this.onLock);
    this.onLock();
    this.checkTimer = setInterval(() => {
      this.checkStale();
    }, this.o.checkMs);
  }

  private isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Who holds Send right now (null = free). */
  holder(): LockHolder | null {
    return readLock(this.doc);
  }

  isSending(): boolean {
    return this.active !== null;
  }

  async send(req: SendRequest): Promise<SendResult> {
    if (this.destroyed || this.active) return { ok: false, reason: 'busy' };
    if (req.promptText.trim().length === 0) return { ok: false, reason: 'empty' };
    const held = readLock(this.doc);
    if (held && held.session !== this.o.session) return { ok: false, reason: 'busy', holder: held };

    const turnId = this.o.newId();
    const claim: LockHolder = {
      pid: this.o.pid,
      session: this.o.session,
      name: this.o.name(),
      turnId: null,
      beat: 0,
    };
    lockMap(this.doc).set('current', claim);
    // Reserve now so a second click during the claim window is ignored.
    const ctrl = new AbortController();
    this.active = { turnId, ctrl, reason: null };

    if (this.o.peers() > 0 && this.o.claimMs > 0) await wait(this.o.claimMs);
    const after = readLock(this.doc);
    // (read through a method: the page may have closed during the wait)
    if (this.isDestroyed() || after?.session !== this.o.session) {
      this.active = null;
      return after ? { ok: false, reason: 'lost', holder: after } : { ok: false, reason: 'lost' };
    }

    // A normal Send freezes the prompt as it is now, not as it was at the click: letters a
    // co-writer typed during the claim window belong to this turn. Reading, adding the turn and
    // clearing run with no await in between, so nothing can arrive that is cleared but not sent.
    const branchId = req.branchId ?? MAIN_BRANCH;
    let fromDraft: { text: string; spans: Span[] } | null = null;
    if (req.clearPrompt) {
      const draft = fragmentWithSpans(draftFragment(this.doc, branchId));
      fromDraft = trimWithSpans(draft.text, draft.spans);
    }
    const sent = fromDraft?.text ? fromDraft : { text: req.promptText, spans: req.spans ?? [] };
    const messages = [
      ...historyMessages(this.doc, branchId),
      { role: 'user' as const, content: sent.text },
    ];
    const body = req.buildBody(messages);
    const started = this.o.now();
    let answer!: Y.Text;
    this.doc.transact(() => {
      answer = addTurn(this.doc, {
        id: turnId,
        branchId,
        parentId: tipOf(this.doc, branchId),
        createdAt: started,
        sentBy: this.o.pid,
        senderName: this.o.name(),
        promptText: sent.text,
        spans: sent.spans,
        provider: req.provider,
        requestHash: '',
      });
      lockMap(this.doc).set('current', { ...claim, turnId, beat: 1 });
      if (req.clearPrompt) clearPrompt(this.doc, branchId);
    });
    const requestHash = await sha256Hex(body);
    if (this.isDestroyed()) {
      this.active = null;
      return { ok: false, reason: 'lost' };
    }
    turnsMap(this.doc).get(turnId)?.set('requestHash', requestHash);
    this.beat();
    const turn = turnsMap(this.doc).get(turnId);
    const onTurn = () => {
      if (!turn || this.active?.turnId !== turnId) return;
      const stopBy = turn.get('stopRequestedBy');
      const status = turn.get('status');
      if ((typeof stopBy === 'string' || status !== 'streaming') && !ctrl.signal.aborted) {
        this.active.reason = 'stop';
        ctrl.abort();
      }
    };
    turn?.observe(onTurn);

    // Stream in the background; the caller gets the turn id at once.
    void this.run(turnId, answer, body, req, ctrl, started).finally(() => {
      turn?.unobserve(onTurn);
    });
    return { ok: true, turnId };
  }

  /** Anyone in the room can ask the sender to stop. */
  requestStop(turnId: string): void {
    const turn = turnsMap(this.doc).get(turnId);
    if (turn?.get('status') !== 'streaming' || turn.has('stopRequestedBy')) return;
    turn.set('stopRequestedBy', this.o.pid);
  }

  /** Called when this page goes away: an answer in progress is kept and marked interrupted. */
  destroy(): void {
    if (this.destroyed) return;
    if (this.active) {
      this.active.reason = 'left';
      this.active.ctrl.abort();
      this.finish(this.active.turnId, {
        status: 'interrupted',
        interruptedReason: 'left',
      });
    }
    this.destroyed = true;
    lockMap(this.doc).unobserve(this.onLock);
    if (this.beatTimer) clearInterval(this.beatTimer);
    if (this.checkTimer) clearInterval(this.checkTimer);
  }

  private async run(
    turnId: string,
    answer: Y.Text,
    body: string,
    req: SendRequest,
    ctrl: AbortController,
    started: number,
  ): Promise<void> {
    let buffer = '';
    let usage: StreamChunkLike['usage'];
    const flush = () => {
      if (buffer.length === 0 || this.destroyed) return;
      answer.insert(answer.length, buffer);
      buffer = '';
    };
    const flushTimer = setInterval(flush, this.o.flushMs);
    try {
      for await (const chunk of req.stream(body, ctrl.signal)) {
        if (ctrl.signal.aborted) break;
        buffer += chunk.text;
        if (chunk.usage) usage = chunk.usage;
        if (chunk.done) break;
      }
      clearInterval(flushTimer);
      if (ctrl.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      flush();
      this.finish(turnId, {
        status: 'done',
        durationMs: this.o.now() - started,
        ...(usage ? { usage } : {}),
      });
    } catch (error) {
      clearInterval(flushTimer);
      const reason = this.active?.reason;
      if (reason === 'left' || this.destroyed) return; // destroy() already recorded it
      flush();
      const turn = turnsMap(this.doc).get(turnId);
      if (ctrl.signal.aborted || reason === 'stop') {
        const by = turn?.get('stopRequestedBy');
        if (turn?.get('status') === 'streaming') {
          this.finish(turnId, {
            status: 'stopped',
            stoppedBy: typeof by === 'string' ? by : this.o.pid,
            durationMs: this.o.now() - started,
          });
        } else {
          this.finish(turnId, {}); // someone else already closed it (e.g. interrupted)
        }
      } else {
        this.finish(turnId, {
          status: 'failed',
          error: req.describeError(error),
          durationMs: this.o.now() - started,
        });
      }
    }
  }

  /** Writes the final fields and frees Send (only if the lock is still ours). */
  private finish(turnId: string, fields: Record<string, unknown>): void {
    if (this.active?.turnId === turnId) this.active = null;
    if (this.beatTimer) {
      clearInterval(this.beatTimer);
      this.beatTimer = null;
    }
    this.doc.transact(() => {
      const turn = turnsMap(this.doc).get(turnId);
      if (turn?.get('status') === 'streaming') {
        for (const [k, v] of Object.entries(fields)) turn.set(k, v);
      }
      const lock = readLock(this.doc);
      if (lock?.session === this.o.session) lockMap(this.doc).delete('current');
    });
  }

  private beat(): void {
    if (this.beatTimer) clearInterval(this.beatTimer);
    this.beatTimer = setInterval(() => {
      const lock = readLock(this.doc);
      if (!this.active || lock?.session !== this.o.session) return;
      lockMap(this.doc).set('current', { ...lock, beat: lock.beat + 1 });
    }, this.o.beatMs);
  }

  private readonly onLock = () => {
    const lock = readLock(this.doc);
    const key = lock ? `${lock.session}:${lock.turnId ?? ''}:${String(lock.beat)}` : '';
    if (key !== this.lastBeat?.key) this.lastBeat = { key, seenAt: this.o.now() };
  };

  /** Call when the connection comes back: heartbeats missed while offline do not count. */
  resetStaleClock(): void {
    if (this.lastBeat) this.lastBeat.seenAt = this.o.now();
  }

  private checkStale(): void {
    if (this.destroyed || !this.o.online()) return;
    const lock = readLock(this.doc);
    const now = this.o.now();
    if (lock && lock.session !== this.o.session) {
      if (this.lastBeat && now - this.lastBeat.seenAt > this.o.staleMs) {
        this.doc.transact(() => {
          if (lock.turnId) {
            const turn = turnsMap(this.doc).get(lock.turnId);
            if (turn?.get('status') === 'streaming') {
              turn.set('status', 'interrupted');
              turn.set('interruptedReason', 'lost');
            }
          }
          const again = readLock(this.doc);
          if (again?.session === lock.session && again.beat === lock.beat) {
            lockMap(this.doc).delete('current');
          }
        });
      }
      return;
    }
    if (lock) return; // mine
    // No lock: a turn still "streaming" (its sender vanished before the lock arrived) is stale.
    turnsMap(this.doc).forEach((turn, id) => {
      if (turn.get('status') !== 'streaming' || this.active?.turnId === id) return;
      const createdAt = turn.get('createdAt');
      if (typeof createdAt === 'number' && now - createdAt > this.o.staleMs * 3) {
        turn.set('status', 'interrupted');
        turn.set('interruptedReason', 'lost');
      }
    });
  }
}
