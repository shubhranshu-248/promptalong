import type { ExportModel, ExportModelItem, ExportModelSession } from '@promptalong/core';
import * as fontkit from 'fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';

/**
 * A real PDF of a room or of its sessions, made in the browser (pdf-lib, no server). Text is set in
 * the site's own fonts, embedded as subsets; Hindi is set in Noto Sans Devanagari, which is loaded
 * only when the text has Devanagari letters. Characters none of the fonts has (emoji, Chinese…)
 * print as "?"; the print view draws those with the device's fonts.
 */

export type FontName =
  'regular' | 'regularExt' | 'bold' | 'boldExt' | 'deva' | 'devaBold' | 'mono' | 'display';

/** Loads a font file (WOFF) by name. */
export type FontLoader = (name: FontName) => Promise<Uint8Array>;

type Style = 'regular' | 'bold' | 'mono' | 'display';

interface LoadedFont {
  pdf: PDFFont;
  has: (codePoint: number) => boolean;
}

// pdf-lib streams a font subset; fontkit 2 encodes it in one go. This makes one look like the other.
interface Subset {
  encode: () => Uint8Array;
  encodeStream?: () => unknown;
}
interface FontkitFont {
  createSubset: () => Subset;
  hasGlyphForCodePoint: (cp: number) => boolean;
}
const fontkitForPdfLib = {
  create(bytes: Uint8Array) {
    const font = fontkit.create(bytes) as FontkitFont;
    const createSubset = font.createSubset.bind(font);
    font.createSubset = () => {
      const subset = createSubset();
      subset.encodeStream = () => {
        const on: Record<string, (v?: unknown) => void> = {};
        const api = {
          on(event: string, fn: (v?: unknown) => void) {
            on[event] = fn;
            return api;
          },
        };
        queueMicrotask(() => {
          try {
            on.data?.(subset.encode());
            on.end?.();
          } catch (error) {
            on.error?.(error);
          }
        });
        return api;
      };
      return subset;
    };
    return font;
  },
};

const isDevanagari = (cp: number) =>
  (cp >= 0x0900 && cp <= 0x097f) ||
  (cp >= 0xa8e0 && cp <= 0xa8ff) ||
  cp === 0x200c ||
  cp === 0x200d;

export function hasDevanagari(text: string): boolean {
  for (const ch of text) if (isDevanagari(ch.codePointAt(0) ?? 0)) return true;
  return false;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const WIDTH = A4[0] - MARGIN * 2;
const INK = rgb(0.067, 0.071, 0.094);
const MUTED = rgb(0.38, 0.4, 0.45);
const ACCENT = rgb(0.83, 0.22, 0.17);
const RULE = rgb(0.86, 0.87, 0.89);
const CODE_BG = rgb(0.955, 0.96, 0.97);

class Fonts {
  private readonly cache = new Map<FontName, Promise<LoadedFont>>();
  constructor(
    private readonly doc: PDFDocument,
    private readonly load: FontLoader,
  ) {}

  get(name: FontName): Promise<LoadedFont> {
    let font = this.cache.get(name);
    if (!font) {
      font = this.load(name).then(async (bytes) => {
        const pdf = await this.doc.embedFont(bytes, { subset: true });
        const fk = fontkitForPdfLib.create(bytes);
        return { pdf, has: (cp: number) => fk.hasGlyphForCodePoint(cp) };
      });
      this.cache.set(name, font);
    }
    return font;
  }

  /** The fonts tried in order for a style. */
  chain(style: Style): FontName[] {
    switch (style) {
      case 'display':
        return ['display', 'bold', 'boldExt', 'devaBold'];
      case 'bold':
        return ['bold', 'boldExt', 'devaBold'];
      case 'mono':
        return ['mono', 'regular', 'regularExt', 'deva'];
      default:
        return ['regular', 'regularExt', 'deva'];
    }
  }
}

interface Run {
  text: string;
  font: PDFFont;
}

/** Splits text into runs, each set in the first font of the chain that has its letters. */
async function runs(fonts: Fonts, style: Style, text: string): Promise<Run[]> {
  const chain = fonts.chain(style);
  const out: Run[] = [];
  const base = await fonts.get(chain[0] ?? 'regular');
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    let pick: LoadedFont | null = null;
    if (isDevanagari(cp)) {
      pick = await fonts.get(style === 'regular' || style === 'mono' ? 'deva' : 'devaBold');
    } else if (base.has(cp) || cp < 0x20) {
      pick = base;
    } else {
      for (const name of chain.slice(1)) {
        if (name === 'deva' || name === 'devaBold') continue;
        const f = await fonts.get(name);
        if (f.has(cp)) {
          pick = f;
          break;
        }
      }
    }
    const piece = pick ? ch : '?';
    const font = (pick ?? base).pdf;
    const last = out.at(-1);
    if (last?.font === font) last.text += piece;
    else out.push({ text: piece, font });
  }
  return out;
}

