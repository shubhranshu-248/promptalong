import type { ReactNode } from 'react';
import { buttonClass } from '@promptalong/ui';
import { formatRoomCode, normalizeRoomCode } from '@promptalong/core';
import { Link, useParams } from 'react-router';
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

export function NewRoom() {
  return (
    <ComingSoon title="Start or join a room">
      Rooms are being built right now. Soon you will create a room here, or type a 6-letter code to
      join one.
    </ComingSoon>
  );
}

export function Room() {
  const { code = '' } = useParams();
  const valid = normalizeRoomCode(code);
  return (
    <ComingSoon title={valid ? `Room ${formatRoomCode(valid)}` : 'That code does not look right'}>
      {valid
        ? 'Shared rooms open here soon.'
        : 'Room codes are 6 letters and numbers, like K7Q-M2X.'}
    </ComingSoon>
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
