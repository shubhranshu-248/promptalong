import { Card, Chip } from '@promptalong/ui';
import { SiteFooter } from '../components/SiteFooter';
import { SiteNav } from '../components/SiteNav';
import { REPO_URL } from '../site';

const FACTS = [
  { big: '8', text: 'people per room' },
  { big: '4', text: 'kinds of model: demo, your key, in-browser, Ollama' },
  { big: 'Rs 0', text: 'to run - free tiers and open source only' },
];

/** /about (mockup 13 A): what PromptAlong is, and what happens to your data. */
export function About() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[720px] px-4 pt-6 pb-12 md:px-8 md:pt-8">
        <Chip tone="accent">About</Chip>
        <h1 className="mt-3.5 text-[32px] font-bold md:text-[44px]">One prompt, many hands.</h1>
        <p className="mt-2.5 leading-relaxed text-text-muted">
          PromptAlong is a real-time workspace where a team writes one prompt together, presses Send
          once, and everyone watches the same answer arrive. It sits on top of the models you
          already have - including free ones.
        </p>
        <ul className="mt-5 grid grid-cols-1 gap-3 p-0 md:grid-cols-3" role="list">
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

        <h2 id="privacy" className="mt-8 text-xl font-bold">
          Your key stays yours
        </h2>
        <ul className="mt-2.5 list-disc space-y-1.5 pl-[18px] text-sm">
          <li>
            A model key you add is kept only in your browser. It never goes to the room, to our
            server or into an export.
          </li>
          <li>
            Prompts, answers and context live in the room you share. Rooms nobody has opened for 30
            days are deleted.
          </li>
          <li>
            The demo room runs entirely in your browser: nothing in it is sent anywhere or saved.
          </li>
          <li>No ads, no tracking scripts, no third-party fonts.</li>
        </ul>

        <h2 className="mt-8 text-xl font-bold">Built with</h2>
        <p className="mt-2.5 text-sm text-text-muted">
          React, TypeScript, Yjs, TipTap, Supabase and Vercel. Source code on{' '}
          <a href={REPO_URL} className="text-accent underline">
            GitHub
          </a>{' '}
          under the MIT licence.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
