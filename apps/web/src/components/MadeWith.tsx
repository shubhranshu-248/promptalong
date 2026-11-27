import { cx } from '@promptalong/ui';

/**
 * "Made with ♥ by Shubh and Sidak". The heart is drawn in the text colour, so it is black on the
 * light theme and white on the dark one.
 */
export function MadeWith({
  className,
  testId = 'made-by',
}: {
  className?: string;
  testId?: string;
}) {
  return (
    <p className={cx('text-text', className)} data-testid={testId}>
      Made with{' '}
      <svg
        viewBox="0 0 24 24"
        width="15"
        height="15"
        role="img"
        aria-label="love"
        className="inline-block align-[-2px]"
      >
        <path
          fill="currentColor"
          d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.2 0 3.7 1.2 5.4 3.2 1.7-2 3.2-3.2 5.4-3.2 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z"
        />
      </svg>{' '}
      by Shubh and Sidak
    </p>
  );
}
