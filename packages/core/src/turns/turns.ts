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

/** One context item as it was sent with a turn (ADR-004): frozen, the live item may change later. */
export interface TurnContextRecord {
  itemId: string;
  title: string;
  ownerUid: string;
  ownerName: string;
  kind: 'note' | 'snippet' | 'file';
  bytes: number;
  /** tokens of the block as sent ("about" unless `exact`) */
  tokens: number;
  exact: boolean;
  /** SHA-256 of the item's text ('' until it has been computed) */
  hash: string;
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
  /** the context items that were part of the request, in the order sent */
  context: TurnContextRecord[];
  /** the room line that was sent ('' = none) */
  systemLine: string;
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

/** Author spans from the network: well-formed ranges only, at most 2000. */
function readSpans(value: unknown): { from: number; to: number; uid: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { from: number; to: number; uid: string }[] = [];
  for (const s of value.slice(0, 2000) as unknown[]) {
    if (typeof s !== 'object' || s === null) continue;
    const v = s as Record<string, unknown>;
    if (typeof v.from !== 'number' || typeof v.to !== 'number' || typeof v.uid !== 'string')
      continue;
    if (v.to <= v.from || v.from < 0) continue;
    out.push({ from: v.from, to: v.to, uid: v.uid.slice(0, 64) });
  }
  return out;
}

const CONTEXT_KINDS = new Set<string>(['note', 'snippet', 'file']);

/** Context records from the network: well-formed ones only, at most 20. */
function readContext(value: unknown): TurnContextRecord[] {
  if (!Array.isArray(value)) return [];
  const out: TurnContextRecord[] = [];
  for (const r of value.slice(0, 20) as unknown[]) {
    if (typeof r !== 'object' || r === null) continue;
    const v = r as Record<string, unknown>;
    if (typeof v.itemId !== 'string' || typeof v.title !== 'string') continue;
    out.push({
      itemId: v.itemId.slice(0, 64),
      title: v.title.slice(0, 80),
      ownerUid: typeof v.ownerUid === 'string' ? v.ownerUid.slice(0, 64) : '',
      ownerName: typeof v.ownerName === 'string' ? v.ownerName.slice(0, 24) : '',
      kind:
        typeof v.kind === 'string' && CONTEXT_KINDS.has(v.kind)
          ? (v.kind as TurnContextRecord['kind'])
          : 'note',
      bytes: typeof v.bytes === 'number' && v.bytes >= 0 ? v.bytes : 0,
      tokens: typeof v.tokens === 'number' && v.tokens >= 0 ? Math.round(v.tokens) : 0,
      exact: v.exact === true,
      hash: typeof v.hash === 'string' && /^[0-9a-f]{64}$/u.test(v.hash) ? v.hash : '',
    });
  }
  return out;
}

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
    prompt: { text: str(prompt.text, 100_000) ?? '', spans: readSpans(prompt.spans) },
    provider: {
      kind: str(provider.kind, 16) ?? 'mock',
      model: str(provider.model, 200) ?? '',
      label: str(provider.label, 120) ?? '',
      ...(typeof provider.endpoint === 'string'
        ? { endpoint: provider.endpoint.slice(0, 32) }
        : {}),
    },
    requestHash: str(turn.get('requestHash'), 64) ?? '',
    context: readContext(turn.get('context')),
    systemLine: str(turn.get('systemLine'), 2000) ?? '',
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
  branchId: string;
  parentId: string | null;
  createdAt: number;
  sentBy: string;
  senderName: string;
  promptText: string;
  spans: { from: number; to: number; uid: string }[];
  provider: TurnProvider;
  requestHash: string;
  context?: TurnContextRecord[];
  systemLine?: string;
}

/** Writes a new streaming turn. Returns its answer text. */
export function addTurn(doc: Y.Doc, turn: NewTurn): Y.Text {
  const map = new Y.Map<unknown>();
  const answer = new Y.Text();
  map.set('branchId', turn.branchId);
  map.set('parentId', turn.parentId);
  map.set('createdAt', turn.createdAt);
  map.set('sentBy', turn.sentBy);
  map.set('senderName', turn.senderName);
  map.set('prompt', { text: turn.promptText, spans: turn.spans.map((x) => ({ ...x })) });
  map.set('provider', { ...turn.provider });
  map.set('requestHash', turn.requestHash);
  if (turn.context && turn.context.length > 0) {
    map.set(
      'context',
      turn.context.map((c) => ({ ...c })),
    );
  }
  if (turn.systemLine) map.set('systemLine', turn.systemLine);
  map.set('status', 'streaming');
  map.set('answer', answer);
  turnsMap(doc).set(turn.id, map);
  return answer;
}

/** SHA-256 of a string as lower-case hex (the stored requestHash, ADR-005). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
