import { buttonClass, Card, Chip } from '@promptalong/ui';
import { Link } from 'react-router';
import { SiteFooter } from '../components/SiteFooter';
import { SiteNav } from '../components/SiteNav';
import { REPO_URL } from '../site';

const FACTS = [
  { big: '8', text: 'people per room with live cursors' },
  { big: '4', text: 'model backends: demo, your key, in-browser, Ollama' },
  { big: 'Rs 0', text: 'to run - free tiers and open source only' },
];

const HIGHLIGHTS = [
  {
    title: 'Collaborative prompt editor',
    body: 'Live cursors, edits that merge without conflicts (Yjs) and authorship on every part of the prompt.',
  },
  {
    title: 'Context transparency',
    body: 'Everyone attaches context; the panel shows the exact payload byte-for-byte with a live token budget.',
  },
  {
    title: 'Any model',
    body: 'Use the demo model, your own API key, a model that runs in your browser, or Ollama on your laptop. Long prompts and files are fine: up to 1 MB per context item.',
  },
] as const;

/** /about: what PromptAlong is, its features, privacy, and who built it. */
export function About() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[720px] px-4 pt-6 pb-12 md:px-8 md:pt-8">
        <Chip tone="accent">About</Chip>
        <h1 className="mt-3.5 text-[32px] font-bold md:text-[44px]">One prompt, many hands.</h1>
        <p className="mt-2.5 leading-relaxed text-text-muted">
          PromptAlong is a real-time multiplayer prompting workspace. A team writes one prompt
          together with live cursors, presses Send once, and everyone watches the same answer stream
          in. It sits on top of the models you already have - including free ones.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link to="/demo" className={`${buttonClass({ variant: 'primary' })} rounded-pill`}>
            Try the live demo
          </Link>
          <Link to="/new" className={`${buttonClass()} rounded-pill`}>
            Start a room
          </Link>
        </div>
        <ul className="mt-7 grid grid-cols-1 gap-3 p-0 md:grid-cols-3" role="list">
          {FACTS.map((f) => (
            <li key={f.big} className="list-none">
              <Card className="h-full p-3.5">
                <b className="block font-display text-[22px] leading-tight font-semibold">
                  {f.big}
                </b>
                <span className="text-xs text-text-muted">{f.text}</span>
              </Card>
            </li>
          ))}
        </ul>

        <h2 className="mt-10 text-xl font-bold">What it does</h2>
        <dl className="mt-3 flex flex-col gap-3.5">
          {HIGHLIGHTS.map((h) => (
            <div key={h.title}>
              <dt className="text-[15px] font-semibold">{h.title}</dt>
              <dd className="m-0 mt-0.5 text-sm leading-relaxed text-text-muted">{h.body}</dd>
            </div>
          ))}
        </dl>

        <h2 id="privacy" className="mt-10 text-xl font-bold">
          Your key stays yours
        </h2>
        <ul className="mt-2.5 list-disc space-y-1.5 pl-[18px] text-sm">
          <li>
            A model key you add is kept only in your browser. It never goes to the room, to our
            server or into an export.
          </li>
          <li>
            Prompts, answers and context live in the room you share. Rooms nobody has opened for 30
            days are deleted automatically.
          </li>
          <li>
            The demo room runs entirely in your browser: nothing in it is sent anywhere or saved.
          </li>
          <li>No ads, no tracking scripts, no third-party fonts.</li>
        </ul>

        <h2 className="mt-10 text-xl font-bold">Built with</h2>
        <p className="mt-2.5 text-sm text-text-muted">
          React, TypeScript, Yjs, TipTap, Supabase and Vercel. Source code on{' '}
          <a href={REPO_URL} className="text-accent underline">
            GitHub
          </a>{' '}
          under the MIT licence. Read the{' '}
          <a href={`${REPO_URL}/blob/main/docs/case-study.md`} className="text-accent underline">
            case study
          </a>{' '}
          and{' '}
          <a href={`${REPO_URL}/blob/main/docs/architecture.md`} className="text-accent underline">
            architecture
          </a>{' '}
          docs for details on how it works.
        </p>

        <h2 className="mt-10 text-xl font-bold">Team</h2>
        <p className="mt-2.5 text-sm text-text-muted">
          Made by Shubh (Shubhranshu Sahu) and Sidak (Sidak Kaur Gurpreet Singh Sachdev).
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
