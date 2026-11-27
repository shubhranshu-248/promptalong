import {
  assembleRoom,
  contextBlock,
  contextOwnerName,
  promptFragment,
  promptBudget,
  sessionContextItems,
  tokenBudget,
  type Assembled,
  type BudgetView,
} from '@promptalong/core';
import { approxTokens, modelLimits } from '@promptalong/providers';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWebLlmState } from '../models/webllm-state';
import type { RoomSession, RoomSnapshot } from '../room/session';
import type { SessionConn, SessionSnapshot } from '../room/session-conn';
import { O200K, engineSpace, knownTokens, tokenStore, useTokenVersion } from './tokens';

const DRAFT_QUIET_MS = 200;
const DRAFT_MAX_WAIT_MS = 1000;

export interface ContextBudget {
  /** the request as Send would build it */
  assembled: Assembled;
  /** the prompt changed a moment ago and `assembled` has not caught up yet */
  stale: boolean;
  budget: BudgetView;
  /** true when every count came from the model's own tokenizer */
  exact: boolean;
  /** tokens of each item's block, included or not */
  itemTokens: Record<string, number>;
  /** a count this browser already has for a text (null = only an estimate so far) */
  tokensFor: (text: string) => { tokens: number; exact: boolean } | null;
}

/**
 * The live request and its token budget. Recomputed when the context, the history, the room line,
 * the model or the draft prompt changes - never while an answer streams.
 */
export function useContextBudget(
  room: RoomSession,
  snap: RoomSnapshot,
  session: SessionConn,
  ss: SessionSnapshot,
): ContextBudget {
  const [draftTick, setDraftTick] = useState(0);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const fragment = promptFragment(session.doc);
    let quiet: ReturnType<typeof setTimeout> | null = null;
    let latest: ReturnType<typeof setTimeout> | null = null;
    const recount = () => {
      if (quiet) clearTimeout(quiet);
      if (latest) clearTimeout(latest);
      quiet = latest = null;
      setDraftTick((n) => n + 1);
      setStale(false);
    };
    // Typing never waits for the budget: recount when the typing pauses, and at least once a
    // second while it goes on.
    const onChange = () => {
      setStale(true);
      if (quiet) clearTimeout(quiet);
      quiet = setTimeout(recount, DRAFT_QUIET_MS);
      latest ??= setTimeout(recount, DRAFT_MAX_WAIT_MS);
    };
    fragment.observeDeep(onChange);
    return () => {
      fragment.unobserveDeep(onChange);
      if (quiet) clearTimeout(quiet);
      if (latest) clearTimeout(latest);
      setStale(false);
    };
  }, [session]);

  // Everything except the draft that can change the request, as one comparable value.
  const signature = JSON.stringify([
    snap.systemLine,
    snap.context,
    ss.systemLine,
    ss.context,
    ss.roomContextOff,
    ss.path.map((t) => [t.id, t.status, t.status === 'streaming' ? 0 : t.answer.length]),
    Object.entries(snap.roster).map(([pid, r]) => [pid, r.name]),
  ]);

  const assembled = useMemo(
    () => assembleRoom(session.doc, { room: room.doc }),
    // (the document is read again whenever one of these changes)
    [room, session, signature, draftTick],
  );
  const blocks = useMemo(
    () =>
      sessionContextItems(session.doc, room.doc).map((item) => ({
        id: item.id,
        ownerUid: item.ownerUid,
        included: item.included,
        block: contextBlock(item.title, contextOwnerName(room.doc, item.ownerUid), item.text),
      })),
    // (the document is read again whenever one of these changes)
    [room, session, signature],
  );

  const limits = modelLimits(ss.model);
  const engine = useWebLlmState();
  const engineReady =
    limits.counting === 'engine' && engine.status === 'ready' && engine.model === ss.model.model;
  const space = engineReady ? engineSpace(ss.model.model) : O200K;
  const version = useTokenVersion();

  // The tokenizer is a large download (about 1 MB) and takes a moment to start, so it is fetched
  // only when its counts matter: something is attached, the model can be counted exactly, or the
  // request is getting long. Everyone in a room decides this the same way, so they see the same
  // numbers. A short prompt in an empty room is estimated.
  const rough = assembled.messages.reduce((sum, m) => sum + approxTokens(m.content), 0);
  const count =
    blocks.length > 0 ||
    engineReady ||
    limits.counting === 'encoding' ||
    rough > promptBudget(limits.contextWindow) * 0.6;
  useEffect(() => {
    if (!count) return;
    tokenStore.ensure(space, [
      ...assembled.messages.map((m) => m.content),
      ...blocks.map((b) => b.block),
    ]);
  }, [count, space, assembled, blocks]);

  const view = useMemo(() => {
    const all = { counted: true };
    const count = (text: string): number => {
      const known = knownTokens(tokenStore, space, text);
      if (!known.counted) all.counted = false;
      return known.tokens;
    };
    const itemTokens: Record<string, number> = {};
    for (const b of blocks) itemTokens[b.id] = count(b.block);
    const budget = tokenBudget({
      contextWindow: limits.contextWindow,
      messageTokens: assembled.messages.map((m) => count(m.content)),
      itemTokens: blocks
        .filter((b) => b.included)
        .map((b) => ({ itemId: b.id, ownerUid: b.ownerUid, tokens: itemTokens[b.id] ?? 0 })),
    });
    const exact = all.counted && (engineReady || limits.counting === 'encoding');
    return { budget, itemTokens, exact };
    // (`version` changes when counts arrive)
  }, [assembled, blocks, space, engineReady, limits.contextWindow, limits.counting, version]);

  const precise = engineReady || limits.counting === 'encoding';
  const tokensFor = useCallback(
    (text: string) => {
      const n = tokenStore.peek(space, text);
      return n === undefined ? null : { tokens: n, exact: precise };
    },
    [space, precise],
  );

  return { assembled, stale, ...view, tokensFor };
}
