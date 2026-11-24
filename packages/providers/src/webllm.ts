import { WEBLLM_MODELS } from './catalog/index';
import { ProviderError, isAbort } from './errors';
import { parseChunk } from './byok';
import type { ChatRequest, ModelInfo, Provider, StreamChunk } from './types';

/**
 * A small open model running in this browser through WebGPU (ADR-003). The engine itself is
 * loaded by the app (lazy import, Web Worker), so this package stays tiny and testable: it only
 * needs the small `WebLlmLoader` surface below.
 */
export interface WebLlmEngine {
  chat: {
    completions: {
      create(request: Record<string, unknown>): Promise<AsyncIterable<unknown>>;
    };
  };
  interruptGenerate(): void;
}

export interface LoadProgress {
  /** 0..1 */
  progress: number;
  text: string;
}

export interface WebLlmLoader {
  hasWebGpu(): Promise<boolean>;
  isCached(model: string): Promise<boolean>;
  load(
    model: string,
    onProgress: (p: LoadProgress) => void,
    signal: AbortSignal,
  ): Promise<WebLlmEngine>;
}

export class WebLlmProvider implements Provider {
  readonly kind = 'webllm' as const;
  private readonly loader: WebLlmLoader;
  private engine: { model: string; engine: Promise<WebLlmEngine> } | null = null;
  private progressListeners = new Set<(p: LoadProgress) => void>();

  constructor(loader: WebLlmLoader) {
    this.loader = loader;
  }

  async available() {
    return (await this.loader.hasWebGpu())
      ? { ok: true as const }
      : {
          ok: false as const,
          reason:
            'This browser does not support WebGPU, which the in-browser model needs. Try a recent Chrome or Edge on a computer.',
        };
  }

  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve([...WEBLLM_MODELS]);
  }

  isCached(model: string): Promise<boolean> {
    return this.loader.isCached(model);
  }

  onProgress(listener: (p: LoadProgress) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  /** Downloads (first time) and starts the model. Safe to call again; one load per model. */
  prepare(model: string, signal: AbortSignal): Promise<WebLlmEngine> {
    if (this.engine?.model === model) return this.engine.engine;
    const engine = this.loader
      .load(
        model,
        (p) => {
          for (const l of this.progressListeners) l(p);
        },
        signal,
      )
      .catch((error: unknown) => {
        if (this.engine?.engine === engine) this.engine = null;
        if (isAbort(error)) throw error;
        throw new ProviderError(
          'unavailable',
          `The in-browser model could not start: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    this.engine = { model, engine };
    return engine;
  }

  buildRequestBody(req: ChatRequest): string {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    return JSON.stringify(body);
  }

  async *stream(body: string, signal: AbortSignal): AsyncIterable<StreamChunk> {
    const request = JSON.parse(body) as Record<string, unknown> & { model: string };
    const engine = await this.prepare(request.model, signal);
    const onAbort = () => {
      engine.interruptGenerate();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    let usage: StreamChunk['usage'];
    try {
      // The engine already runs this model; the body's other fields go to it unchanged.
      const rest: Record<string, unknown> = { ...request };
      delete rest.model;
      const chunks = await engine.chat.completions.create(rest);
      for await (const chunk of chunks) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const parsed = parseChunk(chunk);
        if (parsed.usage) usage = parsed.usage;
        if (parsed.text) yield { text: parsed.text };
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    yield usage ? { text: '', done: true, usage } : { text: '', done: true };
  }
}
