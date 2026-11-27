import type { BudgetView } from '@promptalong/core';
import { modelLabel, type RoomModelChoice } from '@promptalong/providers';
import { cx } from '@promptalong/ui';
import { useState, type ReactNode } from 'react';
import { AuthorStyles } from './AuthorText';
import { authorName, type Roster } from './authors';
import { ArrowUpIcon, ChevronDownIcon, PaperclipIcon, StopIcon } from './icons';
import { PromptEditor } from './PromptEditor';
import type { PersonView } from './session';
import type { SessionConn } from './session-conn';

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const full = (n: number) => n.toLocaleString('en-US');

/**
 * One strand per person in the room along the composer's top edge - the logo's strands running
 * into the Send dot. A strand is bright while its person types; colour is never the only cue (the
 * status line under the composer names who is typing).
 */
function Strands({ people }: { people: PersonView[] }) {
  return (
    <div className="pa-strands" aria-hidden="true" data-testid="strands">
      {people.map((p) => (
        <i
          key={p.pid}
          style={{ background: p.color }}
          data-active={p.activity === 'typing' || p.activity === 'sending' ? 'true' : undefined}
        />
      ))}
    </div>
  );
}

function ToolButton({
  children,
  className,
  ...rest
}: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex h-9 items-center gap-1.5 rounded-pill px-3 text-[13px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface ComposerProps {
  session: SessionConn;
  people: PersonView[];
  roster: Roster;
  me: string;
  ready: boolean;
  showAuthors: boolean;
  model: RoomModelChoice;
  contextCount: number;
  budget: BudgetView;
  exact: boolean;
  /** why Send is off right now (null = it can be pressed) */
  blocked: string | null;
  /** nothing written yet: Send is off, with no message */
  empty: boolean;
  notice: string | null;
  sendingMine: boolean;
  /** the name of whoever is sending, when it is someone else */
  sendingOther: string | null;
  /** the turn that is streaming now (anyone can stop it) */
  streamingTurn: { id: string; stopping: boolean } | null;
  status: string;
  /** extra line under the composer (model notice) */
  below?: ReactNode;
  placeholder: string;
  onSend: () => void;
  onStop: (turnId: string) => void;
  onContext: () => void;
  onModel: () => void;
}

export function Composer(p: ComposerProps) {
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const over = p.budget.over > 0;
  const streaming = p.streamingTurn;
  const typing = p.people.filter((x) => !x.me && x.activity === 'typing').map((x) => x.name);
  const who =
    typing.length === 0
      ? null
      : typing.length === 1
        ? `${typing[0] ?? ''} is typing`
        : typing.length === 2
          ? `${typing[0] ?? ''} and ${typing[1] ?? ''} are typing`
          : `${String(typing.length)} people are typing`;
  const hint = p.notice ?? p.blocked;

  return (
    <div className="mx-auto w-full max-w-[760px]">
      <div
        className={cx(
          'pa-composer relative rounded-[22px] border bg-surface shadow-md transition-[border-color,box-shadow] focus-within:shadow-lg',
          over ? 'border-danger' : 'border-border focus-within:border-border-strong',
        )}
      >
        <Strands people={p.people} />
        <AuthorStyles roster={p.roster} show={p.showAuthors} me={p.me} />
        {p.ready ? (
          <div
            className={cx('px-4 pt-3.5 max-md:px-3', p.showAuthors && 'pa-show-authors')}
            onMouseOver={(e) => {
              const el = (e.target as HTMLElement).closest('[data-author]');
              const uid = el?.getAttribute('data-author') ?? '';
              if (!el || !uid || !p.showAuthors) {
                setHover(null);
                return;
              }
              const r = el.getBoundingClientRect();
              setHover({ name: authorName(p.roster, uid, p.me), x: r.left, y: r.top });
            }}
            onMouseLeave={() => {
              setHover(null);
            }}
            onKeyDownCapture={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.stopPropagation();
                if (!p.blocked && !p.sendingMine && !p.empty) p.onSend();
              }
            }}
          >
            <PromptEditor key={p.session.id} session={p.session} placeholder={p.placeholder} />
          </div>
        ) : (
          // Starting the editor before the first sync would add a second empty paragraph.
          <div className="px-4 pt-3.5 max-md:px-3">
            <div className="pa-editor text-text-muted" role="status" data-testid="prompt-loading">
              Loading the shared prompt…
            </div>
          </div>
        )}
        <div className="flex items-center gap-1 px-2 pt-1 pb-2">
          <ToolButton onClick={p.onContext} data-testid="context-button">
            <PaperclipIcon />
            <span className="max-md:sr-only">Context</span>
            {p.contextCount > 0 ? (
              <span className="grid h-5 min-w-5 place-items-center rounded-pill bg-accent-soft px-1.5 text-[11px] font-semibold text-accent">
                {p.contextCount}
                <span className="sr-only"> included</span>
              </span>
            ) : null}
          </ToolButton>
          <ToolButton
            onClick={p.onModel}
            aria-label={`Model: ${modelLabel(p.model)}. Change model`}
            data-testid="model-button"
            className="min-w-0"
          >
            <span className="truncate max-md:hidden">{modelLabel(p.model)}</span>
            <span className="truncate md:hidden">{modelLabel(p.model, true)}</span>
            <ChevronDownIcon />
          </ToolButton>
          <span className="flex-1" />
          <span
            className={cx(
              'px-1.5 text-xs whitespace-nowrap tabular-nums',
              over ? 'font-semibold text-danger' : 'text-text-muted',
            )}
            title={`${p.exact ? '' : 'About '}${full(p.budget.used)} of ${full(p.budget.limit)} tokens (the model's window minus ${full(p.budget.reserve)} kept for the answer)`}
            data-testid="composer-tokens"
          >
            {p.exact ? '' : '~'}
            {compact.format(p.budget.used)} / {compact.format(p.budget.limit)}
          </span>
          {streaming ? (
            <button
              type="button"
              className="pa-send"
              onClick={() => {
                p.onStop(streaming.id);
              }}
              disabled={streaming.stopping}
              aria-label={streaming.stopping ? 'Stopping' : 'Stop'}
              title="Stop the answer for everyone"
              data-testid="stop-button"
            >
              <StopIcon />
            </button>
          ) : (
            <button
              type="button"
              className="pa-send"
              disabled={p.blocked !== null || p.sendingMine || p.empty}
              onClick={p.onSend}
              aria-label={
                p.sendingMine
                  ? 'Sending…'
                  : p.sendingOther
                    ? `${p.sendingOther} is sending…`
                    : 'Send'
              }
              title="Send to everyone (Ctrl or ⌘ + Enter)"
              data-testid="send-button"
            >
              <ArrowUpIcon />
            </button>
          )}
        </div>
      </div>
      {p.below}
      <p
        className={cx(
          'mt-2 min-h-[1lh] px-2 text-center text-xs',
          hint ? 'text-text' : 'text-text-muted',
        )}
        aria-live="polite"
        data-testid="send-hint"
      >
        {hint ?? who ?? p.status}
      </p>
      <p className="sr-only" aria-live="polite" data-testid="sync-status">
        {p.status}
      </p>
      {hover ? (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 rounded-sm bg-text px-2 py-1 text-xs font-semibold text-bg"
          style={{ left: hover.x, top: Math.max(4, hover.y - 28) }}
        >
          Written by {hover.name}
        </div>
      ) : null}
    </div>
  );
}
