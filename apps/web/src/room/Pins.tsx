import type { PinView } from '@promptalong/core';
import { Button } from '@promptalong/ui';
import { DialogShell } from './dialogs';
import { PinIcon } from './icons';
import { Markdown } from './Markdown';

const firstLine = (text: string) =>
  text
    .split('\n')
    .find((l) => l.trim())
    ?.trim() ?? '';

/** Answers kept for the whole room, in the sidebar. */
export function PinnedList({ pins, onOpen }: { pins: PinView[]; onOpen: (pin: PinView) => void }) {
  if (pins.length === 0) return null;
  return (
    <section aria-labelledby="pins-h" data-testid="pin-list">
      <h2 id="pins-h" className="px-2 font-body text-xs font-medium text-text-muted">
        Pinned for the room
      </h2>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {pins.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => {
                onOpen(p);
              }}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
              data-testid="pin-item"
            >
              <span className="mt-0.5 flex-none text-text-muted">
                <PinIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {firstLine(p.prompt) || 'Answer'}
                </span>
                <span className="block truncate text-xs text-text-muted">
                  {p.sessionName} · {p.label} · pinned by {p.byName}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One pin: its prompt and answer, a way to its session, and Unpin. */
export function PinDialog({
  pin,
  onClose,
  canOpenSession,
  canUnpin,
  onOpenSession,
  onUnpin,
}: {
  pin: PinView | null;
  onClose: () => void;
  canOpenSession: boolean;
  canUnpin: boolean;
  onOpenSession: () => void;
  onUnpin: () => void;
}) {
  return (
    <DialogShell
      open={pin !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      wide
      title={pin ? `${pin.sessionName} · ${pin.label}` : 'Pinned answer'}
      footer={
        <>
          {canUnpin ? (
            <Button onClick={onUnpin} data-testid="unpin">
              Unpin
            </Button>
          ) : null}
          {canOpenSession ? (
            <Button variant="primary" onClick={onOpenSession} data-testid="pin-open-session">
              Open the session
            </Button>
          ) : null}
        </>
      }
    >
      {pin ? (
        <div className="flex flex-col gap-4" data-testid="pin-view">
          <blockquote className="border-l-[3px] border-border-strong pl-3 text-sm whitespace-pre-wrap text-text-muted">
            {pin.prompt}
          </blockquote>
          <Markdown text={pin.answer} />
          {pin.clipped ? (
            <p className="text-xs text-text-muted">
              A pin keeps the first 20,000 characters. The whole answer is in its session.
            </p>
          ) : null}
          <p className="text-xs text-text-muted">
            Pinned by {pin.byName}. Everyone in the room can read it, also people who are not in
            this session.
          </p>
        </div>
      ) : null}
    </DialogShell>
  );
}
