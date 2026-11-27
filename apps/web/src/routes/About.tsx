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
    body: 'Live cursors, real-time merge (Yjs CRDT) and per-segment authorship so you always know who wrote what.',
  },
  {
    title: 'Branching conversations',
    body: 'Branch from any turn, fork a room, compare two branches side by side and merge prompt changes back.',
  },
  {
    title: 'Context transparency',
    body: 'Everyone attaches context; the panel shows the exact payload byte-for-byte with a live token budget.',
  },
  {
    title: 'Model-agnostic',
    body: 'One provider interface, four backends. Use the demo model, bring your own API key, run a model in-browser with WebLLM, or use Ollama on localhost.',
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
          <Link to="/demo" className={buttonClass({ variant: 'primary' })}>
            Try the live demo
          </Link>
          <Link to="/new" className={buttonClass()}>
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
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {HIGHLIGHTS.map((h) => (
            <Card key={h.title} className="p-4">
              <h3 className="text-sm font-bold">{h.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{h.body}</p>
            </Card>
          ))}
        </div>

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
          Built by Shubhranshu Sahu and Sidak Kaur Gurpreet Singh Sachdev.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
