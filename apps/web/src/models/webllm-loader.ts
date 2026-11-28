import {
  WEBLLM_MODELS,
  type LoadProgress,
  type WebLlmEngine,
  type WebLlmLoader,
} from '@promptalong/providers';

interface GpuNavigator {
  // not in every browser (and not in this project's DOM types)
  gpu?: { requestAdapter(): Promise<unknown> } | undefined;
}

/**
 * Loads the in-browser engine only when someone picks or uses it: the library and the model are
 * never part of the first page load (performance budget, R15).
 */
export const webLlmLoader: WebLlmLoader = {
  async hasWebGpu() {
    const gpu = (navigator as unknown as GpuNavigator).gpu;
    if (!gpu) return false;
    try {
      return (await gpu.requestAdapter()) !== null;
    } catch {
      return false;
    }
  },

  async isCached(model) {
    try {
      const lib = await import('@mlc-ai/web-llm');
      return await lib.hasModelInCache(model);
    } catch {
      return false;
    }
  },

  async load(model, onProgress: (p: LoadProgress) => void, signal) {
    const lib = await import('@mlc-ai/web-llm');
    const worker = new Worker(new URL('./webllm.worker.ts', import.meta.url), { type: 'module' });
    const stop = () => {
      worker.terminate();
    };
    signal.addEventListener('abort', stop, { once: true });
    try {
      // the engine starts with a 4,096-token window; ask for the window the catalog lists
      const window = WEBLLM_MODELS.find((m) => m.id === model)?.contextWindow;
      const engine = await lib.CreateWebWorkerMLCEngine(
        worker,
        model,
        {
          initProgressCallback: (r) => {
            onProgress({ progress: r.progress, text: r.text });
          },
        },
        window ? { context_window_size: window } : undefined,
      );
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      // The engine's OpenAI-style API matches WebLlmEngine; its request type is wider than ours.
      return engine as unknown as WebLlmEngine;
    } catch (error) {
      worker.terminate();
      throw error;
    } finally {
      signal.removeEventListener('abort', stop);
    }
  },
};
