import { authorAt, diffWords, type TurnView } from '@promptalong/core';
import { approxTokens } from '@promptalong/providers';
import { Button } from '@promptalong/ui';
import type { ReactNode } from 'react';
import { authorColor, authorName, type Roster } from './authors';

function Card({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4" data-testid={testId}>
      <p className="mb-2 text-xs font-semibold tracking-wider text-text-muted uppercase">{title}</p>
      {children}
    </div>
  );
}

function short(answer: string): string {
  const t = answer.trim();
  return t.length > 420 ? `${t.slice(0, 420)}…` : t || '(no answer)';
}

/** What each turn sent as context: the same items, or what only one of them had. */
function contextLine(a: TurnView, b: TurnView): string {
  const key = (t: TurnView) => t.context.map((c) => `${c.itemId}:${c.hash}`).join('|');
  const names = (t: TurnView) => t.context.map((c) => c.title).join(', ') || 'none';
  const line = a.systemLine === b.systemLine ? '' : ' The room line was different.';
  if (a.context.length === 0 && b.context.length === 0) return `none on either turn.${line}`;
  if (key(a) === key(b))
    return `the same ${String(a.context.length)} on both (${names(a)}).${line}`;
  return `${names(a)} vs ${names(b)}.${line}`;
}

/** Mockup 04: two turns side by side - word diff of the prompts with authors, answers, model. */
export function Compare({
  a,
  b,
  labels,
  branchName,
  roster,
  me,
  activeBranchName,
  canMerge,
  onMerge,
  onClose,
}: {
  a: TurnView;
  b: TurnView;
  labels: Record<string, string>;
  branchName: (id: string) => string;
  roster: Roster;
  me: string;
  activeBranchName: string;
  canMerge: boolean;
  onMerge: () => void;
  onClose: () => void;
}) {
  const parts = diffWords(a.prompt.text, b.prompt.text);
  const nameA = branchName(a.branchId);
  const nameB = branchName(b.branchId);
  const tokens = (t: TurnView) => t.usage?.output ?? approxTokens(t.answer);
  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-4" data-testid="compare">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-xl font-semibold">Compare</h2>
        <span className="rounded-sm bg-surface-2 px-2 py-1 text-xs font-semibold">
          {nameA} · {labels[a.id]}
        </span>
        <span className="text-xs text-text-muted">vs</span>
        <span className="rounded-sm border-2 border-accent px-2 py-0.5 text-xs font-semibold">
          {nameB} · {labels[b.id]}
        </span>
        <span className="ml-auto flex gap-2">
          {canMerge ? (
            <Button variant="primary" onClick={onMerge}>
              Merge prompt changes into {activeBranchName}…
            </Button>
          ) : null}
          <Button onClick={onClose}>Back to the chat</Button>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Card title={`Prompt · ${nameA}`} testId="compare-prompt-a">
          <p className="whitespace-pre-wrap">
            {parts.map((p, i) =>
              p.type === 'added' ? null : p.type === 'removed' ? (
                <del key={i} className="mr-[0.3em] text-danger decoration-danger">
                  {p.text}
                </del>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </p>
        </Card>
        <Card title={`Prompt · ${nameB}`} testId="compare-prompt-b">
          <p className="whitespace-pre-wrap">
            {parts.map((p, i) => {
              if (p.type === 'removed') return null;
              if (p.type === 'same') return <span key={i}>{p.text}</span>;
              const uid = authorAt(b.prompt.spans, p.at);
              const c = authorColor(roster, uid);
              return (
                <ins
                  key={i}
                  title={uid ? `Written by ${authorName(roster, uid, me)}` : 'Added'}
                  className="no-underline"
                  style={{
                    textDecoration: `underline 2px ${c}`,
                    textUnderlineOffset: 3,
                    background: `color-mix(in srgb, ${c} 14%, transparent)`,
                  }}
                >
                  {p.text}
                </ins>
              );
            })}
          </p>
        </Card>
        <Card title={`Answer · ${nameA}${a.status === 'streaming' ? ' (streaming)' : ''}`}>
          <p className="text-sm whitespace-pre-wrap">{short(a.answer)}</p>
        </Card>
        <Card title={`Answer · ${nameB}${b.status === 'streaming' ? ' (streaming)' : ''}`}>
          <p className="text-sm whitespace-pre-wrap">{short(b.answer)}</p>
        </Card>
      </div>
      {canMerge ? (
        <p className="rounded-md bg-accent-soft px-3.5 py-3 text-sm">
          <b>Merge keeps authors.</b> Merging copies the changes from {nameB} into{' '}
          {activeBranchName}'s draft prompt with their writers' names on them. Nothing in either
          branch is deleted.
        </p>
      ) : null}
      <p className="text-xs text-text-muted">
        Model:{' '}
        {a.provider.label === b.provider.label
          ? `${a.provider.label} on both`
          : `${a.provider.label} vs ${b.provider.label}`}
        {' · '}Tokens: {tokens(a).toLocaleString()} vs {tokens(b).toLocaleString()}
      </p>
      <p className="text-xs text-text-muted" data-testid="compare-context">
        Context: {contextLine(a, b)}
      </p>
    </div>
  );
}
