import type * as Y from 'yjs';
import { MAIN_BRANCH } from '../room/doc';
import { listTurns, type TurnView } from '../turns/turns';

/**
 * The room's conversation: one straight line of turns, oldest first. Each turn points at the turn
 * before it; the history is the parent chain from the newest turn. (Turns written by older
 * versions on other lines are left in the document and not shown.)
 */

/** The newest turn of the conversation (null = nothing sent yet). */
export function tipOf(doc: Y.Doc): string | null {
  return (
    listTurns(doc)
      .filter((t) => t.branchId === MAIN_BRANCH)
      .at(-1)?.id ?? null
  );
}

/** The conversation, oldest first: the parent chain from the newest turn. */
export function conversation(doc: Y.Doc): TurnView[] {
  const byId = new Map(listTurns(doc).map((t) => [t.id, t]));
  const out: TurnView[] = [];
  const seen = new Set<string>();
  let id = tipOf(doc);
  while (id && !seen.has(id)) {
    seen.add(id);
    const t = byId.get(id);
    if (!t) break;
    out.push(t);
    id = t.parentId;
  }
  return out.reverse();
}

/** The finished turns the model receives before the new prompt, oldest first. */
export function historyEntries(doc: Y.Doc): { turnId: string; prompt: string; answer: string }[] {
  const out: { turnId: string; prompt: string; answer: string }[] = [];
  for (const t of conversation(doc)) {
    if (t.status === 'streaming' || t.status === 'failed') continue;
    if (t.answer.trim().length === 0) continue;
    out.push({ turnId: t.id, prompt: t.prompt.text, answer: t.answer });
  }
  return out;
}

/** The same history as chat messages: earlier prompts and answers with text. */
export function historyMessages(doc: Y.Doc): { role: 'user' | 'assistant'; content: string }[] {
  return historyEntries(doc).flatMap((t) => [
    { role: 'user' as const, content: t.prompt },
    { role: 'assistant' as const, content: t.answer },
  ]);
}

/** Short labels in order: T1, T2, T3… */
export function turnLabels(doc: Y.Doc): Map<string, string> {
  const labels = new Map<string, string>();
  conversation(doc).forEach((t, n) => labels.set(t.id, `T${String(n + 1)}`));
  return labels;
}
