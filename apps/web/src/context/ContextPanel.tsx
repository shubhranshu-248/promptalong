import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  CONTEXT_MAX_ITEMS,
  addContextItem,
  removeContextItem,
  setContextIncluded,
  setRoomItemIncluded,
  setSystemLine,
  sha256Hex,
  updateContextItem,
  type BudgetView,
  type ContextItemView,
  type ContextKind,
  type Segment,
} from '@promptalong/core';
import { modelLabel } from '@promptalong/providers';
import { Button, cx, initials, presenceHex } from '@promptalong/ui';
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { authorName, type Roster } from '../room/authors';
import { buildBody } from '../room/send';
import type { RoomSession, RoomSnapshot } from '../room/session';
import type { SessionConn, SessionSnapshot } from '../room/session-conn';
import { ItemDialog, RemoveItemDialog, SystemLineDialog, type ItemDialogMode } from './dialogs';
import { FILE_ACCEPT, formatBytes, readContextFile } from './files';
import type { ContextBudget } from './useContextBudget';

export type PanelTab = 'context' | 'payload';

const n = (value: number) => value.toLocaleString('en-US');

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2 flex-none rounded-full"
      style={{ background: color }}
    />
  );
}

/** Used / budget with one segment for prompt + history and one per person's context. */
export function BudgetBar({
  budget,
  exact,
  roster,
  me,
  model,
  tall,
}: {
  budget: BudgetView;
  exact: boolean;
  roster: Roster;
  me: string;
  model: string;
  tall?: boolean;
}) {
  const scale = Math.max(budget.limit, budget.used, 1);
  const width = (tokens: number) => `${String((tokens / scale) * 100)}%`;
  const over = budget.over > 0;
  return (
    <section aria-label="Token budget" data-testid="budget" data-over={over ? 'true' : 'false'}>
      <p className="flex items-baseline justify-between gap-3 text-sm">
        <b>Token budget{tall ? ` · ${model}` : ''}</b>
        <span
          className={cx('font-mono', over && 'font-semibold text-danger')}
          data-testid="budget-numbers"
        >
          {exact ? '' : 'about '}
          {n(budget.used)} / {n(budget.limit)}
        </span>
      </p>
      <div
        role="img"
        aria-label={`${exact ? '' : 'About '}${n(budget.used)} of ${n(budget.limit)} tokens used${over ? `, ${n(budget.over)} too many` : ''}`}
        className={cx(
          'mt-2 flex overflow-hidden rounded-pill bg-surface-2',
          tall ? 'h-3' : 'h-1.5',
          over && 'outline-2 outline-offset-1 outline-danger',
        )}
      >
        <span style={{ width: width(budget.base), background: 'var(--c-text)' }} />
        {budget.owners.map((o) => (
          <span
            key={o.uid}
            style={{
              width: width(o.tokens),
              background: presenceHex(roster[o.uid]?.slot ?? 1).color,
            }}
          />
        ))}
      </div>
      <ul
        className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted"
        data-testid="budget-legend"
      >
        <li className="flex items-center gap-1.5">
          <Dot color="var(--c-text)" />
          prompt + history {n(budget.base)}
        </li>
        {budget.owners.map((o) => (
          <li key={o.uid} className="flex items-center gap-1.5">
            <Dot color={presenceHex(roster[o.uid]?.slot ?? 1).color} />
            {authorName(roster, o.uid, me) === 'you' ? 'You' : authorName(roster, o.uid)}{' '}
            {n(o.tokens)}
          </li>
        ))}
      </ul>
      {over ? (
        <p
          className="mt-2 rounded-md bg-warning-bg px-3 py-2 text-xs text-warning-text"
          role="status"
        >
          <b>This does not fit.</b> Remove about {n(budget.over)} tokens: exclude an item or shorten
          the prompt. Nothing is dropped for you.
        </p>
      ) : null}
      <p className="mt-1.5 text-xs text-text-muted">
        {exact
          ? "Counted in your browser with this model's own tokenizer."
          : 'Counted in your browser. Marked "about" because this model has no public tokenizer.'}{' '}
        {n(budget.contextWindow)} window, {n(budget.reserve)} kept for the answer.
      </p>
    </section>
  );
}

