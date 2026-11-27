import { AvatarStack, buttonClass, type Person } from '@promptalong/ui';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { MadeWith } from '../components/MadeWith';
import { SiteFooter } from '../components/SiteFooter';
import { SiteNav } from '../components/SiteNav';

const PEOPLE: Person[] = [
  { id: 'aarav', name: 'Aarav Rao', slot: 1 },
  { id: 'meera', name: 'Meera Kulkarni', slot: 2 },
  { id: 'kabir', name: 'Kabir Shah', slot: 3 },
];

const FEATURES = [
  {
    slot: 1,
    title: 'One prompt, many hands',
    body: 'Live cursors on a single prompt. One Send, and the same answer streams to every screen.',
  },
  {
    slot: 2,
    title: 'Who wrote what',
    body: 'Every part of a prompt keeps its author, so the team can see how a question came together.',
  },
  {
    slot: 3,
    title: 'Exactly what is sent',
    body: 'Everyone attaches their own notes and files. You see the request byte for byte, with a live token count.',
  },
  {
    slot: 5,
    title: 'Any model, even free ones',
    body: 'The demo model, your own key, a model that runs in your browser, or Ollama on your laptop.',
  },
] as const;

const USE_CASES = [
  {
    title: 'Hackathon teams',
    body: 'Write the pitch prompt in one room instead of pasting prompts between laptops.',
  },
  {
    title: 'Study groups',
    body: 'Ask the hard question together and read one answer, with each person’s notes attached.',
  },
  {
    title: 'Project teams',
    body: 'Keep the whole conversation in one shared place, and export it when you are done.',
  },
] as const;

type Slot = 1 | 2 | 3 | 5;
const slotStyle = (slot: Slot) =>
  ({
    '--p': `var(--p-${String(slot)})`,
    '--pl': `var(--p-${String(slot)}-label)`,
  }) as CSSProperties;

/** Text written by one person: underlined in their colour. */
function Authored({ slot, children }: { slot: Slot; children: ReactNode }) {
  return (
    <span style={slotStyle(slot)} className="shadow-[inset_0_-2px_0_var(--p)]">
      {children}
    </span>
  );
}

/** Someone's live cursor with a name tag. */
function Cursor({ slot, name }: { slot: Slot; name: string }) {
  return (
    <span
      style={slotStyle(slot)}
      className="relative -mx-px inline-block h-[1.25em] w-0.5 bg-[var(--p)] align-text-bottom"
    >
      <span className="absolute bottom-full -left-px rounded-[3px_3px_3px_0] bg-[var(--p)] px-1 py-0.5 text-[10.5px] leading-none font-semibold whitespace-nowrap text-[var(--pl)]">
        {name}
      </span>
    </span>
  );
}

/** A still of a room: the streaming answer above, the shared composer with three people below. */
function RoomPreview() {
  return (
    <figure
      className="m-0 rounded-[28px] border border-border bg-bg p-4 shadow-lg md:p-5"
      aria-label="Preview of a shared room"
    >
      <div className="mb-4 flex items-center gap-2">
        <AvatarStack people={PEOPLE} />
        <span className="text-sm text-text-muted">3 people in “Hackathon pitch”</span>
      </div>
      <div className="px-1 text-[15px] leading-relaxed">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs text-text-muted">
          <span className="pa-live-dot" aria-hidden="true" />
          Answering for 3 people
        </p>
        Last semester, Ishita lost her ID card two days before exams. She found it - but only after
        <span aria-hidden="true" className="pa-stream-caret" />
      </div>
      <div className="relative mt-5 rounded-[22px] border border-border bg-surface px-4 pt-6 pb-3 shadow-md">
        <div className="pa-strands" aria-hidden="true">
          <i style={{ background: 'var(--p-1)' }} data-active="" />
          <i style={{ background: 'var(--p-2)' }} data-active="" />
          <i style={{ background: 'var(--p-3)' }} data-active="" />
        </div>
        <p className="text-[15px] leading-[2.2]">
          Draft a 2-minute pitch for <Authored slot={1}>our campus lost-and-found app</Authored>
          <Cursor slot={1} name="Aarav" />.{' '}
          <Authored slot={2}>Judges care about real users, so open with a story</Authored>
          <Cursor slot={2} name="Meera" /> and <Authored slot={3}>end with one clear ask</Authored>
          <Cursor slot={3} name="Kabir" />.
        </p>
        <div className="mt-2 flex items-center justify-end">
          <span className="pa-send" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </span>
        </div>
      </div>
    </figure>
  );
}

