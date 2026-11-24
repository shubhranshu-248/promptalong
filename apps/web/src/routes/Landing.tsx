import { AvatarStack, Card, Chip, buttonClass, type Person } from '@promptalong/ui';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { SiteFooter } from '../components/SiteFooter';
import { SiteNav } from '../components/SiteNav';

const PEOPLE: Person[] = [
  { id: 'aarav', name: 'Aarav Rao', slot: 1 },
  { id: 'meera', name: 'Meera Kulkarni', slot: 2 },
  { id: 'kabir', name: 'Kabir Shah', slot: 3 },
];

const USPS = [
  {
    title: 'One prompt, many hands',
    body: 'Live cursors on a single prompt. One Send, one stream that everyone watches together.',
  },
  {
    title: 'Who wrote what',
    body: 'Every part of the prompt keeps its author. Branch, fork and merge the conversation like code.',
  },
  {
    title: 'See exactly what is sent',
    body: 'Everyone adds context; the panel shows the exact payload and a live token budget.',
  },
  {
    title: 'Any model, zero cost',
    body: 'Demo model, your own key, a model in your browser, or one running on your laptop.',
  },
] as const;

const STEPS = [
  { title: 'Start a room', body: 'Share the link or the 6-letter code with your team.' },
  { title: 'Write together', body: 'Everyone edits the same prompt and adds their own context.' },
  { title: 'Send once', body: 'One answer streams to everyone and is saved with who wrote what.' },
] as const;

type Slot = 1 | 2 | 3;
const slotStyle = (slot: Slot) =>
  ({ '--p': `var(--p-${slot})`, '--pl': `var(--p-${slot}-label)` }) as CSSProperties;

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

function RoomPreview() {
  return (
    <Card className="p-[18px]" aria-label="Preview of a shared room" role="figure">
      <div className="mb-3 flex items-center gap-2">
        <AvatarStack people={PEOPLE} />
        <span className="text-sm text-text-muted">3 people in &quot;Hackathon pitch&quot;</span>
      </div>
      <div className="rounded-xl border-[1.5px] border-accent px-3.5 pt-[22px] pb-2.5 text-[15px] leading-[2.3]">
        Draft a 2-minute pitch for <Authored slot={1}>our campus lost-and-found app</Authored>
        <Cursor slot={1} name="Aarav" />.{' '}
        <Authored slot={2}>Judges care about real users, so open with a story</Authored>
        <Cursor slot={2} name="Meera" /> and{' '}
        <span style={slotStyle(3)} className="bg-[color-mix(in_srgb,var(--p)_22%,transparent)]">
          end with one clear ask
        </span>
        <Cursor slot={3} name="Kabir" />.
      </div>
      <div className="mt-3.5 rounded-xl bg-surface-2 p-3.5 text-sm">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-text-muted">
          <span className="inline-block size-2 rounded-full bg-success" aria-hidden="true" />
          Streaming to 3 people
        </div>
        Last semester, Ishita lost her ID card two days before exams. She found it - but only after
        <span
          aria-hidden="true"
          className="caret-blink ml-0.5 inline-block h-[1.1em] w-2 bg-stream-caret align-text-bottom"
        />
      </div>
    </Card>
  );
}

export function Landing() {
  return (
    <>
      <SiteNav />
      <main>
        <header className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-7 px-4 py-6 md:grid-cols-[1.05fr_1fr] md:gap-14 md:px-6 md:pt-14 md:pb-10">
          <div>
            <Chip tone="accent">Like a sing-along, but for AI</Chip>
            <h1 className="mt-[18px] text-[40px] font-bold md:text-[60px]">
              Everyone prompts.
              <br />
              One answer.
            </h1>
            <p className="mt-[18px] max-w-[520px] text-[17px] text-text-muted md:text-[19px]">
              Write one prompt together with live cursors, press Send once, and watch the same
              answer stream in on every screen. Bring any model - even free ones.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                to="/new"
                className={`${buttonClass({ variant: 'primary', size: 'lg' })} flex-1 md:flex-none`}
              >
                Start a room
              </Link>
              <Link to="/demo" className={`${buttonClass({ size: 'lg' })} flex-1 md:flex-none`}>
                Try the live demo
              </Link>
            </div>
            <p className="mt-3.5 text-sm text-text-muted">
              No sign-up. Free. Your model key never leaves your browser.
            </p>
          </div>
          <RoomPreview />
        </header>

        <section
          aria-label="What makes it different"
          className="mx-auto grid max-w-[1200px] grid-cols-1 gap-4 px-4 pt-2 pb-6 md:grid-cols-2 md:px-6 md:pt-6 md:pb-10 lg:grid-cols-4"
        >
          {USPS.map((u, i) => (
            <Card key={u.title} className="p-5">
              <span className="font-mono text-xs leading-none font-semibold text-text-muted">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h2 className="mt-3 mb-2 text-[19px] font-bold">{u.title}</h2>
              <p className="text-sm text-text-muted">{u.body}</p>
            </Card>
          ))}
        </section>

        <section
          id="how"
          aria-label="How it works"
          className="mx-auto grid max-w-[1200px] grid-cols-1 gap-6 px-4 pt-2 pb-10 md:grid-cols-3 md:px-6 md:pt-6 md:pb-16"
        >
          {STEPS.map((s, i) => (
            <div key={s.title} className="flex gap-3.5">
              <span
                aria-hidden="true"
                className="grid size-8 flex-none place-items-center rounded-full bg-text font-display text-sm leading-none font-bold text-bg"
              >
                {i + 1}
              </span>
              <div>
                <h2 className="text-lg font-bold">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h2>
                <p className="text-sm text-text-muted">{s.body}</p>
              </div>
            </div>
          ))}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
