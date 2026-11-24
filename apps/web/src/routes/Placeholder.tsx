import type { ReactNode } from 'react';
import { buttonClass } from '@promptalong/ui';
import { Link } from 'react-router';
import { SiteFooter } from '../components/SiteFooter';
import { SiteNav } from '../components/SiteNav';

function ComingSoon({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[720px] px-4 py-16 md:px-6">
        <h1 className="text-[32px] font-bold md:text-[44px]">{title}</h1>
        <div className="mt-4 text-[17px] text-text-muted">{children}</div>
        <Link to="/" className={`${buttonClass()} mt-8`}>
          Back to the start
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}

export function Demo() {
  return (
    <ComingSoon title="Live demo">
      The demo room with scripted teammates opens here soon. It runs fully in your browser.
    </ComingSoon>
  );
}

export function About() {
  return (
    <ComingSoon title="About PromptAlong">
      PromptAlong is a real-time multiplayer prompting workspace: several people co-write one
      prompt, one person presses Send, and everyone watches the same answer stream in.
    </ComingSoon>
  );
}
