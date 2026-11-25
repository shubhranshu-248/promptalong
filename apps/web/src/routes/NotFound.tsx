import { buttonClass, LogoMark } from '@promptalong/ui';
import { Link } from 'react-router';
import { SiteNav } from '../components/SiteNav';

/** Any unknown address (mockup 13 B). */
export function NotFound() {
  return (
    <>
      <SiteNav />
      <main className="grid place-items-center px-6 py-16 text-center md:py-[72px]">
        <p
          className="flex items-center justify-center gap-2.5 font-display text-[64px] leading-none font-bold tracking-[-0.04em] md:text-[96px]"
          aria-hidden="true"
        >
          4
          <span className="inline-flex size-14 md:size-[84px] [&>svg]:size-full">
            <LogoMark size={84} dot="var(--c-text)" />
          </span>
          4
        </p>
        <h1 className="mt-6 text-[28px] font-bold">This page wandered off</h1>
        <p className="mt-2 max-w-[420px] text-text-muted">
          The address does not match any page. If you were trying to join a room, ask for the
          6-character code.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <Link to="/" className={buttonClass({ variant: 'primary' })}>
            Go home
          </Link>
          <Link to="/new#join" className={buttonClass()}>
            Join with a code
          </Link>
        </div>
      </main>
    </>
  );
}
