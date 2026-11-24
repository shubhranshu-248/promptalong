import type { Span } from '@promptalong/core';
import type { ReactNode } from 'react';
import { authorColor, authorName, type Roster } from './authors';

/** Participant ids are plain ASCII; anything else is dropped before it reaches a CSS selector. */
const safe = (uid: string) => uid.replace(/[^A-Za-z0-9_-]/gu, '');

/**
 * Colours for the author marks inside the shared editor (one rule per person in the roster). The
 * underline + tint carry the colour; "Written by X" on hover carries the name (colour is never the
 * only cue).
 */
export function AuthorStyles({ roster, show }: { roster: Roster; show: boolean }) {
  if (!show) return null;
  const rules = Object.keys(roster)
    .filter((uid) => safe(uid) === uid && uid)
    .map((uid) => {
      const c = authorColor(roster, uid);
      return `.pa-show-authors .pa-author[data-author="${uid}"]{text-decoration:underline 2px ${c};text-underline-offset:3px;background:color-mix(in srgb,${c} 12%,transparent)}`;
    })
    .join('\n');
  return <style>{rules}</style>;
}

/** A frozen prompt with its author spans (turn bubbles, compare). */
export function AttributedText({
  text,
  spans,
  roster,
  me,
  show,
}: {
  text: string;
  spans: readonly Span[];
  roster: Roster;
  me?: string;
  show: boolean;
}) {
  if (!show || spans.length === 0) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  for (const s of [...spans].sort((a, b) => a.from - b.from)) {
    if (s.from > at) out.push(text.slice(at, s.from));
    const from = Math.max(s.from, at);
    if (s.to <= from) continue;
    const c = authorColor(roster, s.uid);
    out.push(
      <span
        key={`${String(from)}-${s.uid}`}
        title={`Written by ${authorName(roster, s.uid, me)}`}
        data-author={s.uid}
        style={{
          textDecoration: `underline 2px ${c}`,
          textUnderlineOffset: 3,
          background: `color-mix(in srgb, ${c} 12%, transparent)`,
        }}
      >
        {text.slice(from, s.to)}
      </span>,
    );
    at = s.to;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}
