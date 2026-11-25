import { LogoMark } from '@promptalong/ui';
import { lazy, Suspense } from 'react';
import { Link } from 'react-router';
import { DemoBanner } from './DemoBanner';
import { DEMO_ROOM_NAME } from './script';

// the room (editor, sync, model code) is the heavy part; this page draws first without it
const DemoRoom = lazy(() => import('./DemoRoom'));

/**
 * The demo room as it looks before anyone has typed, drawn from this small file while the room's
 * code loads - so a phone shows the room in about the time the home page takes, not seconds later.
 * The same layout and words as the empty room, so nothing jumps when the real room takes over.
 */
function DemoShell() {
  return (
    <div className="flex h-dvh flex-col" aria-busy="true">
      <DemoBanner phase="playing" />
      <header className="flex h-14 flex-none items-center gap-3 border-b border-border bg-surface px-4 max-md:gap-2 max-md:px-3">
        <Link to="/" aria-label="PromptAlong home" className="flex-none">
          <LogoMark size={28} dot="var(--c-text)" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate font-display text-[17px] leading-tight font-semibold">
            {DEMO_ROOM_NAME}
          </h1>
          <p className="text-xs text-text-muted md:hidden">Demo</p>
        </div>
      </header>
      {/* the room's columns: people | prompt and answers | context (from 1024 px) */}
      <div className="grid min-h-0 flex-1 max-md:grid-cols-1 md:grid-cols-[260px_1fr] lg:grid-cols-[260px_1fr_360px]">
        <div className="border-r border-border bg-surface max-md:hidden" />
        <main className="flex min-h-0 min-w-0 flex-col">
          <div className="flex flex-1 items-center justify-center p-8 max-md:p-4">
            <p className="max-w-[420px] text-center text-sm text-text-muted">
              Write the prompt together below - every keystroke shows up on every screen. When
              someone presses Send, the answer streams in here for everyone.
            </p>
          </div>
          {/* the shared prompt box, the height it has once the room is drawn */}
          <div className="flex h-[320px] flex-none flex-col border-t border-border bg-surface px-6 pt-3.5 pb-4 max-md:p-3 md:h-[325px] lg:h-[258px]">
            <p className="mb-2 text-xs font-bold">Shared prompt</p>
            <div className="min-h-0 flex-1 rounded-lg border border-border" />
          </div>
        </main>
        <div className="hidden border-l border-border bg-surface lg:block" />
      </div>
      <div className="h-[60px] flex-none border-t border-border bg-surface md:hidden" />
      <p className="sr-only" role="status">
        Opening the demo room…
      </p>
    </div>
  );
}

/**
 * /demo (F9, mockup 08): a room that lives only in this page, with three scripted teammates and
 * the demo model. No server, no model account, no network - and nothing is saved.
 */
export function DemoPage() {
  return (
    <Suspense fallback={<DemoShell />}>
      <DemoRoom fallback={<DemoShell />} />
    </Suspense>
  );
}