function ItemCard({
  item,
  tokens,
  roster,
  me,
  canEdit,
  canRemove,
  removeLabel,
  onToggle,
  onOpen,
  onRemove,
}: {
  item: ContextItemView;
  tokens: number;
  roster: Roster;
  me: string;
  canEdit: boolean;
  canRemove: boolean;
  removeLabel: string;
  onToggle: (included: boolean) => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const owner = roster[item.ownerUid];
  const colors = presenceHex(owner?.slot ?? 1);
  const ownerName = authorName(roster, item.ownerUid, me);
  const menuItem =
    'flex cursor-default items-center rounded-md px-3 py-2.5 text-sm font-medium outline-none data-[highlighted]:bg-surface-2';
  return (
    <li
      className={cx(
        'rounded-lg border p-3.5',
        item.included
          ? 'border-border bg-surface shadow-sm'
          : 'border-dashed border-border-strong bg-surface-sunken',
      )}
      data-testid="context-item"
      data-item={item.id}
      data-included={item.included ? 'true' : 'false'}
    >
      <div className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={item.included}
          aria-label={`Include ${item.title}`}
          onChange={(e) => {
            onToggle(e.target.checked);
          }}
          className="size-[18px] flex-none accent-[var(--c-accent)]"
        />
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline"
        >
          {item.title}
        </button>
        <span className="flex-none font-mono text-xs text-text-muted" data-testid="item-tokens">
          {item.included ? n(tokens) : `(${n(tokens)})`}
        </span>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`More for ${item.title}`}
              className="w-10 px-0"
            >
              ⋯
            </Button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              align="end"
              sideOffset={4}
              className="z-[40] w-[200px] rounded-lg border border-border bg-surface p-1.5 text-text shadow-lg"
            >
              <Menu.Item className={menuItem} onSelect={onOpen}>
                {canEdit ? 'View or edit' : 'View'}
              </Menu.Item>
              {canRemove ? (
                <Menu.Item className={cx(menuItem, 'text-danger')} onSelect={onRemove}>
                  {removeLabel}
                </Menu.Item>
              ) : null}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 pl-7 text-xs text-text-muted">
        <span
          aria-hidden="true"
          className="inline-grid size-[18px] flex-none place-items-center rounded-full text-[8px] font-bold"
          style={{ background: colors.color, color: colors.label }}
        >
          {initials(owner?.name ?? '?')}
        </span>
        <span>
          {ownerName === 'you' ? 'You' : ownerName} · {item.kind} · {formatBytes(item.bytes)}
          {!item.included
            ? ` · excluded${item.toggledBy ? ` by ${authorName(roster, item.toggledBy, me)}` : ''}`
            : ''}
        </span>
      </p>
    </li>
  );
}

type Scope = 'session' | 'room';

