export type Theme = 'light' | 'dark';

/** The theme to use when the visitor has not picked one: follows the OS setting. */
export function systemTheme(
  matchMedia: (q: string) => { matches: boolean } = window.matchMedia.bind(window),
): Theme {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}
