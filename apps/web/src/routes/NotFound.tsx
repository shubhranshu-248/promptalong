import { buttonClass } from '@promptalong/ui';
import { Link } from 'react-router';
import { SiteNav } from '../components/SiteNav';

export function NotFound() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[720px] px-4 py-16 md:px-6">
        <h1 className="text-[32px] font-bold">Page not found</h1>
        <p className="mt-4 text-text-muted">This page does not exist.</p>
        <Link to="/" className={`${buttonClass()} mt-8`}>
          Back to the start
        </Link>
      </main>
    </>
  );
}
