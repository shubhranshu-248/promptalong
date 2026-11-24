import type { HTMLAttributes } from 'react';
import { cx } from '../cx';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'accent' | undefined;
}

export function Chip({ tone = 'neutral', className, ...rest }: ChipProps) {
  return (
    <span
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-pill px-2.5 text-xs font-semibold',
        tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-text',
        className,
      )}
      {...rest}
    />
  );
}
