import * as Dialog from '@radix-ui/react-dialog';
import { useId, useMemo, useState } from 'react';
import { searchSessions, type SearchHit, type SearchSource } from './search';

/** Search the prompts and answers of every session this person may open. */
export function SearchDialog({
  open,
  onOpenChange,
  sources,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: () => SearchSource[];
  onPick: (hit: SearchHit) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const hits = useMemo(
    () => (open ? searchSessions(sources(), query) : []),
    // (the sessions are read when the query changes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, query],
  );
  const pick = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onOpenChange(false);
    onPick(hit);
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setQuery('');
          setActive(0);
        }
        onOpenChange(o);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[50] bg-[rgba(17,18,24,.45)]" />
        <Dialog.Content
          className="fixed top-[12vh] left-1/2 z-[51] flex max-h-[70vh] w-[min(640px,calc(100%-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface text-text shadow-lg"
          aria-describedby={undefined}
          data-testid="search-dialog"
        >
          <Dialog.Title className="sr-only">Search the sessions</Dialog.Title>
          <label htmlFor={id} className="sr-only">
            Search prompts and answers
          </label>
          <input
            id={id}
            autoFocus
            value={query}
            placeholder="Search prompts and answers in your sessions…"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, hits.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(hits[active]);
              }
            }}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={`${id}-list`}
            aria-activedescendant={hits.length > 0 ? `${id}-${String(active)}` : undefined}
            className="h-14 w-full flex-none border-b border-border bg-surface px-5 text-base outline-none"
            data-testid="search-input"
          />
          <ul
            id={`${id}-list`}
            role="listbox"
            aria-label="Results"
            className="min-h-0 flex-1 overflow-y-auto p-1.5"
          >
            {hits.map((h, i) => (
              <li
                key={`${h.sessionId}:${h.turnId}`}
                id={`${id}-${String(i)}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => {
                  setActive(i);
                }}
                onClick={() => {
                  pick(h);
                }}
                className={`cursor-pointer rounded-lg px-3.5 py-2.5 ${i === active ? 'bg-surface-2' : ''}`}
                data-testid="search-hit"
              >
                <p className="text-xs text-text-muted">
                  {h.sessionName} · {h.label} · {h.where}
                </p>
                <p className="mt-0.5 text-sm break-words">
                  {h.before}
                  <mark className="rounded-sm bg-accent-soft px-0.5 text-text">{h.match}</mark>
                  {h.after}
                </p>
              </li>
            ))}
          </ul>
          {query.trim() && hits.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-text-muted" role="status">
              Nothing found. Search looks in the sessions you can open.
            </p>
          ) : null}
          <p className="flex-none border-t border-border px-5 py-2.5 text-xs text-text-muted">
            ↑ ↓ to move · Enter to open · Esc to close
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
