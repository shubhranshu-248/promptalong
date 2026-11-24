import type { TurnView } from '@promptalong/core';
import { approxTokens } from '@promptalong/providers';
import { Button, cx } from '@promptalong/ui';
import { useEffect, useRef, type ReactNode } from 'react';
import { AttributedText } from './AuthorText';
import type { Roster } from './authors';
import type { PersonView } from './session';

export interface ThreadActions {
  onStop: (turnId: string) => void;
  onRetry: (turn: TurnView) => void;
  onChangeModel: () => void;
  onUpdateKey: (turn: TurnView) => void;
  onBranchFrom: (turnId: string) => void;
}

export interface ThreadContext {
  roster: Roster;
  labels: Record<string, string>;
  showAuthors: boolean;
  branchName: (id: string) => string;
}

function nameOf(pid: string | undefined, people: PersonView[], fallback = 'Someone'): string {
  if (!pid) return fallback;
  const p = people.find((x) => x.pid === pid);
  if (!p) return fallback;
  return p.me ? 'you' : p.name;
}

const tokens = (t: TurnView) => t.usage?.output ?? approxTokens(t.answer);
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

function MetaLine({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p
      className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-text-muted"
      data-testid={testId}
    >
      {children}
    </p>
  );
}

function Chip({ tone, children }: { tone: 'neutral' | 'danger' | 'warn'; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-xs font-semibold',
        tone === 'danger' && 'bg-[color-mix(in_srgb,var(--c-danger)_12%,transparent)] text-danger',
        tone === 'warn' && 'bg-warning-bg text-warning-text',
        tone === 'neutral' && 'bg-surface-2 text-text',
      )}
    >
      {children}
    </span>
  );
}

function PromptBubble({
  turn,
  index,
  people,
  ctx,
}: {
  turn: TurnView;
  index: number;
  people: PersonView[];
  ctx: ThreadContext;
}) {
  const sender = people.find((p) => p.pid === turn.sentBy);
  const name = sender
    ? sender.me
      ? 'you'
      : sender.name
    : (ctx.roster[turn.sentBy]?.name ?? (turn.senderName || 'Someone'));
  const me = people.find((p) => p.me)?.pid;
  const label = ctx.labels[turn.id] ?? `T${String(index + 1)}`;
  return (
    <div className="ml-auto max-w-[min(590px,92%)] rounded-lg bg-surface-2 px-[18px] py-3.5">
      <p className="mb-1 text-xs text-text-muted">
        Turn {label.replace(/^T/u, '')} · sent by {name}
        {turn.branchId !== 'main' ? ` · ${ctx.branchName(turn.branchId)}` : ''}
      </p>
      <p className="whitespace-pre-wrap break-words" data-testid="turn-prompt">
        <AttributedText
          text={turn.prompt.text}
          spans={turn.prompt.spans}
          roster={ctx.roster}
          {...(me ? { me } : {})}
          show={ctx.showAuthors}
        />
      </p>
    </div>
  );
}

