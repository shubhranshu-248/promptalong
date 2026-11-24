/**
 * Small, dependency-free diffs for prompts (ADR-004 P4 addendum): a word diff for Compare and a
 * three-way paragraph merge for Merge. Prompts are short (paragraphs and hundreds of words), so a
 * plain LCS table is fast enough and easy to verify.
 */

export type DiffOp<T> =
  | { type: 'eq'; a: T; b: T; ai: number; bi: number }
  | { type: 'del'; a: T; ai: number }
  | { type: 'ins'; b: T; bi: number };

/** An element of a list at an index the surrounding loop has already bounds-checked. */
function item<T>(list: readonly T[], i: number): T {
  return list[i] as T;
}

/** Longest-common-subsequence diff of two lists. Deletions come before insertions in a change. */
export function diffLists<T>(
  a: readonly T[],
  b: readonly T[],
  same: (x: T, y: T) => boolean = Object.is,
): DiffOp<T>[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  // lcs[i * w + j] = LCS length of a[i..] and b[j..]
  const lcs = new Uint32Array((n + 1) * w);
  const at = (i: number, j: number) => lcs[i * w + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = same(item(a, i), item(b, j))
        ? at(i + 1, j + 1) + 1
        : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const out: DiffOp<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && same(item(a, i), item(b, j))) {
      out.push({ type: 'eq', a: item(a, i), b: item(b, j), ai: i, bi: j });
      i++;
      j++;
    } else if (j >= m || (i < n && at(i + 1, j) >= at(i, j + 1))) {
      out.push({ type: 'del', a: item(a, i), ai: i });
      i++;
    } else {
      out.push({ type: 'ins', b: item(b, j), bi: j });
      j++;
    }
  }
  return out;
}

/** Splits text into words and the whitespace / punctuation between them (joins back exactly). */
export function tokenize(text: string): string[] {
  return text.match(/[\p{L}\p{M}\p{N}_'’]+|\s+|[^\p{L}\p{M}\p{N}_'’\s]/gu) ?? [];
}

export interface WordPart {
  type: 'same' | 'removed' | 'added';
  text: string;
  /** offset of this part in the old text (same / removed) or in the new text (added) */
  at: number;
}

/** Word diff of two prompts, merged into runs. */
export function diffWords(oldText: string, newText: string): WordPart[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const ops = diffLists(a, b);
  const offA: number[] = [];
  const offB: number[] = [];
  let p = 0;
  for (const t of a) {
    offA.push(p);
    p += t.length;
  }
  p = 0;
  for (const t of b) {
    offB.push(p);
    p += t.length;
  }
  const parts: WordPart[] = [];
  const push = (type: WordPart['type'], text: string, at: number) => {
    const last = parts.at(-1);
    if (last?.type === type) last.text += text;
    else parts.push({ type, text, at });
  };
  for (const op of ops) {
    if (op.type === 'eq') push('same', op.a, offA[op.ai] ?? 0);
    else if (op.type === 'del') push('removed', op.a, offA[op.ai] ?? 0);
    else push('added', op.b, offB[op.bi] ?? 0);
  }
  return parts;
}

export type MergeChunk<T> =
  | { kind: 'ok'; items: T[]; from: 'base' | 'ours' | 'theirs' }
  | { kind: 'conflict'; base: T[]; ours: T[]; theirs: T[] };

/**
 * Three-way merge of lists (diff3). Regions where ours and theirs both kept the base unchanged are
 * stable; between them, a side that did not change the base gives way to the side that did; when
 * both changed it differently, that region is a conflict.
 */
export function diff3<T>(
  base: readonly T[],
  ours: readonly T[],
  theirs: readonly T[],
  same: (x: T, y: T) => boolean = Object.is,
): MergeChunk<T>[] {
  const mapOf = (side: readonly T[]) => {
    const map = new Map<number, number>();
    for (const op of diffLists(base, side, same)) if (op.type === 'eq') map.set(op.ai, op.bi);
    return map;
  };
  const toO = mapOf(ours);
  const toT = mapOf(theirs);
  const eqList = (x: readonly T[], y: readonly T[]) =>
    x.length === y.length && x.every((v, i) => same(v, item(y, i)));

  const chunks: MergeChunk<T>[] = [];
  const pushOk = (items: T[], from: 'base' | 'ours' | 'theirs') => {
    if (items.length === 0) return;
    const last = chunks.at(-1);
    if (last?.kind === 'ok' && last.from === from) last.items.push(...items);
    else chunks.push({ kind: 'ok', items: [...items], from });
  };
  let i = 0;
  let j = 0;
  let k = 0;
  for (;;) {
    // next base index stable in both sides, after our current positions
    let m = i;
    while (m < base.length) {
      const o = toO.get(m);
      const t = toT.get(m);
      if (o !== undefined && t !== undefined && o >= j && t >= k) break;
      m++;
    }
    const oEnd = m < base.length ? (toO.get(m) ?? ours.length) : ours.length;
    const tEnd = m < base.length ? (toT.get(m) ?? theirs.length) : theirs.length;
    const b = base.slice(i, m);
    const o = ours.slice(j, oEnd);
    const t = theirs.slice(k, tEnd);
    if (b.length > 0 || o.length > 0 || t.length > 0) {
      if (eqList(o, b)) pushOk(t, 'theirs');
      else if (eqList(t, b)) pushOk(o, 'ours');
      else if (eqList(o, t)) pushOk(o, 'ours');
      else chunks.push({ kind: 'conflict', base: b, ours: o, theirs: t });
    }
    if (m >= base.length) break;
    pushOk([item(ours, oEnd)], 'base');
    i = m + 1;
    j = oEnd + 1;
    k = tEnd + 1;
  }
  return chunks;
}
