import type * as Y from 'yjs';
import { MAIN_BRANCH, draftFragment } from '../room/doc';
import {
  fillParagraphs,
  joinParagraphs,
  paragraphElement,
  readParagraphs,
  splitParagraphs,
  writeFragment,
  type Para,
  type Span,
} from '../provenance/spans';
import { diff3, diffLists, type MergeChunk } from '../text/diff';
import { listTurns, type TurnView } from '../turns/turns';

/**
 * Branches of the conversation (U2, ADR-004 + P4 addendum).
 * - "main" always exists and is not stored. Other branches live in the `branches` map.
 * - Each branch has its own draft prompt (see draftFragment). `settings.activeBranch` decides which
 *   draft the shared editor shows; switching is room-wide.
 * - Turns point at their parent; a branch's history is the parent chain from its newest turn, or
 *   from the turn it was branched from while it has none of its own.
 * Nothing here deletes a turn.
 */
export const BRANCHES_FIELD = 'branches';
export const EVENTS_FIELD = 'events';
export const BRANCH_NAME_MAX = 40;

export interface BranchView {
  id: string;
  name: string;
  /** the turn the branch continues from (null = from the start) */
  fromTurnId: string | null;
  sourceBranch: string;
  createdBy: string;
  createdAt: number;
  /** the prompt both sides started from (merge base) */
  base: Para[];
}

export interface MergeEvent {
  id: string;
  type: 'merge';
  from: string;
  into: string;
  by: string;
  at: number;
  conflicts: number;
}

const MAIN: BranchView = {
  id: MAIN_BRANCH,
  name: MAIN_BRANCH,
  fromTurnId: null,
  sourceBranch: MAIN_BRANCH,
  createdBy: '',
  createdAt: 0,
  base: [],
};

function branchesMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(BRANCHES_FIELD);
}

function settings(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('settings');
}

export function eventsArray(doc: Y.Doc): Y.Array<unknown> {
  return doc.getArray(EVENTS_FIELD);
}

export function cleanBranchName(input: string): string {
  return input
    .replace(/\s+/gu, '-')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
    .replace(/-+/gu, '-')
    .replace(/^[-.]+|[-.]+$/gu, '')
    .slice(0, BRANCH_NAME_MAX)
    .toLowerCase();
}

function readParas(value: unknown): Para[] {
  if (!Array.isArray(value)) return [];
  return (value.slice(0, 500) as unknown[]).flatMap((p) => {
    if (typeof p !== 'object' || p === null) return [];
    const v = p as Record<string, unknown>;
    if (typeof v.text !== 'string') return [];
    const spans = Array.isArray(v.spans)
      ? (v.spans as unknown[]).flatMap((s) => {
          const x = s as Record<string, unknown> | null;
          return x &&
            typeof x.from === 'number' &&
            typeof x.to === 'number' &&
            typeof x.uid === 'string' &&
            x.to > x.from
            ? [{ from: x.from, to: x.to, uid: x.uid.slice(0, 64) }]
            : [];
        })
      : [];
    return [{ text: v.text.slice(0, 20_000), spans }];
  });
}

function readBranch(id: string, value: unknown): BranchView | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string' || typeof v.createdAt !== 'number') return null;
  return {
    id,
    name: v.name.slice(0, BRANCH_NAME_MAX) || id,
    fromTurnId: typeof v.fromTurnId === 'string' ? v.fromTurnId : null,
    sourceBranch: typeof v.sourceBranch === 'string' ? v.sourceBranch : MAIN_BRANCH,
    createdBy: typeof v.createdBy === 'string' ? v.createdBy : '',
    createdAt: v.createdAt,
    base: readParas(v.base),
  };
}

/** main first, then branches oldest first. */
export function listBranches(doc: Y.Doc): BranchView[] {
  const out: BranchView[] = [];
  branchesMap(doc).forEach((value, id) => {
    const b = readBranch(id, value);
    if (b && id !== MAIN_BRANCH) out.push(b);
  });
  out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return [MAIN, ...out];
}

export function getBranch(doc: Y.Doc, id: string): BranchView | null {
  if (id === MAIN_BRANCH) return MAIN;
  return readBranch(id, branchesMap(doc).get(id));
}

export function activeBranch(doc: Y.Doc): string {
  const id = settings(doc).get('activeBranch');
  return typeof id === 'string' && getBranch(doc, id) ? id : MAIN_BRANCH;
}