/** The item list with the add zone: the room's files (every session) and this session's own. */
export function ContextList({
  session,
  snap,
  conn,
  ss,
  data,
}: {
  session: RoomSession;
  snap: RoomSnapshot;
  conn: SessionConn;
  ss: SessionSnapshot;
  data: ContextBudget;
}) {
  const me = snap.me.pid;
  const iAmHost = snap.settings?.hostPid === me;
  const [scope, setScope] = useState<Scope>('session');
  const [dialog, setDialog] = useState<(ItemDialogMode & { scope: Scope }) | null>(null);
  const [removing, setRemoving] = useState<(ContextItemView & { scope: Scope }) | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const docFor = (s: Scope) => (s === 'room' ? session.doc : conn.doc);
  const itemsFor = (s: Scope) => (s === 'room' ? snap.context : ss.context);
  const full = itemsFor(scope).length >= CONTEXT_MAX_ITEMS;
  const roomItems = snap.context.map((i) => ({
    ...i,
    included: !ss.roomContextOff.includes(i.id),
    toggledBy: null,
  }));

  const add = (
    kind: ContextKind,
    title: string,
    text: string,
    to: Scope = scope,
  ): string | null => {
    const result = addContextItem(docFor(to), {
      id: crypto.randomUUID(),
      ownerUid: me,
      kind,
      title,
      text,
      createdAt: Date.now(),
    });
    if (result.ok) return null;
    const where = to === 'room' ? 'The room' : 'A session';
    return result.reason === 'too-large'
      ? 'That is larger than 1 MB. Trim it, or add the part that matters.'
      : result.reason === 'room-full'
        ? `${where} holds up to ${String(CONTEXT_MAX_ITEMS)} context items. Remove one first.`
        : result.reason === 'room-size'
          ? `${where} already holds 6 MB of context. Remove an item first.`
          : 'There is no text to add.';
  };

  const addFiles = async (files: readonly File[]) => {
    const problems: string[] = [];
    for (const file of files.slice(0, CONTEXT_MAX_ITEMS)) {
      const read = await readContextFile(file);
      const failed = read.ok ? add('file', read.title, read.text) : read.message;
      if (failed) problems.push(read.ok ? `"${file.name}": ${failed}` : failed);
    }
    setProblem(problems.length > 0 ? problems.join(' ') : null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void addFiles([...e.dataTransfer.files]);
  };

  const card = (item: ContextItemView, s: Scope) => (
    <ItemCard
      key={item.id}
      item={item}
      tokens={data.itemTokens[item.id] ?? 0}
      roster={snap.roster}
      me={me}
      canEdit={item.ownerUid === me}
      canRemove={item.ownerUid === me || iAmHost}
      removeLabel={s === 'room' ? 'Remove from the room…' : 'Remove from this session…'}
      onToggle={(included) => {
        if (s === 'room') setRoomItemIncluded(conn.doc, item.id, included);
        else setContextIncluded(conn.doc, item.id, included, me);
      }}
      onOpen={() => {
        setDialog({ type: item.ownerUid === me ? 'edit' : 'view', item, scope: s });
      }}
      onRemove={() => {
        setRemoving({ ...item, scope: s });
      }}
    />
  );

  const group = (title: string, hint: string, testId: string, cards: ReactNode[]) =>
    cards.length > 0 ? (
      <section aria-label={title} className="flex flex-col gap-2" data-testid={testId}>
        <h3 className="text-xs font-semibold text-text-muted">
          {title} <span className="font-normal">· {hint}</span>
        </h3>
        <ul className="flex flex-col gap-3">{cards}</ul>
      </section>
    ) : null;

  const empty = roomItems.length === 0 && ss.context.length === 0;

  return (
    <div
      className="flex flex-col gap-4"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      {empty ? (
        <p className="text-sm text-text-muted" data-testid="context-empty">
          Nothing is attached yet. Whatever you add is sent to the model before the prompt. Add it
          to this session, or to the whole room so every session gets it.
        </p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="context-items">
          {group(
            'Whole room',
            'every session gets these; switch one off for this session only',
            'context-room',
            roomItems.map((i) => card(i, 'room')),
          )}
          {group(
            'This session',
            'only this session sends these',
            'context-session',
            ss.context.map((i) => card(i, 'session')),
          )}
        </div>
      )}
      <div
        className={cx(
          'rounded-lg border-[1.5px] border-dashed p-4 text-center',
          dragging ? 'border-accent bg-accent-soft' : 'border-border-strong',
        )}
        data-testid="context-add"
      >
        <div
          role="radiogroup"
          aria-label="Add context to"
          className="mx-auto mb-3 inline-flex rounded-pill bg-surface-2 p-0.5 text-xs font-medium"
        >
          {(['session', 'room'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={scope === s}
              data-testid={`context-scope-${s}`}
              onClick={() => {
                setScope(s);
              }}
              className={cx(
                'rounded-pill px-3 py-1.5',
                scope === s ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
              )}
            >
              {s === 'session' ? 'This session' : 'Whole room'}
            </button>
          ))}
        </div>
        <p className="text-sm font-semibold">
          {scope === 'room' ? 'Add context for every session' : 'Add context for this session'}
        </p>
        <p className="mt-0.5 text-xs text-text-muted">Or drop a .txt or .md file here</p>
        <p className="mt-1 text-xs text-text-muted">
          Text only, up to 1 MB each. {itemsFor(scope).length} of {CONTEXT_MAX_ITEMS} used.
        </p>
        <div className="mt-2.5 flex flex-wrap justify-center gap-2">
          <Button
            size="sm"
            disabled={full}
            onClick={() => {
              setDialog({ type: 'add', kind: 'note', to: scope, scope });
            }}
          >
            Add note
          </Button>
          <Button
            size="sm"
            disabled={full}
            onClick={() => {
              setDialog({ type: 'add', kind: 'snippet', to: scope, scope });
            }}
          >
            Paste snippet
          </Button>
          <Button
            size="sm"
            disabled={full}
            onClick={() => {
              fileInput.current?.click();
            }}
          >
            Upload file
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={FILE_ACCEPT}
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-label="Upload a .txt or .md file"
            data-testid="context-file"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              void addFiles(files);
            }}
          />
        </div>
        {problem ? (
          <p className="mt-2.5 text-xs text-danger" role="alert" data-testid="context-problem">
            {problem}
          </p>
        ) : null}
      </div>
      <ItemDialog
        mode={dialog}
        doc={docFor(dialog?.scope ?? scope)}
        onClose={() => {
          setDialog(null);
        }}
        onAdd={(kind, title, text) => add(kind, title, text, dialog?.scope ?? scope)}
        onSave={(id, title, text) => {
          const result = updateContextItem(docFor(dialog?.scope ?? scope), id, { title, text });
          return result === 'ok'
            ? null
            : result === 'too-large'
              ? 'That is larger than 1 MB, or it would pass 6 MB of context.'
              : result === 'empty'
                ? 'There is no text to save.'
                : 'This item was removed by someone else.';
        }}
      />
      <RemoveItemDialog
        item={removing}
        onClose={() => {
          setRemoving(null);
        }}
        onRemove={(id) => {
          removeContextItem(docFor(removing?.scope ?? 'session'), id);
        }}
      />
    </div>
  );
}

