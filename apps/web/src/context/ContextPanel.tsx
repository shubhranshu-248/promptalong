import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  CONTEXT_MAX_ITEMS,
  addContextItem,
  removeContextItem,
  setContextIncluded,
  setSystemLine,
  sha256Hex,
  updateContextItem,
  type BudgetView,
  type ContextItemView,
  type ContextKind,
  type Segment,
} from '@promptalong/core';
import { modelLabel, modelLimits } from '@promptalong/providers';
import { Button, cx, initials, presenceHex } from '@promptalong/ui';
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { authorName, type Roster } from '../room/authors';
import { buildBody } from '../room/send';
import type { RoomSession, RoomSnapshot } from '../room/session';
import { ItemDialog, RemoveItemDialog, SystemLineDialog, type ItemDialogMode } from './dialogs';
import { FILE_ACCEPT, formatBytes, readContextFile } from './files';
import type { ContextBudget } from './useContextBudget';

export type PanelTab = 'context' | 'payload' | 'model';

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
          <b>This does not fit.</b> Remove about {n(budget.over)} tokens: exclude an item, shorten
          the prompt, or branch from an earlier turn. Nothing is dropped for you.
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
                  Remove from the room…
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

/** The item list with the add zone (mockups 03 and 05). */
export function ContextList({
  session,
  snap,
  data,
  wide,
}: {
  session: RoomSession;
  snap: RoomSnapshot;
  data: ContextBudget;
  wide?: boolean;
}) {
  const me = snap.me.pid;
  const iAmHost = snap.settings?.hostPid === me;
  const [dialog, setDialog] = useState<ItemDialogMode | null>(null);
  const [removing, setRemoving] = useState<ContextItemView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const full = snap.context.length >= CONTEXT_MAX_ITEMS;

  const add = (kind: ContextKind, title: string, text: string): string | null => {
    const result = addContextItem(session.doc, {
      id: crypto.randomUUID(),
      ownerUid: me,
      kind,
      title,
      text,
      createdAt: Date.now(),
    });
    if (result.ok) return null;
    return result.reason === 'too-large'
      ? 'That is larger than 200 KB. Trim it, or add the part that matters.'
      : result.reason === 'room-full'
        ? `A room holds up to ${String(CONTEXT_MAX_ITEMS)} context items. Remove one first.`
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

  return (
    <div
      className="flex flex-col gap-3"
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
      {snap.context.length > 0 ? (
        <ul className="flex flex-col gap-3" data-testid="context-items">
          {snap.context.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              tokens={data.itemTokens[item.id] ?? 0}
              roster={snap.roster}
              me={me}
              canEdit={item.ownerUid === me}
              canRemove={item.ownerUid === me || iAmHost}
              onToggle={(included) => {
                setContextIncluded(session.doc, item.id, included, me);
              }}
              onOpen={() => {
                setDialog({ type: item.ownerUid === me ? 'edit' : 'view', item });
              }}
              onRemove={() => {
                setRemoving(item);
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted" data-testid="context-empty">
          Nothing is attached yet. Whatever you add here is sent to the model before the prompt, and
          everyone in the room can see it and switch it off.
        </p>
      )}
      <div
        className={cx(
          'rounded-lg border-[1.5px] border-dashed p-4 text-center',
          dragging ? 'border-accent bg-accent-soft' : 'border-border-strong',
        )}
        data-testid="context-add"
      >
        <p className="text-sm font-semibold">
          {wide
            ? 'Drop a .txt or .md file, paste a snippet, or write a note'
            : 'Add context for the whole room'}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Text only · up to 200 KB per item · {snap.context.length} of {CONTEXT_MAX_ITEMS} used
        </p>
        <div className="mt-2.5 flex flex-wrap justify-center gap-2">
          <Button
            size="sm"
            disabled={full}
            onClick={() => {
              setDialog({ type: 'add', kind: 'note' });
            }}
          >
            Add note
          </Button>
          <Button
            size="sm"
            disabled={full}
            onClick={() => {
              setDialog({ type: 'add', kind: 'snippet' });
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
        doc={session.doc}
        onClose={() => {
          setDialog(null);
        }}
        onAdd={add}
        onSave={(id, title, text) => {
          const result = updateContextItem(session.doc, id, { title, text });
          return result === 'ok'
            ? null
            : result === 'too-large'
              ? 'That is larger than 200 KB.'
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
          removeContextItem(session.doc, id);
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
export function PayloadView({
  session,
  snap,
  data,
}: {
  session: RoomSession;
  snap: RoomSnapshot;
  data: ContextBudget;
}) {
  const [json, setJson] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lineOpen, setLineOpen] = useState(false);
  const { assembled } = data;
  const body = useMemo(() => buildBody(snap.model, assembled.messages), [snap.model, assembled]);
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

  const last = [...snap.path].reverse().find((t) => t.requestHash);
  const lastLabel = last ? (snap.labels[last.id] ?? '') : '';
  const nextLabel = `T${String(snap.path.filter((t) => t.branchId === snap.activeBranch).length + 1)}`;
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
      <div className="flex items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate text-text-muted" data-testid="room-line">
          {snap.systemLine ? (
            <>
              Room line: <span className="text-text">{snap.systemLine}</span>
            </>
          ) : (
            'No room line. Add one to tell the model what this room is for.'
          )}
        </span>
        <Button
          size="sm"
          onClick={() => {
            setLineOpen(true);
          }}
        >
          {snap.systemLine ? 'Edit room line' : 'Add room line'}
        </Button>
      </div>
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
                history ({historyTurns.map((id) => snap.labels[id] ?? '?').join(', ')} + answers) …{' '}
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
        open={lineOpen}
        onOpenChange={setLineOpen}
        current={snap.systemLine}
        onSave={(line) => {
          setSystemLine(session.doc, line, snap.me.pid);
        }}
      />
    </div>
  );
}

function ModelInfo({
  snap,
  data,
  onChangeModel,
}: {
  snap: RoomSnapshot;
  data: ContextBudget;
  onChangeModel: () => void;
}) {
  const limits = modelLimits(snap.model);
  const row = 'flex justify-between gap-3 border-b border-border py-2.5 text-sm';
  return (
    <div data-testid="model-info">
      <p className={row}>
        <span className="text-text-muted">Model</span>
        <b className="text-right">{modelLabel(snap.model)}</b>
      </p>
      <p className={row}>
        <span className="text-text-muted">Context window</span>
        <b className="font-mono">{n(limits.contextWindow)}</b>
      </p>
      <p className={row}>
        <span className="text-text-muted">Kept for the answer</span>
        <b className="font-mono">{n(data.budget.reserve)}</b>
      </p>
      <p className={row}>
        <span className="text-text-muted">Token counts</span>
        <b>{data.exact ? 'exact' : 'about'}</b>
      </p>
      <p className="mt-3 text-xs text-text-muted">
        The model is a room setting: everyone sends with the same one. Keys stay in each
        person&apos;s own browser.
      </p>
      <Button className="mt-3" onClick={onChangeModel}>
        Change model
      </Button>
    </div>
  );
}

/** Right-hand panel: Context | Payload | Model (mockup 03), also the phone's Context tab. */
export function ContextPanel({
  session,
  snap,
  data,
  tab,
  onTab,
  wide,
  onWide,
  onClose,
  onChangeModel,
}: {
  session: RoomSession;
  snap: RoomSnapshot;
  data: ContextBudget;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  /** mockup 05: the item list is shown in the main area, this panel keeps Payload and Model */
  wide: boolean;
  onWide: (wide: boolean) => void;
  onClose: () => void;
  onChangeModel: () => void;
}) {
  const tabs: PanelTab[] = ['context', 'payload', 'model'];
  const shown: PanelTab = wide && tab === 'context' ? 'payload' : tab;
  const included = snap.context.filter((i) => i.included).length;
  return (
    <>
      <div className="flex flex-none items-center border-b border-border px-2">
        <div className="flex" role="tablist" aria-label="Context panel">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`ctx-tab-${t}`}
              aria-selected={shown === t}
              aria-controls="ctx-panel"
              onClick={() => {
                if (wide && t === 'context') onWide(false);
                onTab(t);
              }}
              className={cx(
                '-mb-px h-11 border-b-2 px-3 text-sm font-semibold',
                shown === t ? 'border-text text-text' : 'border-transparent text-text-muted',
              )}
              data-testid={`ctx-tab-${t}`}
            >
              {t === 'context' ? 'Context' : t === 'payload' ? 'Payload' : 'Model'}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="max-md:hidden"
          onClick={() => {
            onWide(!wide);
          }}
          data-testid="ctx-wide"
        >
          {wide ? 'Back to the chat' : 'Expand'}
        </Button>
        {wide ? null : (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close the context panel"
            className="w-10 px-0 max-md:hidden"
            onClick={onClose}
          >
            ✕
          </Button>
        )}
      </div>
      <div
        id="ctx-panel"
        role="tabpanel"
        aria-labelledby={`ctx-tab-${shown}`}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4"
      >
        {shown === 'context' ? (
          <>
            <BudgetBar
              budget={data.budget}
              exact={data.exact}
              roster={snap.roster}
              me={snap.me.pid}
              model={modelLabel(snap.model)}
            />
            <p className="text-xs font-semibold text-text-muted" data-testid="context-count">
              {included} of {snap.context.length} included
            </p>
            <ContextList session={session} snap={snap} data={data} />
          </>
        ) : shown === 'payload' ? (
          <PayloadView session={session} snap={snap} data={data} />
        ) : (
          <ModelInfo snap={snap} data={data} onChangeModel={onChangeModel} />
        )}
      </div>
    </>
  );
}

/** Mockup 05, left side: the context list in the main area. */
export function ContextWide({
  session,
  snap,
  data,
}: {
  session: RoomSession;
  snap: RoomSnapshot;
  data: ContextBudget;
}) {
  const included = snap.context.filter((i) => i.included).length;
  return (
    <div className="mx-auto flex w-full max-w-[864px] flex-col gap-4" data-testid="context-wide">
      <div className="flex items-center gap-3">
        <h2 className="text-[22px] font-semibold">Context</h2>
        <span className="ml-auto inline-flex h-7 items-center rounded-pill bg-surface-2 px-2.5 text-xs font-semibold">
          {included} of {snap.context.length} included
        </span>
      </div>
      <p className="text-sm text-text-muted">
        Each person adds their own context. The room decides what goes in. The Payload tab shows
        exactly what the model receives.
      </p>
      <BudgetBar
        budget={data.budget}
        exact={data.exact}
        roster={snap.roster}
        me={snap.me.pid}
        model={modelLabel(snap.model)}
        tall
      />
      <ContextList session={session} snap={snap} data={data} wide />
    </div>
  );
}