/** Who last switched the room's branch (for the "Kabir switched the room to…" notice). */
export function activeBranchBy(doc: Y.Doc): string | null {
  const by = settings(doc).get('activeBranchBy');
  return typeof by === 'string' ? by : null;
}

export function setActiveBranch(doc: Y.Doc, id: string, by: string): void {
  if (!getBranch(doc, id)) return;
  doc.transact(() => {
    settings(doc).set('activeBranch', id);
    settings(doc).set('activeBranchBy', by);
  });
}

export function renameBranch(doc: Y.Doc, id: string, name: string): boolean {
  const clean = cleanBranchName(name);
  if (id === MAIN_BRANCH || !clean) return false;
  const current = branchesMap(doc).get(id);
  if (typeof current !== 'object' || current === null) return false;
  if (listBranches(doc).some((b) => b.id !== id && b.name === clean)) return false;
  branchesMap(doc).set(id, { ...(current as Record<string, unknown>), name: clean });
  return true;
}

/** The newest turn on a branch, or the turn it was branched from (null = empty history). */
export function tipOf(doc: Y.Doc, branchId: string): string | null {
  const own = listTurns(doc).filter((t) => t.branchId === branchId);
  const last = own.at(-1);
  if (last) return last.id;
  return getBranch(doc, branchId)?.fromTurnId ?? null;
}

/** A branch's history, oldest first: the parent chain from its tip. */
export function turnsOnPath(doc: Y.Doc, branchId: string): TurnView[] {
  const byId = new Map(listTurns(doc).map((t) => [t.id, t]));
  const out: TurnView[] = [];
  const seen = new Set<string>();
  let id = tipOf(doc, branchId);
  while (id && !seen.has(id)) {
    seen.add(id);
    const t = byId.get(id);
    if (!t) break;
    out.push(t);
    id = t.parentId;
  }
  return out.reverse();
}

/** What the model receives before the new prompt: earlier prompts and answers with text. */
export function historyMessages(
  doc: Y.Doc,
  branchId: string = MAIN_BRANCH,
): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const t of turnsOnPath(doc, branchId)) {
    if (t.status === 'streaming' || t.status === 'failed') continue;
    if (t.answer.trim().length === 0) continue;
    out.push({ role: 'user', content: t.prompt.text });
    out.push({ role: 'assistant', content: t.answer });
  }
  return out;
}

/**
 * Short labels: main turns T1, T2, T3…; a branch's own turns use their position in its history
 * plus a letter per branch (T3b, T4b, then c, d…).
 */
export function turnLabels(doc: Y.Doc): Map<string, string> {
  const labels = new Map<string, string>();
  const branches = listBranches(doc);
  branches.forEach((b, i) => {
    const letter = i === 0 ? '' : String.fromCharCode(97 + Math.min(i, 25)); // b, c, …
    turnsOnPath(doc, b.id).forEach((t, n) => {
      if (t.branchId === b.id) labels.set(t.id, `T${String(n + 1)}${letter}`);
    });
  });
  // turns whose branch is gone or unknown still get a label
  listTurns(doc).forEach((t, n) => {
    if (!labels.has(t.id)) labels.set(t.id, `T${String(n + 1)}?`);
  });
  return labels;
}

function draftIsEmpty(paras: Para[]): boolean {
  return paras.every((p) => p.text.trim() === '');
}

/**
 * The prompt a branch "has" right now: its draft, or (draft empty) the prompt of its newest turn.
 */
export function sideParas(doc: Y.Doc, branchId: string): Para[] {
  const draft = readParagraphs(draftFragment(doc, branchId));
  if (!draftIsEmpty(draft)) return draft;
  const last = turnsOnPath(doc, branchId).at(-1);
  return last ? splitParagraphs(last.prompt.text, last.prompt.spans) : draft;
}

export interface NewBranch {
  id: string;
  name: string;
  fromTurnId: string | null;
  sourceBranch: string;
  by: string;
  at: number;
}

/**
 * Creates a branch after `fromTurnId`. Its draft starts as the prompt that came next on the source
 * branch (edit and retry), or the source's current draft; that prompt is also the merge base.
 */
