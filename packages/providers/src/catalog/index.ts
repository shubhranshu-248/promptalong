import type { ModelInfo, ProviderKind } from '../types';

/**
 * Model and vendor names live only in this folder (the trace check skips it).
 * Hosted endpoints are OpenAI-compatible and called from the browser (ADR-003); free tiers first.
 */
export interface Endpoint {
  id: string;
  label: string;
  baseUrl: string;
  /** where people create a key */
  keysUrl: string;
  /** the host the browser talks to (CSP connect-src, BYOK traffic test) */
  host: string;
  models: readonly ModelInfo[];
  /** extra headers some endpoints ask for (never secrets) */
  headers?: Readonly<Record<string, string>>;
}

export const ENDPOINTS: readonly Endpoint[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keysUrl: 'https://openrouter.ai/keys',
    host: 'openrouter.ai',
    headers: { 'X-Title': 'PromptAlong' },
    models: [
      {
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        label: 'Llama 3.3 70B (free)',
        contextWindow: 65_536,
        tokenizer: 'approx',
        free: true,
      },
      {
        id: 'deepseek/deepseek-chat-v3-0324:free',
        label: 'DeepSeek V3 (free)',
        contextWindow: 65_536,
        tokenizer: 'approx',
        free: true,
      },
      {
        id: 'mistralai/mistral-small-3.2-24b-instruct:free',
        label: 'Mistral Small 3.2 (free)',
        contextWindow: 32_768,
        tokenizer: 'approx',
        free: true,
      },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keysUrl: 'https://console.groq.com/keys',
    host: 'api.groq.com',
    models: [
      {
        id: 'openai/gpt-oss-120b',
        label: 'GPT-OSS 120B',
        contextWindow: 131_072,
        tokenizer: 'approx',
        free: true,
      },
      {
        id: 'openai/gpt-oss-20b',
        label: 'GPT-OSS 20B (fast)',
        contextWindow: 131_072,
        tokenizer: 'approx',
        free: true,
      },
    ],
  },
  {
    id: 'google',
    label: 'Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keysUrl: 'https://aistudio.google.com/apikey',
    host: 'generativelanguage.googleapis.com',
    models: [
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        contextWindow: 1_048_576,
        tokenizer: 'approx',
        free: true,
      },
      {
        id: 'gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash-Lite',
        contextWindow: 1_048_576,
        tokenizer: 'approx',
        free: true,
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keysUrl: 'https://platform.openai.com/api-keys',
    host: 'api.openai.com',
    models: [
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        contextWindow: 128_000,
        tokenizer: 'exact',
        encoding: 'o200k_base',
      },
      {
        id: 'gpt-4.1-mini',
        label: 'GPT-4.1 mini',
        contextWindow: 1_047_576,
        tokenizer: 'exact',
        encoding: 'o200k_base',
      },
    ],
  },
];

export function findEndpoint(id: string | undefined): Endpoint | undefined {
  return ENDPOINTS.find((e) => e.id === id);
}

/** Small open models that run in the browser (prebuilt for the in-browser engine). */
export const WEBLLM_MODELS: readonly ModelInfo[] = [
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 0.5B (smallest)',
    contextWindow: 4096,
    tokenizer: 'exact',
    free: true,
    sizeMb: 945,
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B',
    contextWindow: 4096,
    tokenizer: 'exact',
    free: true,
    sizeMb: 880,
  },
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    label: 'SmolLM2 360M (fastest)',
    contextWindow: 4096,
    tokenizer: 'exact',
    free: true,
    sizeMb: 376,
  },
];

export const OLLAMA_SUGGESTED_MODEL = 'llama3.2';

export const MOCK_MODELS: readonly ModelInfo[] = [
  {
    id: 'mock-pitch-coach',
    label: 'Demo model (scripted)',
    contextWindow: 8192,
    tokenizer: 'approx',
    free: true,
  },
];

export const CATALOG: Record<ProviderKind, readonly ModelInfo[]> = {
  mock: MOCK_MODELS,
  byok: ENDPOINTS.flatMap((e) => e.models),
  webllm: WEBLLM_MODELS,
  ollama: [],
};

export const DEFAULT_MODEL = { kind: 'mock', model: 'mock-pitch-coach' } as const;
