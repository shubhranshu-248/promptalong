import type { TurnView } from '@promptalong/core';
import { approxTokens } from '@promptalong/providers';
import { cx } from '@promptalong/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AttributedText } from './AuthorText';
import { authorsOf, type Roster } from './authors';
import { CheckIcon, CompareIcon, CopyIcon, PinIcon, RetryIcon } from './icons';
import { Markdown } from './Markdown';
import type { PersonView } from './session';

export interface ThreadActions {
  onRetry: (turn: TurnView) => void;
  onChangeModel: () => void;
  onUpdateKey: (turn: TurnView) => void;
  /** put this prompt back in the shared prompt, with its authors, to change and send again */
  onEdit?: (turn: TurnView) => void;
  /** send this prompt to a second model and show both answers side by side */
  onCompare?: (turn: TurnView) => void;
  /** keep this answer for the whole room (or take the pin away) */
  onPin?: (turn: TurnView) => void;
  isPinned?: (turn: TurnView) => boolean;
}

export interface ThreadContext {
  roster: Roster;
  showAuthors: boolean;
}

const tokens = (t: TurnView) => t.usage?.output ?? approxTokens(t.answer);
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "Aarav", "Aarav and Meera", "Aarav, Meera and Kabir" */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

function nameOf(pid: string | undefined, people: PersonView[], roster: Roster, fallback: string) {
  if (!pid) return fallback;
  const p = people.find((x) => x.pid === pid);
  if (p) return p.me ? 'you' : p.name;
  return roster[pid]?.name ?? fallback;
}

function Dot({ slot, roster, pid }: { slot?: number; roster: Roster; pid: string }) {
  const entry = roster[pid];
  const n = slot ?? entry?.slot ?? 1;
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2.5 flex-none rounded-full ring-2 ring-bg"
      style={{ background: `var(--p-${String(Math.min(16, Math.max(1, n)))})` }}
    />
  );
}

function ActionButton({
  label,
  onClick,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
      className="grid size-8 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      {children}
    </button>
  );
}

function PromptBubble({
  turn,
  people,
  ctx,
  onEdit,
}: {
  turn: TurnView;
  people: PersonView[];
  ctx: ThreadContext;
  onEdit?: ((turn: TurnView) => void) | undefined;
}) {
  const me = people.find((p) => p.me)?.pid;
  const writers = authorsOf(turn.prompt.spans);
  const sender = nameOf(turn.sentBy, people, ctx.roster, turn.senderName || 'Someone');
  const writerNames = writers.map((uid) => nameOf(uid, people, ctx.roster, 'someone who left'));
  const byline =
    writers.length > 1 || (writers.length === 1 && writers[0] !== turn.sentBy)
      ? `Written by ${listNames(writerNames)}, sent by ${sender}`
      : `Sent by ${sender}`;
  return (
    <div className="flex flex-col items-end gap-1.5">
      <p className="flex max-w-[min(600px,88%)] items-start justify-end gap-2 text-right text-xs text-text-muted">
        <span className="mt-[3px] flex flex-none -space-x-1">
          {(writers.length > 0 ? writers : [turn.sentBy]).slice(0, 5).map((uid) => (
            <Dot key={uid} pid={uid} roster={ctx.roster} />
          ))}
        </span>
        <span>
          {byline}
          {turn.context.length > 0 ? (
            <span
              data-testid="turn-context"
              title={turn.context.map((c) => `${c.title} (${c.ownerName})`).join('\n')}
            >
              , with {turn.context.length} context {turn.context.length === 1 ? 'item' : 'items'}
            </span>
          ) : null}
        </span>
      </p>
      <div className="max-w-[min(600px,88%)] rounded-[18px] rounded-tr-md bg-surface-2 px-4 py-2.5 text-[15px] leading-relaxed">
        <p className="break-words whitespace-pre-wrap" data-testid="turn-prompt">
          <AttributedText
            text={turn.prompt.text}
            spans={turn.prompt.spans}
            roster={ctx.roster}
            {...(me ? { me } : {})}
            // one writer: nothing to tell apart, so no marks
            show={ctx.showAuthors && writers.length > 1}
          />
        </p>
      </div>
      {onEdit ? (
        <button
          type="button"
          onClick={() => {
            onEdit(turn);
          }}
          className="rounded-md px-2 py-1 text-xs font-medium text-text-muted hover:bg-surface-2 hover:text-text"
          data-testid="edit-prompt"
        >
          Edit and send again
        </button>
      ) : null}
    </div>
  );
}

