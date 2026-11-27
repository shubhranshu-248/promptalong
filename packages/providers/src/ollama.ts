import { ProviderError, errorFromResponse, isAbort } from './errors';
import { ndjson } from './streams';
import type { ChatRequest, ModelInfo, Provider, StreamChunk } from './types';

/**
 * Ollama on the sender's own computer (ADR-003). The browser talks to localhost directly, so
 * Ollama must allow this site's origin (OLLAMA_ORIGINS).
 */
export const OLLAMA_URL = 'http://localhost:11434';
/** the largest context PromptAlong asks Ollama for */
export const OLLAMA_MAX_CONTEXT = 131_072;

/**
 * Ollama keeps a small default context (a few thousand tokens) and silently cuts what does not
 * fit. Each request asks for a context that holds it: its size estimated at 3 characters a token,
 * plus room for the answer, rounded up to a power of two (8,192 at least, 131,072 at most), so a
 * short chat does not reserve memory it does not need.
 */
export function ollamaContextFor(messages: readonly { content: string }[]): number {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  const need = Math.ceil(chars / 3) + 4096;
  let size = 8192;
  while (size < need && size < OLLAMA_MAX_CONTEXT) size *= 2;
  return size;
}

export interface OllamaOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** detection timeout in ms (default 1500) */
  timeoutMs?: number;
}

export class OllamaProvider implements Provider {
  readonly kind = 'ollama' as const;
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = options.baseUrl ?? OLLAMA_URL;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 1500;
  }

  private async tags(): Promise<ModelInfo[]> {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      ctrl.abort();
    }, this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/tags`, {
        signal: ctrl.signal,
        credentials: 'omit',
      });
      if (!res.ok) throw await errorFromResponse(res);
      const json = (await res.json()) as { models?: { name?: unknown }[] };
      return (json.models ?? [])
        .map((m) => (typeof m.name === 'string' ? m.name : ''))
        .filter(Boolean)
        .map((name) => ({
          id: name,
          label: name,
          contextWindow: OLLAMA_MAX_CONTEXT,
          tokenizer: 'approx' as const,
          free: true,
        }));
    } finally {
      clearTimeout(t);
    }
  }

  async available() {
    try {
      const models = await this.tags();
      return models.length > 0
        ? { ok: true as const }
        : { ok: false as const, reason: 'Ollama is running but has no models yet.' };
    } catch {
      return { ok: false as const, reason: `Ollama was not found at ${this.baseUrl}.` };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      return await this.tags();
    } catch {
      return [];
    }
  }

  buildRequestBody(req: ChatRequest): string {
    const options: Record<string, number> = { num_ctx: ollamaContextFor(req.messages) };
    if (req.maxTokens !== undefined) options.num_predict = req.maxTokens;
    if (req.temperature !== undefined) options.temperature = req.temperature;
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
    };
    body.options = options;
    return JSON.stringify(body);
  }

  async *stream(body: string, signal: AbortSignal): AsyncIterable<StreamChunk> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal,
        credentials: 'omit',
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new ProviderError(
        'network',
        `Could not reach Ollama at ${this.baseUrl}. Is it running, with OLLAMA_ORIGINS set for this site?`,
      );
    }
    if (!res.ok) throw await errorFromResponse(res);
    if (!res.body) throw new ProviderError('bad-response', 'The answer had no body.');
    for await (const line of ndjson(res.body, signal)) {
      const v = (line ?? {}) as Record<string, unknown>;
      if (typeof v.error === 'string') throw new ProviderError('other', v.error);
      const message = v.message as Record<string, unknown> | undefined;
      const text = typeof message?.content === 'string' ? message.content : '';
      if (v.done === true) {
        if (text) yield { text };
        const input = typeof v.prompt_eval_count === 'number' ? v.prompt_eval_count : undefined;
        const output = typeof v.eval_count === 'number' ? v.eval_count : undefined;
        yield input !== undefined && output !== undefined
          ? { text: '', done: true, usage: { input, output } }
          : { text: '', done: true };
        return;
      }
      if (text) yield { text };
    }
    yield { text: '', done: true };
  }
}

/** The one-line setup shown when Ollama is not reachable. */
export function ollamaOriginsHint(origin: string): string {
  return `OLLAMA_ORIGINS=${origin}`;
}
