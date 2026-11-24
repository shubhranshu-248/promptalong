import { ENDPOINTS } from '@promptalong/providers';
import { useSyncExternalStore } from 'react';
import { keyStore } from './key-store';

/** Which endpoints have a key in this browser (never the values), for rendering. */
export function useKeyStore(): KeyStoreView {
  return useSyncExternalStore(
    (l) => keyStore.subscribe(l),
    () => keyView(),
  );
}

interface KeyStoreView {
  has: (endpoint: string) => boolean;
  remembered: (endpoint: string) => boolean;
}

let cachedView: { sig: string; view: KeyStoreView } | null = null;
function keyView(): KeyStoreView {
  const sig = ENDPOINTS.map(
    (e) => `${e.id}:${String(keyStore.has(e.id))}:${String(keyStore.isRemembered(e.id))}`,
  ).join('|');
  if (cachedView?.sig !== sig) {
    cachedView = {
      sig,
      view: {
        has: (e) => keyStore.has(e),
        remembered: (e) => keyStore.isRemembered(e),
      },
    };
  }
  return cachedView.view;
}
