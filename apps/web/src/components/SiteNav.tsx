import { buttonClass, LogoMark } from '@promptalong/ui';
import { Link } from 'react-router';
import { REPO_URL } from '../site';

export function SiteNav() {
  return (
    <nav
      aria-label="Main"
      className="mx-auto flex h-[60px] max-w-[1200px] items-center gap-6 px-4 md:h-[72px] md:px-6"
    >
      <Link
        to="/"
        className="flex items-center gap-2.5 font-display text-lg font-bold tracking-[-0.02em] text-text no-underline"
      >
        <LogoMark size={28} dot="var(--c-text)" />
        PromptAlong
      </Link>
      <span className="flex-1" />
      <Link
        to="/demo"
        className="hidden text-sm font-medium text-text-muted no-underline hover:text-text md:inline"
      >
        Live demo
      </Link>
      <a
        href={REPO_URL}
        className="hidden text-sm font-medium text-text-muted no-underline hover:text-text md:inline"
      >
        GitHub
      </a>
      <Link to="/new#join" className={buttonClass({ size: 'sm' })}>
        Join with code
      </Link>
    </nav>
  );
}
