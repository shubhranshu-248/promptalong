import { cx } from '@promptalong/ui';
import { useSyncExternalStore } from 'react';
import { currentTheme, onThemeChange, setThemePreference } from '../theme';

const Sun = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
  </svg>
);

const Moon = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>
);

/** Switches between light and dark (the choice is kept on this device). */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(onThemeChange, () => currentTheme());
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => {
        setThemePreference(next);
      }}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cx(
        'grid size-9 flex-none place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text',
        className,
      )}
      data-testid="theme-toggle"
      data-theme-now={theme}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
    </button>
  );
}
