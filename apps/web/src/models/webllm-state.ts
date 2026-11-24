import { useSyncExternalStore } from 'react';
import { webLlmProvider } from './providers';

/** The in-browser model's download / start state for this tab (shared by the dialog and Send). */
export interface WebLlmState {
  status: 'idle' | 'downloading' | 'ready' | 'error';
  model: string | null;
  progress: number;
  text: string;
  error?: string;
}

let state: WebLlmState = { status: 'idle', model: null, progress: 0, text: '' };
const listeners = new Set<() => void>();
let ctrl: AbortController | null = null;

function set(next: WebLlmState): void {
  state = next;
  for (const l of listeners) l();
}

webLlmProvider.onProgress((p) => {
  if (state.status === 'downloading') set({ ...state, progress: p.progress, text: p.text });
});

export function webLlmState(): WebLlmState {
  return state;
}

export function useWebLlmState(): WebLlmState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function isWebLlmReady(model: string): boolean {
  return state.status === 'ready' && state.model === model;
}

/** Downloads (once; later loads come from the browser cache) and starts the model. */
export function startWebLlm(model: string): void {
  if ((state.status === 'downloading' || state.status === 'ready') && state.model === model) return;
  ctrl?.abort();
  const mine = new AbortController();
  ctrl = mine;
  set({ status: 'downloading', model, progress: 0, text: 'Starting…' });
  webLlmProvider.prepare(model, mine.signal).then(
    () => {
      if (ctrl === mine) set({ status: 'ready', model, progress: 1, text: 'Ready' });
    },
    (error: unknown) => {
      if (ctrl !== mine) return;
      if (mine.signal.aborted) {
        set({ status: 'idle', model: null, progress: 0, text: '' });
        return;
      }
      set({
        status: 'error',
        model,
        progress: 0,
        text: '',
        error: error instanceof Error ? error.message : 'The model could not start.',
      });
    },
  );
}

/** Stops a download. What is already downloaded stays in the browser cache. */
export function cancelWebLlm(): void {
  ctrl?.abort();
  ctrl = null;
  set({ status: 'idle', model: null, progress: 0, text: '' });
}