const widthOf = (rs: Run[], size: number) =>
  rs.reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);

interface TextOptions {
  size?: number;
  style?: Style;
  color?: RGB;
  indent?: number;
  /** a mark at the left of every line (prompts, quotes, code) */
  bar?: RGB;
  /** a background behind every line (code) */
  fill?: RGB;
  /** first-line prefix drawn in the indent (bullets) */
  bullet?: string;
  after?: number;
}

/** Lays text out top to bottom, starting new pages as it goes. */
class Writer {
  page!: PDFPage;
  y = 0;
  readonly pages: PDFPage[] = [];

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
  ) {
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage(A4);
    this.pages.push(this.page);
    this.y = A4[1] - MARGIN;
  }

  gap(points: number): void {
    this.y -= points;
  }

  /** Keeps the next `points` together on one page. */
  keep(points: number): void {
    if (this.y - points < MARGIN) this.newPage();
  }

  rule(): void {
    this.keep(16);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: MARGIN + WIDTH, y: this.y },
      thickness: 0.6,
      color: RULE,
    });
    this.y -= 14;
  }

  async text(text: string, o: TextOptions = {}): Promise<void> {
    const size = o.size ?? 10.5;
    const style = o.style ?? 'regular';
    const lineHeight = size * (style === 'mono' ? 1.45 : 1.5);
    const indent = o.indent ?? 0;
    const left = MARGIN + indent + (o.bar || o.fill ? 10 : 0);
    const max = WIDTH - (left - MARGIN) - (o.fill ? 8 : 0);
    const space = widthOf(await runs(this.fonts, style, ' '), size);
    for (const [n, paragraph] of text.split('\n').entries()) {
      const words = paragraph.split(/ +/u);
      let line: Run[][] = [];
      let lineWidth = 0;
      const flush = async (first: boolean) => {
        if (this.y - lineHeight < MARGIN) this.newPage();
        const top = this.y;
        this.y -= lineHeight;
        const base = this.y + (lineHeight - size) / 2 + size * 0.2;
        if (o.fill) {
          this.page.drawRectangle({
            x: left - 10,
            y: this.y,
            width: max + 18,
            height: lineHeight,
            color: o.fill,
          });
        }
        if (o.bar) {
          this.page.drawRectangle({
            x: left - 10,
            y: this.y,
            width: 2,
            height: top - this.y,
            color: o.bar,
          });
        }
        if (first && o.bullet) {
          const b = await runs(this.fonts, style, o.bullet);
          let bx = left - widthOf(b, size) - 5;
          for (const r of b) {
            this.page.drawText(r.text, {
              x: bx,
              y: base,
              size,
              font: r.font,
              color: o.color ?? INK,
            });
            bx += r.font.widthOfTextAtSize(r.text, size);
          }
        }
        let x = left;
        for (const [i, word] of line.entries()) {
          if (i > 0) x += space;
          for (const r of word) {
            this.page.drawText(r.text, { x, y: base, size, font: r.font, color: o.color ?? INK });
            x += r.font.widthOfTextAtSize(r.text, size);
          }
        }
        line = [];
        lineWidth = 0;
      };
      let first = n === 0;
      for (const word of words) {
        let rest = word;
        let rs = await runs(this.fonts, style, rest);
        let w = widthOf(rs, size);
        // a word longer than a line (a link, a long number) is cut where it reaches the edge
        while (w > max) {
          if (line.length > 0) {
            await flush(first);
            first = false;
          }
          const chars = Array.from(rest);
          // at least one letter per line, and never the whole rest (it is too wide)
          const fit = Math.floor(chars.length * (max / w));
          const take = Math.max(1, Math.min(chars.length - 1, fit));
          line = [await runs(this.fonts, style, chars.slice(0, take).join(''))];
          await flush(first);
          first = false;
          rest = chars.slice(take).join('');
          rs = await runs(this.fonts, style, rest);
          w = widthOf(rs, size);
        }
        if (w === 0 && word.length === 0 && line.length === 0) continue;
        if (line.length > 0 && lineWidth + space + w > max) {
          await flush(first);
          first = false;
        }
        lineWidth += (line.length > 0 ? space : 0) + w;
        line.push(rs);
      }
      if (line.length > 0 || paragraph.length === 0) {
        await flush(first);
      }
    }
    this.y -= o.after ?? 0;
  }
}

