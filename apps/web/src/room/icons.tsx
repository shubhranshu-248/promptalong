import type { SVGProps } from 'react';

/** Small line icons (24 px grid, stroke = current colour). Decorative: the button carries the name. */
function Icon({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
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
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const SidebarIcon = () => (
  <Icon>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M9.5 4.5v15" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const ArrowUpIcon = () => (
  <Icon strokeWidth="2.2">
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const StopIcon = () => (
  <Icon>
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
  </Icon>
);

export const CopyIcon = () => (
  <Icon>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon strokeWidth="2.2">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const RetryIcon = () => (
  <Icon>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v4h4" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon strokeWidth="2.6">
    <path d="M6 12h.01M12 12h.01M18 12h.01" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const ChevronDownIcon = () => (
  <Icon width="14" height="14">
    <path d="M6 9l6 6 6-6" />
  </Icon>
);

export const PaperclipIcon = () => (
  <Icon>
    <path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4L15 7" />
  </Icon>
);

export const LinkIcon = () => (
  <Icon>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Icon>
);

export const CompareIcon = () => (
  <Icon>
    <rect x="3" y="5" width="7.5" height="14" rx="1.5" />
    <rect x="13.5" y="5" width="7.5" height="14" rx="1.5" />
  </Icon>
);

export const PinIcon = () => (
  <Icon>
    <path d="M9 4h6l-1 6 3 3H7l3-3-1-6z" />
    <path d="M12 16v5" />
  </Icon>
);

export const LockIcon = () => (
  <Icon width="14" height="14">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);
