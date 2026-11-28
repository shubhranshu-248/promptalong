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

/** One session of an export: its name (null for a room with one unnamed conversation) and doc. */
export interface ExportSession {
  name: string | null;
  doc: Y.Doc;
}

/**
 * What an export covers: the room document (name, people, room instructions and room context)
 * and the sessions to include, in order. A single Y.Doc is a room with one conversation.
 */
export interface ExportSource {
  room: Y.Doc;
  sessions: ExportSession[];
}

function sourceOf(input: Y.Doc | ExportSource): ExportSource {
  return 'room' in input && 'sessions' in input
    ? input
    : { room: input, sessions: [{ name: null, doc: input }] };
}

function turnsMarkdown(
  out: string[],
  doc: Y.Doc,
  level: string,
  name: (pid: string) => string,
  options: ExportOptions,
): void {
  const labels = turnLabels(doc);
  const turns = conversation(doc);
  if (turns.length === 0) out.push('Nothing has been sent here yet.', '');
  for (const turn of turns) {
    const label = labels.get(turn.id) ?? '';
    out.push(
      `${level} ${label ? `Turn ${label.replace(/^T/u, '')}` : 'Turn'} - sent by ${name(turn.sentBy)}`,
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
      if (turn.systemLine) out.push(`Instructions: ${turn.systemLine}`);
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
}

function itemsMarkdown(
  out: string[],
  items: ReturnType<typeof listContextWithText>,
  heading: string,
  level: string,
  name: (pid: string) => string,
): void {
  if (items.length === 0) return;
  out.push(heading, '');
  for (const item of items) {
    out.push(
      `${level} ${item.title} (${name(item.ownerUid)}, ${item.kind}${item.included ? '' : ', excluded'})`,
      '',
      quote(item.text),
      '',
    );
  }
}

export function exportMarkdown(input: Y.Doc | ExportSource, options: ExportOptions): string {
  const { room, sessions } = sourceOf(input);
  const name = namer(room, options.includeAuthors);
  const settings = readSettings(room);
  const plain = sessions.length === 1 && sessions[0]?.name === null;
  const turnCount = sessions.reduce((n, s) => n + conversation(s.doc).length, 0);
  const out: string[] = [];
  out.push(`# ${settings?.name ?? 'Untitled room'}`, '');
  const parts = [`Room ${formatRoomCode(options.code)}`];
  if (!plain) {
    parts.push(`${String(sessions.length)} ${sessions.length === 1 ? 'session' : 'sessions'}`);
  }
  parts.push(`${String(turnCount)} ${turnCount === 1 ? 'turn' : 'turns'}`);
  parts.push(`exported ${new Date(options.exportedAt).toISOString().slice(0, 10)}`);
  out.push(parts.join(' · '), '');
  if (plain) {
    const only = sessions[0];
    if (only) turnsMarkdown(out, only.doc, '##', name, options);
    if (options.includeContext) {
      itemsMarkdown(out, plainItems(room, only?.doc), '## Context items', '###', name);
    }
    return `${out.join('\n').trimEnd()}\n`;
  }
  if (options.includeContext) {
    const line = readSystemLine(room);
    if (line) out.push(`Room instructions: ${line}`, '');
    itemsMarkdown(out, listContextWithText(room), '## Room context', '###', name);
  }
  for (const session of sessions) {
    out.push(`## ${session.name ?? 'Session'}`, '');
    if (options.includeContext) {
      const line = readSystemLine(session.doc);
      if (line) out.push(`Session instructions: ${line}`, '');
    }
    turnsMarkdown(out, session.doc, '###', name, options);
    if (options.includeContext) {
      itemsMarkdown(out, listContextWithText(session.doc), '### Session context', '####', name);
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

function turnsJson(doc: Y.Doc, name: (pid: string) => string, options: ExportOptions) {
  const labels = turnLabels(doc);
  const person = (pid: string | undefined | null) => (pid ? name(pid) : null);
  return conversation(doc).map((turn) => ({
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
}

/** A room with one conversation: the room's items, then the conversation's own. */
function plainItems(room: Y.Doc, doc: Y.Doc | undefined) {
  return [...listContextWithText(room), ...(doc && doc !== room ? listContextWithText(doc) : [])];
}

function itemsJson(items: ReturnType<typeof listContextWithText>, name: (pid: string) => string) {
  return items.map((item) => ({
    title: item.title,
    kind: item.kind,
    owner: name(item.ownerUid),
    included: item.included,
    text: item.text,
  }));
}

export function exportJson(input: Y.Doc | ExportSource, options: ExportOptions): string {
  const { room, sessions } = sourceOf(input);
  const name = namer(room, options.includeAuthors);
  const settings = readSettings(room);
  const plain = sessions.length === 1 && sessions[0]?.name === null;
  const head = {
    app: 'PromptAlong',
    format: plain ? 1 : 2,
    exportedAt: new Date(options.exportedAt).toISOString(),
    room: { name: settings?.name ?? 'Untitled room', code: options.code },
    authorNames: options.includeAuthors,
  };
  const context = (doc: Y.Doc, key: 'roomLine' | 'instructions') =>
    options.includeContext
      ? {
          [key]: readSystemLine(doc) || null,
          contextItems: itemsJson(listContextWithText(doc), name),
        }
      : {};
  const only = sessions[0];
  const record = plain
    ? {
        ...head,
        turns: only ? turnsJson(only.doc, name, options) : [],
        ...(options.includeContext
          ? {
              roomLine:
                [readSystemLine(room), only && only.doc !== room ? readSystemLine(only.doc) : '']
                  .filter(Boolean)
                  .join('\n\n') || null,
              contextItems: itemsJson(plainItems(room, only?.doc), name),
            }
          : {}),
      }
    : {
        ...head,
        ...context(room, 'instructions'),
        sessions: sessions.map((s) => ({
          name: s.name ?? 'Session',
          ...context(s.doc, 'instructions'),
          turns: turnsJson(s.doc, name, options),
        })),
      };
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** An export as data: what a PDF or a printed page draws. Names are resolved already. */
export interface ExportModelTurn {
  label: string;
  sentBy: string;
  authors: string[];
  prompt: string;
  answer: string;
  model: string;
  status: string | null;
  /** the instructions and context titles the turn was sent with (when context is included) */
  instructions: string;
  context: string[];
  /** a second model's answer to the turn before (shown next to it) */
  comparison: boolean;
}

export interface ExportModelItem {
  title: string;
  owner: string;
  kind: string;
  included: boolean;
  text: string;
}

export interface ExportModelSession {
  name: string | null;
  instructions: string;
  context: ExportModelItem[];
  turns: ExportModelTurn[];
}

export interface ExportModel {
  roomName: string;
  code: string;
  exportedAt: number;
  instructions: string;
  context: ExportModelItem[];
  sessions: ExportModelSession[];
  includeContext: boolean;
}

export function exportModel(input: Y.Doc | ExportSource, options: ExportOptions): ExportModel {
  const { room, sessions } = sourceOf(input);
  const name = namer(room, options.includeAuthors);
  const items = (list: ReturnType<typeof listContextWithText>): ExportModelItem[] =>
    options.includeContext
      ? list.map((i) => ({
          title: i.title,
          owner: name(i.ownerUid),
          kind: i.kind,
          included: i.included,
          text: i.text,
        }))
      : [];
  const plain = sessions.length === 1 && sessions[0]?.name === null;
  return {
    roomName: readSettings(room)?.name ?? 'Untitled room',
    code: formatRoomCode(options.code),
    exportedAt: options.exportedAt,
    instructions: options.includeContext ? readSystemLine(room) : '',
    context: plain ? [] : items(listContextWithText(room)),
    includeContext: options.includeContext,
    sessions: sessions.map((s) => {
      const labels = turnLabels(s.doc);
      return {
        name: s.name,
        instructions: options.includeContext && s.doc !== room ? readSystemLine(s.doc) : '',
        context: plain ? items(plainItems(room, s.doc)) : items(listContextWithText(s.doc)),
        turns: conversation(s.doc).map((t) => ({
          label: labels.get(t.id) ?? '',
          sentBy: name(t.sentBy),
          authors: promptAuthors(t).map(name),
          prompt: t.prompt.text,
          answer: t.answer,
          model: t.provider.label,
          status: statusLine(t, name),
          instructions: options.includeContext ? t.systemLine : '',
          context: options.includeContext
            ? t.context.map((c) => `${c.title} (${name(c.ownerUid)})`)
            : [],
          comparison: t.compareOf !== undefined,
        })),
      };
    }),
  };
}

/** A file name for the download: room name and date. */
export function exportFileName(roomName: string, at: number, ext: string): string {
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 40);
  return `${slug(roomName) || 'room'}-${new Date(at).toISOString().slice(0, 10)}.${ext}`;
}
