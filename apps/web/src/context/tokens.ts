import { approxTokens } from '@promptalong/providers';
import { useSyncExternalStore } from 'react';

/**
 * Token counts for the budget (ADR-005). Counting is asynchronous (a Web Worker, or the in-browser
 * model's own tokenizer), so counts are cached per text and the UI reads what is known so far:
 * until a count arrives it shows an estimate labelled "about".
 */
export type Backend = (texts: string[]) => Promise<number[] | null>;

const MAX_ENTRIES = 600;
const MAX_CHARS = 24_000_000;

export class TokenStore {
  private readonly caches = new Map<string, Map<string, number>>();
  private readonly asked = new Map<string, Set<string>>();
  private readonly broken = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private chars = 0;
  private version = 0;
  private readonly backend: (space: string) => Backend | null;

  constructor(backend: (space: string) => Backend | null) {
    this.backend = backend;
  }

  /** The count for a text in a counting space, if it is known. */
  peek(space: string, text: string): number | undefined {
    if (text.length === 0) return 0;
    return this.caches.get(space)?.get(text);
  }

  /** False once a space could not count (no worker, download failed): callers estimate instead. */
  works(space: string): boolean {
    return !this.broken.has(space);
  }

  /** Starts counting the texts that are not known yet. Subscribers hear when counts arrive. */
  ensure(space: string, texts: readonly string[]): void {
    if (this.broken.has(space)) return;
    const cache = this.cacheFor(space);
    const asked = this.asked.get(space) ?? new Set<string>();
    this.asked.set(space, asked);
    const missing = [...new Set(texts)].filter(
      (t) => t.length > 0 && !cache.has(t) && !asked.has(t),
    );
    if (missing.length === 0) return;
    const backend = this.backend(space);
    if (!backend) {
      this.fail(space);
      return;
    }
    for (const t of missing) asked.add(t);
    void backend(missing).then(
      (counts) => {
        for (const t of missing) asked.delete(t);
        // null = cannot count right now (e.g. the in-browser model is not started): ask again later
        if (!counts) return;
        missing.forEach((text, i) => {
          const n = counts[i];
          if (typeof n === 'number' && Number.isFinite(n)) this.remember(cache, text, n);
        });
        this.emit();
      },
      () => {
        for (const t of missing) asked.delete(t);
        this.fail(space);
      },
    );
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private cacheFor(space: string): Map<string, number> {
    let cache = this.caches.get(space);
    if (!cache) {
      cache = new Map();
      this.caches.set(space, cache);
    }
    return cache;
  }

  private remember(cache: Map<string, number>, text: string, tokens: number): void {
    cache.set(text, tokens);
    this.chars += text.length;
    // oldest first: forget counts for texts that are no longer on screen
    for (const [, c] of this.caches) {
      while ((c.size > MAX_ENTRIES || this.chars > MAX_CHARS) && c.size > 1) {
        const oldest = c.keys().next().value;
        if (oldest === undefined || oldest === text) break;
        c.delete(oldest);
        this.chars -= oldest.length;
      }
    }
  }

  private fail(space: string): void {
    if (this.broken.has(space)) return;
    this.broken.add(space);
    this.emit();
  }

  private emit(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }
}

export const O200K = 'o200k';
export const engineSpace = (model: string) => `engine:${model}`;

/** The o200k counter: one lazy worker for the tab. */
function workerBackend(): Backend | null {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker | null = null;
  let next = 1;
  const waiting = new Map<number, { resolve: (c: number[]) => void; reject: (e: Error) => void }>();
  const start = (): Worker => {
    const w = new Worker(new URL('./tokenizer.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (msg: MessageEvent<{ id: number; counts: number[] }>) => {
      waiting.get(msg.data.id)?.resolve(msg.data.counts);
      waiting.delete(msg.data.id);
    };
    w.onerror = () => {
      for (const [, p] of waiting) p.reject(new Error('the token counter could not start'));
      waiting.clear();
      w.terminate();
      worker = null;
    };
    return w;
  };
  return (texts) =>
    new Promise<number[]>((resolve, reject) => {
      try {
        worker ??= start();
        const id = next++;
        waiting.set(id, { resolve, reject });
        worker.postMessage({ id, texts });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
}

let engineCounter: ((model: string, texts: string[]) => Promise<number[] | null>) | null = null;

/** The app wires the in-browser model's tokenizer in here (kept out of this file's imports). */
export function setEngineCounter(
  counter: (model: string, texts: string[]) => Promise<number[] | null>,
): void {
  engineCounter = counter;
}

let o200k: Backend | null | undefined;

export const tokenStore = new TokenStore((space) => {
  if (space === O200K) {
    if (o200k === undefined) o200k = workerBackend();
    return o200k;
  }
  if (space.startsWith('engine:')) {
    const model = space.slice('engine:'.length);
    return (texts) => (engineCounter ? engineCounter(model, texts) : Promise.resolve(null));
  }
  return null;
});

/** Re-renders when new counts arrive. */
export function useTokenVersion(store: TokenStore = tokenStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}

/** The best count known right now, and whether it came from a tokenizer. */
export function knownTokens(
  store: TokenStore,
  space: string,
  text: string,
): { tokens: number; counted: boolean } {
  const n = store.peek(space, text);
  return n === undefined
    ? { tokens: approxTokens(text), counted: false }
    : { tokens: n, counted: true };
}
