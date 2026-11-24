import type { ModelInfo, ProviderKind } from '../types';

/**
 * Model and vendor names live only in this folder (the trace check skips it).
 * P1 ships just the scripted demo model; real catalogs are added in P3.
 */
export const CATALOG: Record<ProviderKind, readonly ModelInfo[]> = {
  mock: [
    {
      id: 'mock-pitch-coach',
      label: 'Demo model (scripted)',
      contextWindow: 8192,
      tokenizer: 'approx',
      free: true,
    },
  ],
  byok: [],
  webllm: [],
  ollama: [],
};

export const DEFAULT_MODEL = { kind: 'mock', model: 'mock-pitch-coach' } as const;
