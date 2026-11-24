import { cx } from '../cx';

export type ButtonVariant = 'default' | 'primary' | 'accent' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface StyleProps {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
}

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border font-semibold leading-none no-underline ' +
  'transition-colors duration-[var(--d-fast)] ease-standard disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  default: 'border-border-strong bg-surface text-text hover:bg-surface-2',
  primary: 'border-primary-btn-bg bg-primary-btn-bg text-primary-btn-text hover:opacity-90',
  accent: 'border-accent bg-accent text-text-on-accent hover:bg-accent-hover',
  ghost: 'border-transparent bg-transparent text-text hover:bg-surface-2',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-10 px-2.5 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-[22px] text-base',
};

export function buttonClass({ variant = 'default', size = 'md' }: StyleProps = {}): string {
  return cx(base, variants[variant], sizes[size]);
}
