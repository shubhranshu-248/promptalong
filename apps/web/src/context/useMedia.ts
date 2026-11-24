import { useSyncExternalStore } from 'react';

/** True while a media query matches (true where the browser cannot tell). */
export function matchesMedia(query: string): boolean {
  return typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : true;
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => {
        list.removeEventListener('change', listener);
      };
    },
    () => matchesMedia(query),
  );
}