function StatusChip({
  tone,
  children,
}: {
  tone: 'danger' | 'warn' | 'neutral';
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center gap-1.5 rounded-pill px-2.5 text-xs font-semibold',
        tone === 'danger' && 'bg-[color-mix(in_srgb,var(--c-danger)_12%,transparent)] text-danger',
        tone === 'warn' && 'bg-warning-bg text-warning-text',
        tone === 'neutral' && 'bg-surface-2 text-text',
      )}
    >
      {children}
    </span>
  );
}

function Answer({
  turn,
  people,
  roster,
  actions,
  isLast,
}: {
  turn: TurnView;
  people: PersonView[];
  roster: Roster;
  actions: ThreadActions;
  isLast: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const me = people.find((p) => p.me);
  const mine = turn.sentBy === me?.pid;
  const sender = nameOf(turn.sentBy, people, roster, turn.senderName || 'Someone');
  const count = tokens(turn);
  const streaming = turn.status === 'streaming';
  const model = turn.provider.label;

  let meta: ReactNode;
  switch (turn.status) {
    case 'streaming':
      meta = (
        <>
          <span className="pa-live-dot" aria-hidden="true" />
          <b className="font-semibold text-text">
            {mine ? 'Answering' : `Answering ${sender}`} for{' '}
            {plural(people.length, 'person', 'people')}
          </b>
          <span>{model}</span>
        </>
      );
      break;
    case 'done':
      meta = (
        <span>
          {model}, {plural(count, 'token')}
          {turn.durationMs !== undefined ? `, ${(turn.durationMs / 1000).toFixed(1)} s` : ''}
        </span>
      );
      break;
    case 'stopped':
      meta = (
        <>
          <StatusChip tone="neutral">
            Stopped by {nameOf(turn.stoppedBy, people, roster, 'someone')}
          </StatusChip>
          <span>
            {model}, {plural(count, 'token')} kept
          </span>
        </>
      );
      break;
    case 'interrupted':
      meta = (
        <>
          <StatusChip tone="warn">Interrupted</StatusChip>
          <span>
            {turn.senderName || sender}{' '}
            {turn.interruptedReason === 'left' ? 'left the room' : 'lost connection'},{' '}
            {plural(count, 'token')} kept
          </span>
        </>
      );
      break;
    case 'failed':
      meta = (
        <>
          <StatusChip tone="danger">Failed</StatusChip>
          <span>{model}</span>
        </>
      );
      break;
  }

  const providerName = model.split(' · ')[0] ?? 'The model';
  const copy = () => {
    void navigator.clipboard.writeText(turn.answer).then(
      () => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 1600);
      },
      () => undefined,
    );
  };

  return (
    <div
      className="group flex flex-col gap-2"
      data-testid="turn-answer"
      data-status={turn.status}
      data-turn={turn.id}
    >
      {turn.status === 'failed' ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--c-danger)_35%,transparent)] bg-surface px-4 py-3">
          <p className="font-semibold text-danger">The model did not answer.</p>
          <p className="mt-1 text-sm" data-testid="turn-error">
            {providerName} said: "{turn.error?.message ?? 'unknown error'}"
            {turn.error?.status !== undefined ? ` (${String(turn.error.status)})` : ''}.{' '}
            {turn.answer ? 'The text so far is kept.' : 'Nothing was saved from this turn.'}
          </p>
          {turn.provider.kind === 'byok' && !mine ? (
            <p className="mt-1 text-xs text-text-muted">
              Only {turn.senderName || 'the sender'} sees the key options.
            </p>
          ) : null}
        </div>
      ) : null}
      {turn.answer || streaming ? (
        <div
          className="answer-text text-[15.5px] leading-[1.7] break-words"
          data-testid="answer-text"
          aria-busy={streaming}
        >
          <Markdown
            text={turn.answer}
            tail={streaming ? <span className="pa-stream-caret" aria-hidden="true" /> : null}
          />
        </div>
      ) : null}
      {turn.status === 'interrupted' && isLast ? (
        <p className="rounded-md bg-accent-soft px-3.5 py-2.5 text-sm">
          The answer so far is saved and Send is free again. Retry sends the same prompt with your
          model.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {streaming ? null : (
          <span className="-ml-1.5 flex items-center gap-0.5">
            {turn.answer ? (
              <ActionButton label={copied ? 'Copied' : 'Copy answer'} onClick={copy}>
                {copied ? <CheckIcon /> : <CopyIcon />}
              </ActionButton>
            ) : null}
            <ActionButton
              label="Retry"
              onClick={() => {
                actions.onRetry(turn);
              }}
            >
              <RetryIcon />
            </ActionButton>
            {actions.onCompare && !turn.compareOf && turn.status === 'done' ? (
              <ActionButton
                label="Compare with another model"
                testId="compare-answer"
                onClick={() => {
                  actions.onCompare?.(turn);
                }}
              >
                <CompareIcon />
              </ActionButton>
            ) : null}
            {actions.onPin && turn.answer ? (
              <ActionButton
                label={actions.isPinned?.(turn) ? 'Unpin from the room' : 'Pin to the room'}
                testId="pin-answer"
                onClick={() => {
                  actions.onPin?.(turn);
                }}
              >
                <span className={actions.isPinned?.(turn) ? 'text-accent' : undefined}>
                  <PinIcon />
                </span>
              </ActionButton>
            ) : null}
          </span>
        )}
        <p
          className={cx(
            'flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted',
            !streaming && 'ml-1',
          )}
          data-testid="turn-meta"
        >
          {meta}
        </p>
        {turn.status === 'failed' ? (
          <span className="ml-auto flex gap-2">
            {mine && turn.error?.code === 'auth' && turn.provider.kind === 'byok' ? (
              <button
                type="button"
                className="h-8 rounded-pill bg-primary-btn-bg px-3 text-xs font-semibold text-primary-btn-text"
                onClick={() => {
                  actions.onUpdateKey(turn);
                }}
              >
                Update key
              </button>
            ) : null}
            <button
              type="button"
              className="h-8 rounded-pill border border-border-strong px-3 text-xs font-semibold"
              onClick={actions.onChangeModel}
            >
              Change model
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function Thread({
  turns,
  people,
  actions,
  ctx,
}: {
  turns: TurnView[];
  people: PersonView[];
  actions: ThreadActions;
  ctx: ThreadContext;
}) {
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const last = turns.at(-1);
  const lastLength = last ? last.answer.length + last.prompt.text.length : 0;
  const lastId = last?.id;

  // Follow the answer while it streams, unless the reader scrolled up to read something else.
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current?.closest('[data-scroll]');
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
    };
  }, []);
  useEffect(() => {
    const el = end.current;
    // jsdom has no scrollIntoView
    if (stick.current && el && typeof el.scrollIntoView === 'function')
      el.scrollIntoView({ block: 'end' });
  }, [lastLength, lastId]);

  const status = last ? last.status : null;
  // a comparison is shown next to the turn it compares with, under one prompt
  const groups: { turn: TurnView; others: TurnView[] }[] = [];
  const byId = new Map<string, { turn: TurnView; others: TurnView[] }>();
  for (const t of turns) {
    const host = t.compareOf ? byId.get(t.compareOf) : undefined;
    if (host) {
      host.others.push(t);
      continue;
    }
    const g = { turn: t, others: [] as TurnView[] };
    byId.set(t.id, g);
    groups.push(g);
  }
  return (
    <div
      ref={box}
      className="mx-auto flex w-full max-w-[760px] flex-col gap-9"
      data-testid="thread"
    >
      {groups.map(({ turn, others }, i) => {
        const lastHere = turns.at(-1)?.id;
        const answer = (t: TurnView) => (
          <Answer
            key={t.id}
            turn={t}
            people={people}
            roster={ctx.roster}
            actions={actions}
            isLast={t.id === lastHere}
          />
        );
        return (
          <section
            key={turn.id}
            className="flex flex-col gap-5"
            aria-label={`Turn ${String(i + 1)}`}
          >
            <PromptBubble turn={turn} people={people} ctx={ctx} onEdit={actions.onEdit} />
            {others.length === 0 ? (
              answer(turn)
            ) : (
              <div
                className="grid gap-4 md:grid-cols-2"
                data-testid="compare"
                role="group"
                aria-label="Answers from different models"
              >
                {[turn, ...others].map((t) => (
                  <div
                    key={t.id}
                    className="flex min-w-0 flex-col gap-2 rounded-xl border border-border p-3.5"
                  >
                    <p className="text-xs font-semibold text-text-muted">{t.provider.label}</p>
                    {answer(t)}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      <p className="sr-only" aria-live="polite">
        {status === 'streaming'
          ? 'An answer is streaming.'
          : status === 'done'
            ? 'The answer is complete.'
            : status
              ? `The answer was ${status}.`
              : ''}
      </p>
      <div ref={end} />
    </div>
  );
}