function Answer({
  turn,
  people,
  actions,
  isLast,
}: {
  turn: TurnView;
  people: PersonView[];
  actions: ThreadActions;
  isLast: boolean;
}) {
  const me = people.find((p) => p.me);
  const mine = turn.sentBy === me?.pid;
  const senderName = nameOf(turn.sentBy, people, turn.senderName || 'Someone');
  const count = tokens(turn);
  const streaming = turn.status === 'streaming';

  let meta: ReactNode;
  switch (turn.status) {
    case 'streaming':
      meta = (
        <>
          <span className="size-2 rounded-full bg-success" aria-hidden="true" />
          <b className="text-text">
            {mine
              ? `Streaming to ${plural(people.length, 'person', 'people')}`
              : `${turn.senderName || senderName} is sending`}
          </b>
          {!mine ? <span>· streaming to {plural(people.length, 'person', 'people')}</span> : null}
          <span>· {turn.provider.label}</span>
          <span>· {plural(count, 'token')}</span>
          <Button
            size="sm"
            className="ml-1"
            onClick={() => {
              actions.onStop(turn.id);
            }}
            disabled={turn.stopRequestedBy !== undefined}
          >
            {turn.stopRequestedBy ? 'Stopping…' : 'Stop'}
          </Button>
        </>
      );
      break;
    case 'done':
      meta = (
        <>
          <span>{turn.provider.label}</span>
          <span>· {plural(count, 'token')}</span>
          {turn.durationMs !== undefined ? (
            <span>· {(turn.durationMs / 1000).toFixed(1)} s</span>
          ) : null}
        </>
      );
      break;
    case 'stopped':
      meta = (
        <>
          <Chip tone="neutral">
            <span className="size-2 bg-current" aria-hidden="true" />
            Stopped by {nameOf(turn.stoppedBy, people)}
          </Chip>
          <span>· {turn.provider.label}</span>
          <span>· {plural(count, 'token')} · saved</span>
        </>
      );
      break;
    case 'interrupted':
      meta = (
        <>
          <Chip tone="warn">Interrupted</Chip>
          <span>
            · {turn.senderName || senderName}{' '}
            {turn.interruptedReason === 'left' ? 'left the room' : 'lost connection'}
          </span>
          <span>· {plural(count, 'token')} kept</span>
        </>
      );
      break;
    case 'failed':
      meta = (
        <>
          <Chip tone="danger">
            <span aria-hidden="true">▲</span> Failed
          </Chip>
          <span>· {turn.provider.label}</span>
          <span>· {plural(count, 'token')}</span>
        </>
      );
      break;
  }

  const providerName = turn.provider.label.split(' · ')[0] ?? 'The model';
  return (
    <div
      className={cx(
        'max-w-[760px]',
        turn.status === 'failed' && 'border-l-[3px] border-danger bg-surface py-3.5 pr-4 pl-4',
      )}
      data-testid="turn-answer"
      data-status={turn.status}
      data-turn={turn.id}
    >
      <MetaLine testId="turn-meta">{meta}</MetaLine>
      {turn.status === 'failed' ? (
        <>
          <p className="font-semibold text-danger">The model did not answer.</p>
          <p className="mt-1 text-sm" data-testid="turn-error">
            {providerName} said: "{turn.error?.message ?? 'unknown error'}"
            {turn.error?.status !== undefined ? ` (${String(turn.error.status)})` : ''}.{' '}
            {turn.answer ? 'The text so far is kept.' : 'Nothing was saved from this turn.'}
          </p>
        </>
      ) : null}
      {turn.answer || streaming ? (
        <div
          className="answer-text text-[15px] leading-relaxed whitespace-pre-wrap break-words"
          data-testid="answer-text"
          aria-busy={streaming}
        >
          {turn.answer}
          {streaming ? <span className="pa-stream-caret" aria-hidden="true" /> : null}
          {turn.status === 'stopped' ? (
            <span className="ml-1 text-xs text-text-muted">
              <span
                className="mr-1 inline-block size-2 bg-current align-middle"
                aria-hidden="true"
              />
              stopped
            </span>
          ) : null}
        </div>
      ) : null}
      {turn.status === 'interrupted' && isLast ? (
        <p className="mt-3 rounded-md bg-accent-soft px-3.5 py-2.5 text-sm">
          The answer so far is saved. Send is free again for everyone. <b>Retry</b> sends the same
          prompt with your model.
        </p>
      ) : null}
      {turn.status === 'done' ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              actions.onBranchFrom(turn.id);
            }}
          >
            Branch from here
          </Button>
        </div>
      ) : null}
      {turn.status === 'failed' || turn.status === 'stopped' || turn.status === 'interrupted' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {turn.status === 'failed' &&
          mine &&
          turn.error?.code === 'auth' &&
          turn.provider.kind === 'byok' ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                actions.onUpdateKey(turn);
              }}
            >
              Update key
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={turn.status === 'stopped' ? 'default' : 'primary'}
            onClick={() => {
              actions.onRetry(turn);
            }}
          >
            Retry
          </Button>
          {turn.status === 'failed' ? (
            <Button size="sm" onClick={actions.onChangeModel}>
              Change model
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                actions.onBranchFrom(turn.id);
              }}
            >
              Branch from here
            </Button>
          )}
        </div>
      ) : null}
      {turn.status === 'failed' ? (
        <p className="mt-2.5 text-xs text-text-muted">
          The prompt is kept with the turn, so Retry sends the same request.
          {turn.provider.kind === 'byok' && !mine
            ? ` Everyone sees that this turn failed; only ${turn.senderName || 'the sender'} sees the key options.`
            : ''}
        </p>
      ) : null}
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
    const el = box.current?.parentElement;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
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
  return (
    <div
      ref={box}
      className="mx-auto flex w-full max-w-[860px] flex-col gap-6"
      data-testid="thread"
    >
      {turns.map((turn, i) => (
        <section
          key={turn.id}
          className="flex flex-col gap-4"
          aria-label={`Turn ${ctx.labels[turn.id] ?? String(i + 1)}`}
        >
          <PromptBubble turn={turn} index={i} people={people} ctx={ctx} />
          <Answer turn={turn} people={people} actions={actions} isLast={i === turns.length - 1} />
        </section>
      ))}
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
