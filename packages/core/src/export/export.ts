import type * as Y from 'yjs';
import { conversation, turnLabels } from '../history/history';
import { listContextWithText, readSystemLine } from '../context/context';
import { peopleMap, readSettings } from '../room/doc';
import { formatRoomCode } from '../room-code';
import type { TurnView } from '../turns/turns';

/**
 * Export (8.8): the conversation as Markdown (readable) or JSON (the full record: prompt segments
 * with authors, context, model, timestamps). Built in the browser from the room document. A room
 * document never holds a model key, so an export cannot contain one.
 */
export interface ExportOptions {
  /** the context each turn used, and the room's context items with their text */
  includeContext: boolean;
  /** real display names; when off, people become "Person 1", "Person 2"... */
  includeAuthors: boolean;
  code: string;
  exportedAt: number;
}

function namer(doc: Y.Doc, includeAuthors: boolean): (pid: string) => string {
  const names = new Map<string, string>();
  peopleMap(doc).forEach((rec, pid) => {
    if (typeof rec === 'object' && typeof rec.name === 'string') names.set(pid, rec.name);
  });
  const anonymous = new Map<string, string>();
  return (pid) => {
    if (includeAuthors) return names.get(pid) ?? 'someone';
    let label = anonymous.get(pid);
    if (!label) {
      label = `Person ${String(anonymous.size + 1)}`;
      anonymous.set(pid, label);
    }
    return label;
  };
}

/** The authors of a prompt in the order they first appear. */
function promptAuthors(turn: TurnView): string[] {
  const seen: string[] = [];
  for (const span of turn.prompt.spans) if (!seen.includes(span.uid)) seen.push(span.uid);
  return seen;
}

function statusLine(turn: TurnView, name: (pid: string) => string): string | null {
  switch (turn.status) {
    case 'done':
      return null;
    case 'streaming':
      return 'Status: still streaming when this was exported';
    case 'stopped':
      return `Status: stopped${turn.stoppedBy ? ` by ${name(turn.stoppedBy)}` : ''}`;
    case 'interrupted':
      return 'Status: interrupted (the sender left before the answer finished)';
    case 'failed':
      return `Status: failed${turn.error ? ` - ${turn.error.message}` : ''}`;
  }
}

const quote = (text: string) =>
  text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');

export function exportMarkdown(doc: Y.Doc, options: ExportOptions): string {
  const name = namer(doc, options.includeAuthors);
  const labels = turnLabels(doc);
  const turns = conversation(doc);
  const settings = readSettings(doc);
  const out: string[] = [];
  out.push(`# ${settings?.name ?? 'Untitled room'}`, '');
  out.push(
    `Room ${formatRoomCode(options.code)} · ${String(turns.length)} ${turns.length === 1 ? 'turn' : 'turns'} · exported ${new Date(options.exportedAt).toISOString().slice(0, 10)}`,
    '',
  );
  if (turns.length === 0) out.push('Nothing has been sent in this room yet.', '');
  for (const turn of turns) {
    const label = labels.get(turn.id) ?? '';
    out.push(
      `## ${label ? `Turn ${label.replace(/^T/u, '')}` : 'Turn'} - sent by ${name(turn.sentBy)}`,
      '',
    );
    const authors = promptAuthors(turn).map(name);
    out.push(
      `**Prompt**${authors.length > 0 ? ` (${authors.join(', ')})` : ''}`,
      '',
      quote(turn.prompt.text),
      '',
    );
    if (options.includeContext) {
      if (turn.systemLine) out.push(`Room line: ${turn.systemLine}`);
      if (turn.context.length > 0) {
        out.push(
          `Context: ${turn.context.map((c) => `${c.title} (${name(c.ownerUid)})`).join(', ')}`,
        );
      }
    }
    const usage = turn.usage
      ? ` · ${turn.usage.input.toLocaleString('en-US')} tokens in, ${turn.usage.output.toLocaleString('en-US')} out`
      : '';
    out.push(`Model: ${turn.provider.label}${usage}`);
    const status = statusLine(turn, name);
    if (status) out.push(status);
    out.push('', turn.answer.trim() || '(no answer)', '');
  }
  if (options.includeContext) {
    const items = listContextWithText(doc);
    if (items.length > 0) {
      out.push('## Context items', '');
      for (const item of items) {
        out.push(
          `### ${item.title} (${name(item.ownerUid)}, ${item.kind}${item.included ? '' : ', excluded'})`,
          '',
          quote(item.text),
          '',
        );
      }
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

export function exportJson(doc: Y.Doc, options: ExportOptions): string {
  const name = namer(doc, options.includeAuthors);
  const labels = turnLabels(doc);
  const settings = readSettings(doc);
  const person = (pid: string | undefined | null) => (pid ? name(pid) : null);
  const turns = conversation(doc).map((turn) => ({
    label: labels.get(turn.id) ?? null,
    id: turn.id,
    parentId: turn.parentId,
    sentAt: new Date(turn.createdAt).toISOString(),
    sentBy: name(turn.sentBy),
    prompt: {
      text: turn.prompt.text,
      segments: turn.prompt.spans.map((s) => ({
        from: s.from,
        to: s.to,
        text: turn.prompt.text.slice(s.from, s.to),
        author: name(s.uid),
      })),
    },
    ...(options.includeContext
      ? {
          roomLine: turn.systemLine || null,
          context: turn.context.map((c) => ({
            title: c.title,
            kind: c.kind,
            owner: name(c.ownerUid),
            bytes: c.bytes,
            tokens: c.tokens,
            tokensExact: c.exact,
            sha256: c.hash || null,
          })),
        }
      : {}),
    model: {
      kind: turn.provider.kind,
      model: turn.provider.model,
      label: turn.provider.label,
      ...(turn.provider.endpoint ? { endpoint: turn.provider.endpoint } : {}),
    },
    requestSha256: turn.requestHash || null,
    status: turn.status,
    ...(turn.stoppedBy ? { stoppedBy: person(turn.stoppedBy) } : {}),
    ...(turn.error ? { error: turn.error.message } : {}),
    answer: turn.answer,
    usage: turn.usage ?? null,
    durationMs: turn.durationMs ?? null,
  }));
  const record = {
    app: 'PromptAlong',
    format: 1,
    exportedAt: new Date(options.exportedAt).toISOString(),
    room: { name: settings?.name ?? 'Untitled room', code: options.code },
    authorNames: options.includeAuthors,
    turns,
    ...(options.includeContext
      ? {
          roomLine: readSystemLine(doc) || null,
          contextItems: listContextWithText(doc).map((item) => ({
            title: item.title,
            kind: item.kind,
            owner: name(item.ownerUid),
            included: item.included,
            text: item.text,
          })),
        }
      : {}),
  };
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** A file name for the download: room name and date. */
export function exportFileName(roomName: string, at: number, ext: 'md' | 'json'): string {
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 40);
  return `${slug(roomName) || 'room'}-${new Date(at).toISOString().slice(0, 10)}.${ext}`;
}