export function Landing() {
  return (
    <>
      <SiteNav />
      <main>
        <header className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-10 px-4 pt-8 pb-14 md:grid-cols-[1fr_1fr] md:gap-14 md:px-6 md:pt-16 md:pb-20">
          <div>
            <h1 className="text-[44px] leading-[1.02] font-bold tracking-[-0.045em] md:text-[68px]">
              Everyone prompts.
              <br />
              One answer.
            </h1>
            <p className="mt-6 max-w-[500px] text-[17px] leading-relaxed text-text-muted md:text-[19px]">
              Write one prompt together with live cursors, press Send once, and watch the same
              answer arrive on every screen. Like a sing-along, but for AI.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/new"
                className={`${buttonClass({ variant: 'primary', size: 'lg' })} flex-1 rounded-pill md:flex-none`}
              >
                Start a room
              </Link>
              <Link
                to="/demo"
                className={`${buttonClass({ size: 'lg' })} flex-1 rounded-pill md:flex-none`}
              >
                Try the live demo
              </Link>
            </div>
            <p className="mt-4 text-sm text-text-muted">
              Free, no sign-up. Your model key never leaves your browser.
            </p>
          </div>
          <RoomPreview />
        </header>

        <section aria-label="What makes it different" className="border-y border-border bg-surface">
          <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-x-10 gap-y-8 px-4 py-14 md:grid-cols-2 md:px-6 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <span
                  aria-hidden="true"
                  className="block h-[3px] w-10 rounded-pill"
                  style={{ background: `var(--p-${String(f.slot)})` }}
                />
                <h2 className="mt-4 text-[19px] font-semibold tracking-[-0.02em]">{f.title}</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section
          aria-label="Who it is for"
          className="mx-auto grid max-w-[1180px] grid-cols-1 gap-8 px-4 py-14 md:grid-cols-3 md:px-6"
        >
          {USE_CASES.map((s) => (
            <div key={s.title}>
              <h2 className="text-lg font-semibold tracking-[-0.02em]">{s.title}</h2>
              <p className="mt-1.5 text-[15px] leading-relaxed text-text-muted">{s.body}</p>
            </div>
          ))}
        </section>

        <section
          aria-label="See it in action"
          className="mx-auto mb-16 flex max-w-[1180px] flex-col items-center gap-4 px-4 text-center md:px-6"
        >
          <div className="w-full rounded-[28px] bg-text px-6 py-12 text-bg md:py-16">
            <h2 className="text-[28px] font-bold tracking-[-0.03em] md:text-[36px]">
              See a room in 30 seconds
            </h2>
            <p className="mx-auto mt-3 max-w-[460px] text-[15px] opacity-75">
              Three scripted teammates write a prompt with you and one answer streams in. It runs
              entirely in your browser.
            </p>
            <Link
              to="/demo"
              className="mt-7 inline-flex h-12 items-center rounded-pill bg-bg px-6 font-semibold text-text no-underline hover:opacity-90"
            >
              Open the live demo
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter credit={false} />
      {/* the credit line stays on the home screen, in both themes */}
      <div className="h-16" aria-hidden="true" />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[max(12px,env(safe-area-inset-bottom))]">
        <MadeWith
          className="pointer-events-auto rounded-pill border border-border bg-surface/90 px-4 py-1.5 text-sm shadow-sm backdrop-blur"
          testId="made-by-pinned"
        />
      </div>
    </>
  );
}
