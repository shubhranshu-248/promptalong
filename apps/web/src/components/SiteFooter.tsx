import { Link } from 'react-router';
import { REPO_URL } from '../site';

export function SiteFooter() {
  return (
    <footer className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-5 text-sm text-text-muted md:px-6">
      <span className="flex-1">
        PromptAlong - built by Shubhranshu Sahu and Sidak Kaur Gurpreet Singh Sachdev
      </span>
      <Link to="/demo" className="text-text-muted underline hover:text-text">
        Demo
      </Link>
      <Link to="/about" className="text-text-muted underline hover:text-text">
        About
      </Link>
      <Link to="/about#privacy" className="text-text-muted underline hover:text-text">
        Privacy
      </Link>
      <a href={REPO_URL} className="text-text-muted underline hover:text-text">
        GitHub
      </a>
    </footer>
  );
}
