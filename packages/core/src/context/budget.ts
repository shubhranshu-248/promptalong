/**
 * Token budget (ADR-005): what fits = the model's context window minus the room kept free for the
 * answer. Nothing is trimmed silently: over budget, Send is switched off and people decide what to
 * exclude.
 */
export const ANSWER_RESERVE_MAX = 1024;
/** Chat formats spend a few tokens per message (role + separators) and a few to start the answer. */
export const TOKENS_PER_MESSAGE = 4;
export const TOKENS_REPLY_PRIMING = 3;

export function answerReserve(contextWindow: number): number {
  return Math.min(ANSWER_RESERVE_MAX, Math.max(0, Math.floor(contextWindow / 4)));
}

export function promptBudget(contextWindow: number): number {
  return Math.max(0, Math.floor(contextWindow) - answerReserve(contextWindow));
}

export function messageOverhead(messages: number): number {
  return messages <= 0 ? 0 : messages * TOKENS_PER_MESSAGE + TOKENS_REPLY_PRIMING;
}

export interface BudgetInput {
  contextWindow: number;
  /** tokens of each message's content, in order */
  messageTokens: readonly number[];
  /** tokens of each included context block */
  itemTokens: readonly { itemId: string; ownerUid: string; tokens: number }[];
}

export interface BudgetView {
  contextWindow: number;
  reserve: number;
  limit: number;
  used: number;
  /** tokens over the limit (0 = it fits) */
  over: number;
  /** room line + history + prompt + per-message overhead */
  base: number;
  /** context tokens per person, largest first */
  owners: { uid: string; tokens: number }[];
}

export function tokenBudget(input: BudgetInput): BudgetView {
  const reserve = answerReserve(input.contextWindow);
  const limit = promptBudget(input.contextWindow);
  const content = input.messageTokens.reduce((a, b) => a + b, 0);
  const used = content + messageOverhead(input.messageTokens.length);
  const byOwner = new Map<string, number>();
  let context = 0;
  for (const item of input.itemTokens) {
    byOwner.set(item.ownerUid, (byOwner.get(item.ownerUid) ?? 0) + item.tokens);
    context += item.tokens;
  }
  // Blocks are counted one by one, the system message as a whole: never show more than `used`.
  const shown = Math.min(context, used);
  const scale = context > 0 ? shown / context : 0;
  const owners = [...byOwner]
    .map(([uid, tokens]) => ({ uid, tokens: Math.round(tokens * scale) }))
    .sort((a, b) => b.tokens - a.tokens || (a.uid < b.uid ? -1 : 1));
  const ownersTotal = owners.reduce((a, o) => a + o.tokens, 0);
  return {
    contextWindow: input.contextWindow,
    reserve,
    limit,
    used,
    over: Math.max(0, used - limit),
    base: Math.max(0, used - ownersTotal),
    owners,
  };
}
