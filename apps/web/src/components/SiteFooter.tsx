import { Link } from 'react-router';
import { REPO_URL } from '../site';
import { MadeWith } from './MadeWith';

const link = 'text-text-muted no-underline hover:text-text';

/** The site footer; the home page shows the credit line pinned on screen instead (credit=false). */
export function SiteFooter({ credit = true }: { credit?: boolean }) {
  return (
    <footer className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-4 py-6 text-sm text-text-muted md:px-6">
      {credit ? <MadeWith className="flex-1" /> : <span className="flex-1" />}
      <Link to="/demo" className={link}>
        Demo
      </Link>
      <Link to="/about" className={link}>
        About
      </Link>
      <Link to="/about#privacy" className={link}>
        Privacy
      </Link>
      <a href={REPO_URL} className={link}>
        GitHub
      </a>
    </footer>
  );
}