const strip = (line: string) =>
  line
    .replace(/\*\*(.+?)\*\*/gu, '$1')
    .replace(/__(.+?)__/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, '$1 ($2)');

/** An answer's Markdown, drawn simply: headings, lists, quotes, code, paragraphs. */
async function markdown(w: Writer, text: string): Promise<void> {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  let para: string[] = [];
  const flushPara = async () => {
    if (para.length === 0) return;
    await w.text(strip(para.join(' ')), { after: 5 });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      await flushPara();
      const code: string[] = [];
      for (i += 1; i < lines.length && !(lines[i] ?? '').startsWith('```'); i++)
        code.push(lines[i] ?? '');
      await w.text(code.join('\n') || ' ', { style: 'mono', size: 9, fill: CODE_BG, after: 6 });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    if (heading) {
      await flushPara();
      w.keep(40);
      const level = heading[1]?.length ?? 1;
      await w.text(strip(heading[2] ?? ''), {
        style: 'bold',
        size: level <= 1 ? 14 : level === 2 ? 12.5 : 11,
        after: 3,
      });
      continue;
    }
    const bullet = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/u.exec(line);
    if (bullet) {
      await flushPara();
      const depth = Math.min(3, Math.floor((bullet[1]?.length ?? 0) / 2));
      const mark = /\d/u.test(bullet[2] ?? '') ? (bullet[2] ?? '') : '•';
      await w.text(strip(bullet[3] ?? ''), { indent: 14 + depth * 14, bullet: mark, after: 2 });
      continue;
    }
    if (/^>\s?/u.test(line)) {
      await flushPara();
      await w.text(strip(line.replace(/^>\s?/u, '')), { bar: RULE, color: MUTED, after: 2 });
      continue;
    }
    if (/^\|.*\|\s*$/u.test(line)) {
      await flushPara();
      if (/^\|[\s:|-]+\|\s*$/u.test(line)) continue; // the row under a table's header
      await w.text(line, { style: 'mono', size: 8.5, after: 0 });
      continue;
    }
    if (line.trim() === '') {
      await flushPara();
      continue;
    }
    para.push(line.trim());
  }
  await flushPara();
}

async function items(w: Writer, list: ExportModelItem[], heading: string): Promise<void> {
  if (list.length === 0) return;
  w.keep(60);
  await w.text(heading, { style: 'bold', size: 12, after: 6 });
  for (const item of list) {
    w.keep(40);
    await w.text(
      `${item.title} · ${item.owner} · ${item.kind}${item.included ? '' : ' · switched off'}`,
      { style: 'bold', size: 9.5, color: MUTED, after: 2 },
    );
    await w.text(item.text, { size: 9, bar: RULE, after: 8 });
  }
}

