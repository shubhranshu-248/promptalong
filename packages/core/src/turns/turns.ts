import * as Y from 'yjs';

/**
 * Conversation turns (ADR-004 subset for P3: one linear "main" history; branches arrive in P4).
 * A turn is frozen at Send; afterwards only the answer, status, usage and stop fields change.
 */
export const TURNS_FIELD = 'turns';
export const LOCK_FIELD = 'lock';

export type TurnStatus = 'streaming' | 'done' | 'stopped' | 'failed' | 'interrupted';

export interface TurnProvider {
  kind: string;
  model: string;
  endpoint?: string;
  /** human label at send time, e.g. "Demo model" */
  label: string;
}

export interface TurnError {
  code: string;
  message: string;
  status?: number;
}

export interface TurnView {
  id: string;
  branchId: string;
  parentId: string | null;
  createdAt: number;
  sentBy: string;
  senderName: string;
  prompt: { text: string; spans: { from: number; to: number; uid: string }[] };
  provider: TurnProvider;
  requestHash: string;
  status: TurnStatus;
  answer: string;
  usage?: { input: number; output: number };
  durationMs?: number;
  error?: TurnError;
  stoppedBy?: string;
  stopRequestedBy?: string;
  /** why a turn was interrupted: the sender closed the page, or stopped sending heartbeats */
  interruptedReason?: 'left' | 'lost';
}

const STATUSES = new Set<string>(['streaming', 'done', 'stopped', 'failed', 'interrupted']);

export function turnsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(TURNS_FIELD);
}

export function answerText(turn: Y.Map<unknown>): Y.Text | null {
  const a = turn.get('answer');
  return a instanceof Y.Text ? a : null;
}

const str = (v: unknown, max = 10_000): string | undefined =>
  typeof v === 'string' ? v.slice(0, max) : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Reads one turn; anything malformed (it came from the network) is dropped. */
export function readTurn(id: string, turn: Y.Map<unknown>): TurnView | null {
  const status = turn.get('status');
  const createdAt = num(turn.get('createdAt'));
  const sentBy = str(turn.get('sentBy'), 64);
  const provider = turn.get('provider') as Record<string, unknown> | undefined;
  const prompt = turn.get('prompt') as Record<string, unknown> | undefined;
  if (typeof status !== 'string' || !STATUSES.has(status)) return null;
  if (createdAt === undefined || sentBy === undefined) return null;
  if (typeof provider !== 'object' || typeof prompt !== 'object') return null;
  const view: TurnView = {
    id,
    branchId: str(turn.get('branchId'), 64) ?? 'main',
    parentId: str(turn.get('parentId'), 64) ?? null,
    createdAt,
    sentBy,
    senderName: str(turn.get('senderName'), 24) ?? '',
    prompt: { text: str(prompt.text, 100_000) ?? '', spans: [] },
    provider: {
      kind: str(provider.kind, 16) ?? 'mock',
      model: str(provider.model, 200) ?? '',
      label: str(provider.label, 120) ?? '',
      ...(typeof provider.endpoint === 'string'
        ? { endpoint: provider.endpoint.slice(0, 32) }
        : {}),
    },
    requestHash: str(turn.get('requestHash'), 64) ?? '',
    status: status as TurnStatus,
    answer: answerText(turn)?.toJSON() ?? '',
  };
  const usage = turn.get('usage') as Record<string, unknown> | undefined;
  const input = num(usage?.input);
  const output = num(usage?.output);
  if (input !== undefined && output !== undefined) view.usage = { input, output };
  const durationMs = num(turn.get('durationMs'));
  if (durationMs !== undefined) view.durationMs = durationMs;
  const error = turn.get('error') as Record<string, unknown> | undefined;
  if (error && typeof error.message === 'string') {
    const status = num(error.status);
    view.error = {
      code: str(error.code, 32) ?? 'other',
      message: error.message.slice(0, 300),
      ...(status !== undefined ? { status } : {}),
    };
  }
  const stoppedBy = str(turn.get('stoppedBy'), 64);
  if (stoppedBy) view.stoppedBy = stoppedBy;
  const stopRequestedBy = str(turn.get('stopRequestedBy'), 64);
  if (stopRequestedBy) view.stopRequestedBy = stopRequestedBy;
  const reason = turn.get('interruptedReason');
  if (reason === 'left' || reason === 'lost') view.interruptedReason = reason;
  return view;
}

/** The main history, oldest first. */
export function listTurns(doc: Y.Doc): TurnView[] {
  const out: TurnView[] = [];
  turnsMap(doc).forEach((turn, id) => {
    if (!(turn instanceof Y.Map)) return;
    const view = readTurn(id, turn);
    if (view) out.push(view);
  });
  return out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

export interface NewTurn {
  id: string;
  createdAt: number;
  sentBy: string;
  senderName: string;
  promptText: string;
  provider: TurnProvider;
  requestHash: string;
}

/** Writes a new streaming turn after the current last one. Returns its answer text. */
export function addTurn(doc: Y.Doc, turn: NewTurn): Y.Text {
  const last = listTurns(doc).at(-1);
  const map = new Y.Map<unknown>();
  const answer = new Y.Text();
  map.set('branchId', 'main');
  map.set('parentId', last?.id ?? null);
  map.set('createdAt', turn.createdAt);
  map.set('sentBy', turn.sentBy);
  map.set('senderName', turn.senderName);
  map.set('prompt', { text: turn.promptText, spans: [] });
  map.set('provider', { ...turn.provider });
  map.set('requestHash', turn.requestHash);
  map.set('status', 'streaming');
  map.set('answer', answer);
  turnsMap(doc).set(turn.id, map);
  return answer;
}

/** History sent to the model: earlier prompts and the answers that have text. */
export function historyMessages(doc: Y.Doc): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const t of listTurns(doc)) {
    if (t.status === 'streaming' || t.status === 'failed') continue;
    if (t.answer.trim().length === 0) continue;
    out.push({ role: 'user', content: t.prompt.text });
    out.push({ role: 'assistant', content: t.answer });
  }
  return out;
}

/** SHA-256 of a string as lower-case hex (the stored requestHash, ADR-005). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
