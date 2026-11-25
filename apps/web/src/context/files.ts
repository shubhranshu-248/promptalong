import { CONTEXT_MAX_BYTES, cleanContextText } from '@promptalong/core';

/**
 * Reads a context file in the browser (ADR-005): .txt or .md, UTF-8, at most 200 KB. Nothing is
 * uploaded anywhere; the text goes into the room document like a pasted snippet.
 */
export type FileProblem = 'type' | 'too-large' | 'not-text' | 'empty';

export type FileResult =
  { ok: true; title: string; text: string } | { ok: false; problem: FileProblem; message: string };

const EXTENSIONS = /\.(txt|md|markdown)$/iu;

export const FILE_ACCEPT = '.txt,.md,.markdown,text/plain,text/markdown';

export function fileProblemMessage(problem: FileProblem, name: string): string {
  switch (problem) {
    case 'type':
      return `"${name}" is not a .txt or .md file. Only plain text can be added.`;
    case 'too-large':
      return `"${name}" is larger than 200 KB. Trim it, or paste the part that matters.`;
    case 'not-text':
      return `"${name}" is not UTF-8 text.`;
    case 'empty':
      return `"${name}" is empty.`;
  }
}

export async function readContextFile(file: {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}): Promise<FileResult> {
  const fail = (problem: FileProblem): FileResult => ({
    ok: false,
    problem,
    message: fileProblemMessage(problem, file.name),
  });
  if (!EXTENSIONS.test(file.name)) return fail('type');
  // (a byte-order mark may add 3 bytes that are not stored)
  if (file.size > CONTEXT_MAX_BYTES + 3) return fail('too-large');
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    return fail('not-text');
  }
  if (raw.includes('\u0000')) return fail('not-text');
  const text = cleanContextText(raw);
  if (text.trim().length === 0) return fail('empty');
  if (new TextEncoder().encode(text).length > CONTEXT_MAX_BYTES) return fail('too-large');
  return { ok: true, title: file.name, text };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  return `${kb < 10 ? kb.toFixed(1) : String(Math.round(kb))} KB`;
}
