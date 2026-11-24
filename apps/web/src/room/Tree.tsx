import type { BranchView, MergeEvent, TurnView } from '@promptalong/core';
import { Button, cx, initials, presenceHex } from '@promptalong/ui';
import { authorName, authorsOf, type Roster } from './authors';

export interface TreeActions {
  onToggleSelect: (turnId: string) => void;
  onBranchFrom: (turnId: string) => void;
  onCompare: () => void;
  onSwitch: (branchId: string) => void;
  onRename: (branchId: string) => void;
  onMerge: (branchId: string) => void;
  onFork: () => void;
}

function short(text: string, n = 42): string {
  const t = text.replace(/\s+/gu, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t || '(empty prompt)';
}

function Faces({ uids, roster }: { uids: string[]; roster: Roster }) {
  return (
    <span className="flex -space-x-1" aria-hidden="true">
      {uids.slice(0, 4).map((uid) => {
        const { color, label } = presenceHex(roster[uid]?.slot ?? 1);
        return (
          <span
            key={uid}
            className="grid size-[18px] place-items-center rounded-full border border-surface text-[8px] font-bold"
            style={{ background: color, color: label }}
          >
            {initials(roster[uid]?.name ?? '?')}
          </span>
        );
      })}
    </span>
  );
}

function TurnCard({
  turn,
  label,
  roster,
  me,
  branchName,
  selected,
  onToggle,
}: {
  turn: TurnView;
  label: string;
  roster: Roster;
  me: string;
  branchName: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const writers = authorsOf(turn.prompt.spans);
  const faces = writers.length > 0 ? writers : [turn.sentBy];
  const names = faces.map((u) => authorName(roster, u, me)).join(', ');
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cx(
        'w-full rounded-lg border bg-surface px-3.5 py-3 text-left transition-colors',
        selected
          ? 'border-2 border-accent px-[13px] py-[11px]'
          : 'border-border-strong hover:bg-surface-2',
      )}
      data-testid="tree-turn"
      data-label={label}
    >
      <span className="flex gap-3">
        <span className="w-8 flex-none text-xs text-text-muted">{label}</span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-sm">{short(turn.prompt.text)}</b>
          <span className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
            <Faces uids={faces} roster={roster} />
            <span className="sr-only">Written by {names}.</span>
            <span className="truncate">
              {turn.status === 'streaming'
                ? 'streaming'
                : (roster[turn.sentBy]?.name ?? turn.senderName)}{' '}
              · {turn.provider.label.split(' · ')[0]} · {branchName}
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}

export function Tree({
  turns,
  branches,
  activeBranch,
  labels,
  roster,
  me,
  selected,
  merges,
  actions,
}: {
  turns: TurnView[];
  branches: BranchView[];
  activeBranch: string;
  labels: Record<string, string>;
  roster: Roster;
  me: string;
  selected: string[];
  merges: MergeEvent[];
  actions: TreeActions;
}) {
  const nameOf = (id: string) => branches.find((b) => b.id === id)?.name ?? id;
  const one = selected.length === 1 ? selected[0] : undefined;
  return (
    <div className="flex flex-col gap-3" data-testid="tree">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-semibold">Conversation tree</h2>
        <Button size="sm" onClick={actions.onFork}>
          Fork room
        </Button>
      </div>
      <p className="text-xs text-text-muted">
        Pick a turn to branch from it, or two turns to compare them. Every turn keeps its prompt,
        authors and model.
      </p>
      {branches.map((b) => {
        const own = turns.filter((t) => t.branchId === b.id);
        const active = b.id === activeBranch;
        return (
          <section
            key={b.id}
            aria-label={`Branch ${b.name}`}
            className={cx(
              'flex flex-col gap-2',
              b.id !== 'main' && 'border-l-2 border-dashed border-accent pl-3',
            )}
            data-testid="tree-branch"
            data-branch={b.name}
          >
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold tracking-wider text-text-muted uppercase">
                {b.id === 'main' ? 'main' : `branch · ${b.name}`}
              </span>
              {b.fromTurnId ? (
                <span className="text-xs text-text-muted">
                  from {labels[b.fromTurnId] ?? 'start'}
                </span>
              ) : null}
              {active ? (
                <span className="rounded-pill bg-accent-soft px-2 text-xs font-semibold text-accent">
                  active
                </span>
              ) : null}
            </div>
            {own.length === 0 ? (
              <p className="text-xs text-text-muted">
                No turns yet - the draft is waiting to be sent.
              </p>
            ) : (
              own.map((t) => (
                <TurnCard
                  key={t.id}
                  turn={t}
                  label={labels[t.id] ?? ''}
                  roster={roster}
                  me={me}
                  branchName={b.name}
                  selected={selected.includes(t.id)}
                  onToggle={() => {
                    actions.onToggleSelect(t.id);
                  }}
                />
              ))
            )}
            <div className="flex flex-wrap gap-2">
              {!active ? (
                <Button
                  size="sm"
                  onClick={() => {
                    actions.onSwitch(b.id);
                  }}
                >
                  Switch to {b.name}
                </Button>
              ) : null}
              {b.id !== 'main' ? (
                <Button
                  size="sm"
                  onClick={() => {
                    actions.onRename(b.id);
                  }}
                >
                  Rename
                </Button>
              ) : null}
              {b.id !== activeBranch ? (
                <Button
                  size="sm"
                  onClick={() => {
                    actions.onMerge(b.id);
                  }}
                >
                  Merge into {nameOf(activeBranch)}…
                </Button>
              ) : null}
            </div>
          </section>
        );
      })}
      <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-border bg-surface py-3">
        <Button
          size="sm"
          variant={one ? 'primary' : 'default'}
          disabled={!one}
          onClick={() => {
            if (one) actions.onBranchFrom(one);
          }}
        >
          + Branch from {one ? (labels[one] ?? 'turn') : 'a turn'}
        </Button>
        <Button size="sm" disabled={selected.length !== 2} onClick={actions.onCompare}>
          Compare{' '}
          {selected.length === 2 ? selected.map((id) => labels[id]).join(' vs ') : 'two turns'}
        </Button>
      </div>
      {merges.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-text-muted" aria-label="Merges">
          {merges.map((m) => (
            <li key={m.id}>
              {authorName(roster, m.by, me)} merged {nameOf(m.from)} into {nameOf(m.into)}
              {m.conflicts
                ? ` (${String(m.conflicts)} ${m.conflicts === 1 ? 'conflict' : 'conflicts'} resolved)`
                : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