async function session(w: Writer, s: ExportModelSession, includeContext: boolean): Promise<void> {
  if (s.name !== null) {
    w.keep(80);
    await w.text(s.name, { style: 'display', size: 17, after: 4 });
    if (s.instructions) {
      await w.text(`Session instructions: ${s.instructions}`, {
        size: 9.5,
        color: MUTED,
        after: 4,
      });
    }
    w.rule();
  }
  if (s.turns.length === 0)
    await w.text('Nothing has been sent here yet.', { color: MUTED, after: 8 });
  for (const t of s.turns) {
    w.keep(90);
    const who =
      t.authors.length > 0 && (t.authors.length > 1 || t.authors[0] !== t.sentBy)
        ? `written by ${t.authors.join(', ')}, sent by ${t.sentBy}`
        : `sent by ${t.sentBy}`;
    await w.text(
      t.comparison ? `${t.label} · the same prompt to ${t.model}` : `${t.label} · ${who}`,
      { style: 'bold', size: 9.5, color: MUTED, after: 3 },
    );
    if (!t.comparison) await w.text(t.prompt, { bar: ACCENT, size: 10.5, after: 6 });
    if (includeContext && (t.instructions || t.context.length > 0)) {
      await w.text(
        [
          t.instructions ? `Instructions: ${t.instructions}` : '',
          t.context.length ? `Context: ${t.context.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('  ·  '),
        { size: 8.5, color: MUTED, after: 4 },
      );
    }
    await markdown(w, t.answer.trim() || '(no answer)');
    await w.text([t.model, t.status].filter(Boolean).join(' · '), {
      size: 8.5,
      color: MUTED,
      after: 14,
    });
  }
  if (includeContext)
    await items(w, s.context, s.name === null ? 'Context items' : 'Session context');
}

/** Makes the PDF. Fonts are fetched through `load`, only the ones the text needs. */
export async function buildPdf(model: ExportModel, load: FontLoader): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // (pdf-lib types its Fontkit after the old fork; the adapter gives it what it calls)
  doc.registerFontkit(fontkitForPdfLib as unknown as Parameters<PDFDocument['registerFontkit']>[0]);
  doc.setTitle(model.roomName);
  doc.setCreator('PromptAlong');
  doc.setProducer('PromptAlong');
  const fonts = new Fonts(doc, load);
  const w = new Writer(doc, fonts);

  await w.text(model.roomName, { style: 'display', size: 22, after: 4 });
  const turns = model.sessions.reduce((n, s) => n + s.turns.length, 0);
  const several = !(model.sessions.length === 1 && model.sessions[0]?.name === null);
  await w.text(
    [
      `Room ${model.code}`,
      several
        ? `${String(model.sessions.length)} ${model.sessions.length === 1 ? 'session' : 'sessions'}`
        : '',
      `${String(turns)} ${turns === 1 ? 'turn' : 'turns'}`,
      `exported ${new Date(model.exportedAt).toISOString().slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join(' · '),
    { size: 9.5, color: MUTED, after: 6 },
  );
  if (model.instructions) {
    await w.text(`Room instructions: ${model.instructions}`, { size: 9.5, after: 4 });
  }
  w.rule();
  if (model.includeContext) await items(w, model.context, 'Room context');

  for (const [i, s] of model.sessions.entries()) {
    if (i > 0 && s.name !== null) w.newPage();
    await session(w, s, model.includeContext);
  }

  // footers: page numbers and the credit line, with a heart drawn as a shape
  const small = (await fonts.get('regular')).pdf;
  const total = w.pages.length;
  for (const [i, page] of w.pages.entries()) {
    const label = `${model.roomName} · ${String(i + 1)} of ${String(total)}`;
    const safe = (await runs(fonts, 'regular', label)).map((r) => r.text).join('');
    page.drawText(safe, { x: MARGIN, y: 30, size: 8, font: small, color: MUTED });
    const by = 'by Shubh and Sidak';
    const made = 'Made with';
    const right = MARGIN + WIDTH;
    const byW = small.widthOfTextAtSize(by, 8);
    const madeW = small.widthOfTextAtSize(made, 8);
    const heartX = right - byW - 3 - 8;
    page.drawText(by, { x: right - byW, y: 30, size: 8, font: small, color: MUTED });
    page.drawSvgPath(
      'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.2 0 3.7 1.2 5.4 3.2 1.7-2 3.2-3.2 5.4-3.2 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z',
      { x: heartX, y: 38.5, scale: 0.32, color: MUTED },
    );
    page.drawText(made, { x: heartX - 3 - madeW, y: 30, size: 8, font: small, color: MUTED });
  }
  return doc.save();
}

/** Every session in its own PDF (for "one PDF per session"). */
export async function buildSessionPdfs(
  model: ExportModel,
  load: FontLoader,
): Promise<{ name: string; bytes: Uint8Array }[]> {
  const out: { name: string; bytes: Uint8Array }[] = [];
  for (const s of model.sessions) {
    out.push({
      name: s.name ?? 'Session',
      bytes: await buildPdf({ ...model, context: model.context, sessions: [s] }, load),
    });
  }
  return out;
}
