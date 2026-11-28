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
    <div className="flex h-dvh overflow-hidden bg-bg" aria-busy="true">
      <div className="w-[272px] flex-none border-r border-border bg-surface max-lg:hidden" />
      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner phase="playing" />
        <header className="flex h-14 flex-none items-center gap-1.5 px-3 max-md:px-2">
          <Link
            to="/"
            aria-label="PromptAlong home"
            className="grid size-9 place-items-center lg:hidden"
          >
            <LogoMark size={22} dot="var(--c-text)" />
          </Link>
          <h1 className="truncate px-1.5 font-display text-[16px] leading-tight font-semibold">
            {DEMO_ROOM_NAME}
          </h1>
        </header>
        <main className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 px-6 pt-6 max-md:px-4">
            <div className="mx-auto flex max-w-[640px] flex-col items-center pt-[10vh] text-center max-md:pt-[6vh]">
              <p className="text-[30px] font-semibold tracking-[-0.03em] max-md:text-[24px]">
                What should we ask together?
              </p>
            </div>
          </div>
          {/* the composer, the height it has once the room is drawn */}
          <div className="px-4 pt-3 pb-3 max-md:px-2.5">
            <div className="mx-auto h-[106px] max-w-[760px] rounded-[22px] border border-border bg-surface shadow-md" />
            <p className="mt-2 min-h-[1lh] text-xs">&nbsp;</p>
          </div>
        </main>
      </div>
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
