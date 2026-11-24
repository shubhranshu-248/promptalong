import { useId } from 'react';

export interface LogoMarkProps {
  size?: number;
  /** Colour of the end dot. Defaults to the ink colour (light surfaces). */
  dot?: string;
  title?: string;
}

/** The PromptAlong mark: three strands that meet in one dot. */
export function LogoMark({ size = 28, dot = 'var(--brand-ink)', title }: LogoMarkProps) {
  const titleId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-labelledby={title ? titleId : undefined}
      focusable="false"
    >
      {title ? <title id={titleId}>{title}</title> : null}
      <g fill="none" strokeWidth={6} strokeLinecap="round">
        <path d="M12 17 C27 17 30 32 42 32" stroke="var(--brand-strand-1)" />
        <path d="M12 32 H42" stroke="var(--brand-strand-2)" />
        <path d="M12 47 C27 47 30 32 42 32" stroke="var(--brand-strand-3)" />
      </g>
      <circle cx={51} cy={32} r={7} fill={dot} />
    </svg>
  );
}