export function createBranch(doc: Y.Doc, input: NewBranch): BranchView | null {
  const name = cleanBranchName(input.name);
  if (!name || name === MAIN_BRANCH) return null;
  if (listBranches(doc).some((b) => b.name === name)) return null;
  const path = turnsOnPath(doc, input.sourceBranch);
  const at = input.fromTurnId ? path.findIndex((t) => t.id === input.fromTurnId) : -1;
  if (input.fromTurnId && at < 0) return null;
  const next = path[at + 1];
  const start = next
    ? splitParagraphs(next.prompt.text, next.prompt.spans)
    : readParagraphs(draftFragment(doc, input.sourceBranch));
  doc.transact(() => {
    branchesMap(doc).set(input.id, {
      name,
      fromTurnId: input.fromTurnId,
      sourceBranch: input.sourceBranch,
      createdBy: input.by,
      createdAt: input.at,
      base: start.map((p) => ({ text: p.text, spans: p.spans.map((s) => ({ ...s })) })),
    });
    writeFragment(draftFragment(doc, input.id), start);
  });
  return getBranch(doc, input.id);
}

export interface MergePlan {
  from: string;
  into: string;
  chunks: MergeChunk<Para>[];
  clean: number;
  conflicts: number;
}

const sameText = (a: Para, b: Para) => a.text === b.text;

/** Works out what merging `from`'s prompt into `into`'s draft would do (nothing is written). */
export function planMerge(doc: Y.Doc, from: string, into: string): MergePlan {
  const branch = getBranch(doc, from);
  const base = branch && branch.base.length > 0 ? branch.base : [];
  const ours = sideParas(doc, into);
  const theirs = sideParas(doc, from);
  const chunks = diff3(base, ours, theirs, sameText);
  let clean = 0;
  let conflicts = 0;
  for (const c of chunks) {
    if (c.kind === 'conflict') conflicts++;
    else if (c.from === 'theirs') clean += c.items.length;
  }
  return { from, into, chunks, clean, conflicts };
}

export type Resolution = 'ours' | 'theirs' | 'both';

/** The merged prompt for a plan and one choice per conflict (in order). */
export function mergedParas(plan: MergePlan, choices: readonly Resolution[]): Para[] {
  const out: Para[] = [];
  let n = 0;
  for (const c of plan.chunks) {
    if (c.kind === 'ok') {
      out.push(...c.items);
      continue;
    }
    const choice = choices[n] ?? 'ours';
    n++;
    if (choice === 'ours' || choice === 'both') out.push(...c.ours);
    if (choice === 'theirs' || choice === 'both') out.push(...c.theirs);
  }
  return out;
}

const sameParagraph = (a: Para, b: Para) =>
  a.text === b.text && JSON.stringify(a.spans) === JSON.stringify(b.spans);

/**
 * Writes a merge into the target draft. Only paragraphs that change are replaced, so people typing
 * in other paragraphs lose nothing; author marks travel with the text. Recorded as a tree event.
 */
export function applyMerge(
  doc: Y.Doc,
  plan: MergePlan,
  choices: readonly Resolution[],
  meta: { id: string; by: string; at: number },
): void {
  const result = mergedParas(plan, choices);
  const fragment = draftFragment(doc, plan.into);
  doc.transact(() => {
    const current = readParagraphs(fragment);
    const ops = diffLists(current, result, sameParagraph);
    let index = 0;
    const created: Y.XmlElement[] = [];
    for (const op of ops) {
      if (op.type === 'eq') index++;
      else if (op.type === 'del') fragment.delete(index, 1);
      else {
        const el = paragraphElement(op.b);
        fragment.insert(index, [el]);
        created.push(el);
        index++;
      }
    }
    fillParagraphs(created);
    if (fragment.length === 0) writeFragment(fragment, []);
    eventsArray(doc).push([
      {
        id: meta.id,
        type: 'merge',
        from: plan.from,
        into: plan.into,
        by: meta.by,
        at: meta.at,
        conflicts: plan.conflicts,
      } satisfies MergeEvent,
    ]);
  });
}

export function listMergeEvents(doc: Y.Doc): MergeEvent[] {
  return eventsArray(doc)
    .toArray()
    .flatMap((e) => {
      if (typeof e !== 'object' || e === null) return [];
      const v = e as Record<string, unknown>;
      if (v.type !== 'merge' || typeof v.from !== 'string' || typeof v.into !== 'string') return [];
      return [
        {
          id: typeof v.id === 'string' ? v.id : '',
          type: 'merge' as const,
          from: v.from,
          into: v.into,
          by: typeof v.by === 'string' ? v.by : '',
          at: typeof v.at === 'number' ? v.at : 0,
          conflicts: typeof v.conflicts === 'number' ? v.conflicts : 0,
        },
      ];
    });
}

/** Text + spans helper for callers that hold paragraphs. */
export function parasToPrompt(paras: readonly Para[]): { text: string; spans: Span[] } {
  return joinParagraphs(paras);
}
