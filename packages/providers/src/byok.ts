import { findEndpoint, type Endpoint } from './catalog/index';
import { ProviderError, errorFromResponse, isAbort, scrubSecrets } from './errors';
import { sseData } from './streams';
import type { ChatRequest, ModelInfo, Provider, StreamChunk } from './types';

/**
 * "Your own key": an OpenAI-compatible chat endpoint called straight from this browser (ADR-003).
 * The key is fetched through `getKey` at send time and only ever goes into the Authorization
 * header of the request to the endpoint's own host. It is never part of the body.
 */
export interface ByokOptions {
  endpoint: string;
  getKey: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export class ByokProvider implements Provider {
  readonly kind = 'byok' as const;
  readonly endpoint: Endpoint;
  private readonly getKey: () => Promise<string | null>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ByokOptions) {
    const endpoint = findEndpoint(options.endpoint);
    if (!endpoint) throw new ProviderError('not-found', `unknown provider "${options.endpoint}"`);
    this.endpoint = endpoint;
    this.getKey = options.getKey;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async available() {
    const key = await this.getKey();
    return key
      ? { ok: true as const }
      : { ok: false as const, reason: `No ${this.endpoint.label} key in this browser.` };
  }

  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve([...this.endpoint.models]);
  }

  buildRequestBody(req: ChatRequest): string {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
    };
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    return JSON.stringify(body);
  }

  async *stream(body: string, signal: AbortSignal): AsyncIterable<StreamChunk> {
    const key = await this.getKey();
    if (!key) throw new ProviderError('auth', `No ${this.endpoint.label} key in this browser.`);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.endpoint.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${key}`,
          ...this.endpoint.headers,
        },
        body,
        signal,
        // no cookies, no referrer details: the request carries the key and the body, nothing else
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new ProviderError(
        'network',
        `Could not reach ${this.endpoint.label}. ${scrubSecrets(String(error), [key])}`,
      );
    }
    if (!res.ok) throw await errorFromResponse(res, [key]);
    if (!res.body) throw new ProviderError('bad-response', 'The answer had no body.');

    let usage: StreamChunk['usage'];
    for await (const data of sseData(res.body, signal)) {
      if (data === '[DONE]') break;
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        continue; // keep-alive or a partial line from a proxy
      }
      const parsed = parseChunk(json);
      if (parsed.error) throw new ProviderError('other', parsed.error);
      if (parsed.usage) usage = parsed.usage;
      if (parsed.text) yield { text: parsed.text };
    }
    yield usage ? { text: '', done: true, usage } : { text: '', done: true };
  }
}

interface ParsedChunk {
  text: string;
  usage?: { input: number; output: number };
  error?: string;
}

/** One OpenAI-style streaming chunk: choices[0].delta.content (+ usage on the last one). */
export function parseChunk(json: unknown): ParsedChunk {
  if (typeof json !== 'object' || json === null) return { text: '' };
  const v = json as Record<string, unknown>;
  if (v.error !== undefined) {
    const e = v.error as Record<string, unknown> | string;
    return {
      text: '',
      error: typeof e === 'string' ? e : typeof e.message === 'string' ? e.message : 'error',
    };
  }
  const choices = Array.isArray(v.choices) ? (v.choices as Record<string, unknown>[]) : [];
  const delta = choices[0]?.delta as Record<string, unknown> | undefined;
  const text = typeof delta?.content === 'string' ? delta.content : '';
  const u = v.usage as Record<string, unknown> | undefined | null;
  if (u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number') {
    return { text, usage: { input: u.prompt_tokens, output: u.completion_tokens } };
  }
  return { text };
}
