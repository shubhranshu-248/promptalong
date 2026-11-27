import { Link } from 'react-router';
import { REPO_URL } from '../site';

const link = 'text-text-muted no-underline hover:text-text';

export function SiteFooter() {
  return (
    <footer className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-4 py-6 text-sm text-text-muted md:px-6">
      <p className="flex-1" data-testid="made-by">
        Made with{' '}
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          role="img"
          aria-label="love"
          className="inline-block align-[-2px] text-p1"
        >
          <path
            fill="currentColor"
            d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.2 0 3.7 1.2 5.4 3.2 1.7-2 3.2-3.2 5.4-3.2 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z"
          />
        </svg>{' '}
        by Shubh and Sidak
      </p>
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
