import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { ExportModel } from '@promptalong/core';
import { PDFDocument } from 'pdf-lib';
import { buildPdf, buildSessionPdfs, hasDevanagari, type FontName } from './pdf';

const require = createRequire(import.meta.url);
const FILES: Record<FontName, string> = {
  regular: '@fontsource/inter/files/inter-latin-400-normal.woff',
  regularExt: '@fontsource/inter/files/inter-latin-ext-400-normal.woff',
  bold: '@fontsource/inter/files/inter-latin-700-normal.woff',
  boldExt: '@fontsource/inter/files/inter-latin-ext-700-normal.woff',
  deva: '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff',
  devaBold:
    '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff',
  mono: '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff',
  display: '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff',
};

function loader() {
  const loaded: FontName[] = [];
  const load = (name: FontName) => {
    loaded.push(name);
    return Promise.resolve(new Uint8Array(readFileSync(require.resolve(FILES[name]))));
  };
  return { load, loaded };
}

const model = (answer: string, sessions = 1): ExportModel => ({
  roomName: 'Hackathon pitch',
  code: 'K7Q-M2X',
  exportedAt: Date.UTC(2026, 10, 27),
  instructions: 'Be brief.',
  context: [
    { title: 'Brief', owner: 'Aarav', kind: 'note', included: true, text: 'Lost and found.' },
  ],
  includeContext: true,
  sessions: Array.from({ length: sessions }, (_, i) => ({
    name: sessions === 1 ? null : `Session ${String(i + 1)}`,
    instructions: '',
    context: [],
    turns: [
      {
        label: 'T1',
        sentBy: 'Meera',
        authors: ['Aarav', 'Meera'],
        prompt: 'Write a pitch',
        answer,
        model: 'Demo model',
        status: null,
        instructions: 'Be brief.',
        context: ['Brief (Aarav)'],
        comparison: false,
      },
    ],
  })),
});

describe('PDF export', () => {
  it('a valid PDF; long answers flow onto more pages; Hindi fonts only when needed', async () => {
    const { load, loaded } = loader();
    const long = Array.from({ length: 120 }, (_, i) => `- point ${String(i)} – “quoted” text`).join(
      '\n',
    );
    const bytes = await buildPdf(model(`# Plan\n\n${long}\n\n\`\`\`\nconst x = 1;\n\`\`\``), load);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pdf.getTitle()).toBe('Hackathon pitch');
    expect(loaded).not.toContain('deva');
    expect(new Set(loaded).has('mono')).toBe(true);
  });

  it('Hindi text is set in the Devanagari font', async () => {
    const { load, loaded } = loader();
    const bytes = await buildPdf(model('नमस्ते दोस्तों, यह हिन्दी में उत्तर है।'), load);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(loaded).toContain('deva');
    expect(hasDevanagari('abc')).toBe(false);
    expect(hasDevanagari('क')).toBe(true);
  });

  it('one PDF per session', async () => {
    const { load } = loader();
    const files = await buildSessionPdfs(model('Short.', 3), load);
    expect(files.map((f) => f.name)).toEqual(['Session 1', 'Session 2', 'Session 3']);
    for (const f of files) expect((await PDFDocument.load(f.bytes)).getPageCount()).toBe(1);
  });

  it('a word far longer than a line is cut over several lines', async () => {
    const { load } = loader();
    const bytes = await buildPdf(model(`https://example.com/${'a'.repeat(900)}`), load);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it('characters no font has (emoji) do not break the PDF', async () => {
    const { load } = loader();
    const bytes = await buildPdf(model('Done 🎉 — 完成'), load);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
