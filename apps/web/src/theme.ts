import { safeStorage } from './room/storage';

export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

const KEY = 'promptalong:theme';

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

export function getThemePreference(): ThemePreference {
  const v = safeStorage.get(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function setThemePreference(pref: ThemePreference): void {
  safeStorage.set(KEY, pref);
  applyThemePreference(pref);
}

export function applyThemePreference(pref: ThemePreference = getThemePreference()): void {
  applyTheme(pref === 'system' ? systemTheme() : pref);
}