const CLIP = 320;

function clip(text: string): { shown: string; more: number } {
  return text.length > CLIP
    ? { shown: text.slice(0, CLIP), more: text.length - CLIP }
    : { shown: text, more: 0 };
}

function SegmentBlock({
  color,
  label,
  text,
  testId,
}: {
  color: string;
  label?: string;
  text: string;
  testId: string;
}) {
  const { shown, more } = clip(text);
  return (
    <div className="border-l-[3px] pl-2.5" style={{ borderColor: color }} data-testid={testId}>
      {label ? <span className="text-text-muted select-none">{label} </span> : null}
      {shown}
      {more > 0 ? (
        <span className="text-text-muted select-none"> … {n(more)} more characters</span>
      ) : null}
    </div>
  );
}

/** The request as Send will post it: readable segments, or the exact string. */
function LineRow({
  label,
  line,
  empty,
  testId,
  onEdit,
}: {
  label: string;
  line: string;
  empty: string;
  testId: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate text-text-muted" data-testid={testId}>
        {line ? (
          <>
            {label}: <span className="text-text">{line}</span>
          </>
        ) : (
          empty
        )}
      </span>
      <Button size="sm" onClick={onEdit}>
        {line ? 'Edit' : 'Add'} <span className="sr-only">{label.toLowerCase()}</span>
      </Button>
    </div>
  );
}

