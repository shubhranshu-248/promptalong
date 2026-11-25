/**
 * A small, safe Markdown reader for model answers. It builds a plain tree (no HTML strings), so
 * nothing in an answer can inject markup or scripts. It is tolerant of half-written input because
 * answers are rendered while they stream: an unclosed `**` or code fence simply stays text (or
 * stays a code block) until the rest arrives.
 *
 * Supported: paragraphs, headings, bullet and numbered lists, block quotes, fenced code, tables
 * (GitHub style), horizontal rules; inline code, bold, italic and http(s) / mailto links.
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] };

export type Align = 'left' | 'center' | 'right' | null;

export interface ListItem {
  /** what the reader sees before the item: "1." for numbered lists, "•" for bullets */
  marker: string;
  c: Inline[];
}

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'list'; ordered: boolean; items: ListItem[] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/u;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/u;
const BULLET = /^ {0,3}([-*+])\s+(.*)$/u;
const NUMBERED = /^ {0,3}(\d{1,3})([.)])\s+(.*)$/u;
const QUOTE = /^ {0,3}>\s?(.*)$/u;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/u;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/u;

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < row.length; i++) {
    const ch = row[i] ?? '';
    if (ch === '\\' && row[i + 1] === '|') {
      cell += '|';
      i += 1;
    } else if (ch === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

function isTableStart(lines: readonly string[], i: number): boolean {
  const head = lines[i];
  const sep = lines[i + 1];
  if (head === undefined || sep === undefined || !head.includes('|')) return false;
  if (!TABLE_SEP.test(sep) || !sep.includes('-')) return false;
  return splitRow(sep).length === splitRow(head).length;
}

function startsBlock(lines: readonly string[], i: number): boolean {
  const line = lines[i] ?? '';
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    QUOTE.test(line) ||
    RULE.test(line) ||
    isTableStart(lines, i)
  );
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1] ?? '```';
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith(mark)) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      i += 1; // the closing fence (or past the end while it is still streaming)
      blocks.push({ t: 'code', lang: fence[2] ?? '', v: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ t: 'h', level: (heading[1] ?? '#').length, c: parseInline(heading[2] ?? '') });
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1] ?? '').map(alignOf);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim()) {
        const cells = splitRow(lines[i] ?? '');
        rows.push(head.map((_, k) => parseInline(cells[k] ?? '')));
        i += 1;
      }
      blocks.push({ t: 'table', align, head: head.map((h) => parseInline(h)), rows });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ t: 'hr' });
      i += 1;
      continue;
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = NUMBERED.test(line);
      const items: { marker: string; text: string }[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const num = NUMBERED.exec(current);
        const bullet = BULLET.exec(current);
        if (ordered && num) {
          items.push({ marker: `${num[1] ?? ''}${num[2] ?? '.'}`, text: num[3] ?? '' });
        } else if (!ordered && bullet && !RULE.test(current)) {
          items.push({ marker: '•', text: bullet[2] ?? '' });
        } else if (
          items.length > 0 &&
          current.trim() !== '' &&
          /^\s{2,}/u.test(current) &&
          !startsBlock(lines, i)
        ) {
          const last = items.at(-1);
          if (last) last.text += `\n${current.trim()}`;
        } else {
          break;
        }
        i += 1;
      }
      blocks.push({
        t: 'list',
        ordered,
        items: items.map((it) => ({ marker: it.marker, c: parseInline(it.text) })),
      });
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      let q = QUOTE.exec(lines[i] ?? '');
      while (i < lines.length && q) {
        body.push(q[1] ?? '');
        i += 1;
        q = QUOTE.exec(lines[i] ?? '');
      }
      blocks.push({ t: 'quote', c: parseInline(body.join('\n')) });
      continue;
    }

    const body: string[] = [line];
    i += 1;
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !startsBlock(lines, i)) {
      body.push(lines[i] ?? '');
      i += 1;
    }
    blocks.push({ t: 'p', c: parseInline(body.join('\n')) });
  }
  return blocks;
}

/** Only web and mail links become links; anything else (javascript:, data:, ...) stays text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  return /^(https?:\/\/|mailto:)[^\s<>"]+$/iu.test(href) ? href : null;
}

function pushText(out: Inline[], v: string): void {
  if (!v) return;
  const last = out.at(-1);
  if (last?.t === 'text') last.v += v;
  else out.push({ t: 'text', v });
}

/** Where `marker` closes, at or after `from` (not right after an opening space for * and _). */
function findClose(s: string, marker: string, from: number): number {
  let at = s.indexOf(marker, from);
  while (at !== -1) {
    const before = s[at - 1] ?? '';
    if (at > from && before !== ' ' && before !== '\\') {
      if (marker.length === 2 && s[at + 2] === marker[0]) {
        // "***": the bold closes on the last two stars, the italic inside on the first one
        at = s.indexOf(marker, at + 1);
        continue;
      }
      if (marker === '_' || marker === '__') {
        const after = s[at + marker.length] ?? '';
        if (!/[\p{L}\p{N}]/u.test(after)) return at;
      } else {
        return at;
      }
    }
    at = s.indexOf(marker, at + 1);
  }
  return -1;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i] ?? '';
    const next = s[i + 1] ?? '';

    if (ch === '\\' && /[\\`*_[\]()|#>-]/u.test(next)) {
      pushText(out, next);
      i += 2;
      continue;
    }

    if (ch === '`') {
      const run = /^`+/u.exec(s.slice(i))?.[0] ?? '`';
      const end = s.indexOf(run, i + run.length);
      if (end !== -1) {
        out.push({ t: 'code', v: s.slice(i + run.length, end) });
        i = end + run.length;
        continue;
      }
    }

    if ((ch === '*' || ch === '_') && next === ch) {
      const marker = ch + ch;
      const prev = s[i - 1] ?? '';
      const opens = s[i + 2] !== undefined && s[i + 2] !== ' ';
      const wordInside = ch === '_' && /[\p{L}\p{N}]/u.test(prev);
      const end = opens && !wordInside ? findClose(s, marker, i + 2) : -1;
      if (end !== -1) {
        out.push({ t: 'strong', c: parseInline(s.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    } else if (ch === '*' || ch === '_') {
      const prev = s[i - 1] ?? '';
      const opens = next !== '' && next !== ' ';
      const wordInside = ch === '_' && /[\p{L}\p{N}]/u.test(prev);
      const end = opens && !wordInside ? findClose(s, ch, i + 1) : -1;
      if (end !== -1) {
        out.push({ t: 'em', c: parseInline(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    if (ch === '[') {
      const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/u.exec(s.slice(i));
      const href = m ? safeHref(m[2] ?? '') : null;
      if (m && href) {
        out.push({ t: 'link', href, c: parseInline(m[1] ?? '') });
        i += m[0].length;
        continue;
      }
    }

    pushText(out, ch);
    i += 1;
  }
  return out;
}