export function PayloadView({
  session,
  snap,
  conn,
  ss,
  data,
}: {
  session: RoomSession;
  snap: RoomSnapshot;
  conn: SessionConn;
  ss: SessionSnapshot;
  data: ContextBudget;
}) {
  const [json, setJson] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lineOpen, setLineOpen] = useState<'room' | 'session' | null>(null);
  const { assembled } = data;
  const body = useMemo(() => buildBody(ss.model, assembled.messages), [ss.model, assembled]);
  const [hashed, setHashed] = useState<{ body: string; hash: string } | null>(null);
  useEffect(() => {
    let live = true;
    void sha256Hex(body).then((hash) => {
      if (live) setHashed({ body, hash });
    });
    return () => {
      live = false;
    };
  }, [body]);
  // while the prompt is being typed the view is a moment behind: no hash until it has caught up
  const hash = !data.stale && hashed?.body === body ? hashed.hash : '';

  const last = [...ss.path].reverse().find((t) => t.requestHash);
  const lastLabel = last ? (ss.labels[last.id] ?? '') : '';
  const nextLabel = `T${String(ss.path.length + 1)}`;
  const history = assembled.segments.filter((s) => s.kind === 'history');
  const historyTurns = [...new Set(history.map((s) => s.turnId ?? ''))];
  const historyTokens = history.reduce(
    (a, s) => a + (data.tokensFor(s.text)?.tokens ?? Math.round(s.text.length / 4)),
    0,
  );
  const promptText = assembled.segments.find((s) => s.kind === 'prompt')?.text ?? '';
  const short = (h: string) => `${h.slice(0, 4)}…${h.slice(-4)}`;
  const big = body.length > 200_000;

  const segment = (s: Segment, i: number): ReactNode => {
    if (s.kind === 'system')
      return (
        <SegmentBlock
          key={i}
          color="var(--c-text)"
          label="system:"
          text={s.text}
          testId="seg-system"
        />
      );
    if (s.kind === 'context')
      return (
        <SegmentBlock
          key={i}
          color={presenceHex(snap.roster[s.ownerUid ?? '']?.slot ?? 1).color}
          text={s.text}
          testId="seg-context"
        />
      );
    return null;
  };

  return (
    <div
      className="flex min-h-0 flex-col gap-3"
      data-testid="payload"
      aria-busy={data.stale || hash === ''}
    >
      <div className="flex flex-wrap items-center gap-2">
        <b className="mr-auto text-sm">Exact request body</b>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(body).then(
              () => {
                setCopied(true);
                setTimeout(() => {
                  setCopied(false);
                }, 2000);
              },
              () => undefined,
            );
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <div className="flex rounded-md bg-surface-2 p-1" role="group" aria-label="Payload view">
          {(['Text', 'JSON'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={json === (v === 'JSON')}
              onClick={() => {
                setJson(v === 'JSON');
              }}
              className={cx(
                'h-8 rounded-sm px-2.5 text-xs font-semibold',
                json === (v === 'JSON') ? 'bg-surface text-text shadow-sm' : 'text-text-muted',
              )}
              data-testid={`payload-${v.toLowerCase()}-button`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <p className="rounded-md bg-accent-soft px-3 py-2.5 text-xs">
        Byte-for-byte what Send will post. No hidden system prompt is added. Model keys are never
        part of the payload.
      </p>
      <LineRow
        label="Room instructions"
        line={snap.systemLine}
        empty="No room instructions. Add them to tell the model what this room is for."
        testId="room-line"
        onEdit={() => {
          setLineOpen('room');
        }}
      />
      <LineRow
        label="Session instructions"
        line={ss.systemLine}
        empty="No session instructions."
        testId="session-line"
        onEdit={() => {
          setLineOpen('session');
        }}
      />
      {json ? (
        <pre
          className="max-h-[52vh] min-h-24 overflow-auto rounded-md border border-border bg-code-bg p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap"
          data-testid="payload-json"
          tabIndex={0}
          aria-label="Exact request body as JSON"
        >
          {big ? body.slice(0, 200_000) : body}
        </pre>
      ) : (
        <div
          className="flex max-h-[52vh] min-h-24 flex-col gap-2.5 overflow-auto rounded-md border border-border bg-code-bg p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
          data-testid="payload-text"
          tabIndex={0}
          role="group"
          aria-label="Request body by source"
        >
          {assembled.segments.map(segment)}
          {historyTurns.length > 0 ? (
            <details className="border-l-[3px] border-text pl-2.5" data-testid="seg-history">
              <summary className="cursor-pointer">
                history ({historyTurns.map((id) => ss.labels[id] ?? '?').join(', ')} + answers) …{' '}
                {n(historyTokens)} tokens
              </summary>
              {history.map((s, i) => (
                <p key={i} className="mt-1.5">
                  <span className="text-text-muted select-none">{s.role}: </span>
                  {clip(s.text).shown}
                  {clip(s.text).more > 0 ? '…' : ''}
                </p>
              ))}
            </details>
          ) : null}
          <SegmentBlock
            color="var(--c-accent)"
            label={`user (${nextLabel}):`}
            text={promptText.length > 0 ? promptText : '(the shared prompt is empty)'}
            testId="seg-prompt"
          />
        </div>
      )}
      {big && json ? (
        <p className="text-xs text-text-muted">
          Showing the first 200,000 of {n(body.length)} characters. Copy gives all of it.
        </p>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
        <span>Hash</span>
        <span className="font-mono" title={hash} data-testid="payload-hash" data-hash={hash}>
          sha256 · {hash ? short(hash) : 'updating…'}
        </span>
        <span className="ml-auto" data-testid="payload-last" data-hash={last?.requestHash ?? ''}>
          {last
            ? last.requestHash === hash
              ? 'matches the last sent request'
              : `last sent (${lastLabel}): ${short(last.requestHash)}`
            : 'nothing sent yet'}
        </span>
      </p>
      <p className="text-xs text-text-muted">
        {n(new TextEncoder().encode(body).length)} bytes · {assembled.messages.length}{' '}
        {assembled.messages.length === 1 ? 'message' : 'messages'} · {assembled.items.length}{' '}
        context {assembled.items.length === 1 ? 'item' : 'items'}
      </p>
      <SystemLineDialog
        open={lineOpen === 'room'}
        onOpenChange={(o) => {
          setLineOpen(o ? 'room' : null);
        }}
        current={snap.systemLine}
        onSave={(line) => {
          setSystemLine(session.doc, line, snap.me.pid);
        }}
      />
      <SystemLineDialog
        scope="session"
        open={lineOpen === 'session'}
        onOpenChange={(o) => {
          setLineOpen(o ? 'session' : null);
        }}
        current={ss.systemLine}
        onSave={(line) => {
          setSystemLine(conn.doc, line, snap.me.pid);
        }}
      />
    </div>
  );
}

/** The context drawer: what the room attaches, and the exact request Send will post. */
export function ContextPanel({
  session,
  snap,
  conn,
  ss,
  data,
  tab,
  onTab,
  onClose,
}: {
  session: RoomSession;
  snap: RoomSnapshot;
  conn: SessionConn;
  ss: SessionSnapshot;
  data: ContextBudget;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
}) {
  const tabs: PanelTab[] = ['context', 'payload'];
  const total = snap.context.length + ss.context.length;
  const included =
    snap.context.filter((i) => !ss.roomContextOff.includes(i.id)).length +
    ss.context.filter((i) => i.included).length;
  return (
    <>
      <div className="flex h-14 flex-none items-center gap-2 border-b border-border px-3">
        <div
          className="flex rounded-pill bg-surface-2 p-1"
          role="tablist"
          aria-label="Context panel"
        >
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`ctx-tab-${t}`}
              aria-selected={tab === t}
              aria-controls="ctx-panel"
              onClick={() => {
                onTab(t);
              }}
              className={cx(
                'h-8 rounded-pill px-3.5 text-sm font-medium transition-colors',
                tab === t ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
              )}
              data-testid={`ctx-tab-${t}`}
            >
              {t === 'context' ? 'Context' : 'Exact request'}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          aria-label="Close the context panel"
          className="w-10 px-0"
          onClick={onClose}
          data-testid="ctx-close"
        >
          ✕
        </Button>
      </div>
      <div
        id="ctx-panel"
        role="tabpanel"
        aria-labelledby={`ctx-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4"
      >
        {tab === 'context' ? (
          <>
            <p className="text-sm text-text-muted">
              Attach notes, snippets and text files for the whole room or for this session. They go
              to the model before the prompt; anyone here can switch one off.
            </p>
            <BudgetBar
              budget={data.budget}
              exact={data.exact}
              roster={snap.roster}
              me={snap.me.pid}
              model={modelLabel(ss.model)}
            />
            <p className="text-xs font-medium text-text-muted" data-testid="context-count">
              {included} of {total} included
            </p>
            <ContextList session={session} snap={snap} conn={conn} ss={ss} data={data} />
          </>
        ) : (
          <PayloadView session={session} snap={snap} conn={conn} ss={ss} data={data} />
        )}
      </div>
    </>
  );
}
