import {
  ByokProvider,
  MockProvider,
  OllamaProvider,
  WebLlmProvider,
  type Provider,
  type RoomModelChoice,
} from '@promptalong/providers';
import { setEngineCounter } from '../context/tokens';
import { keyStore } from '../keys/key-store';
import { webLlmLoader } from './webllm-loader';

/** One instance per kind for the whole tab (the in-browser engine is expensive to start). */
export const mockProvider = new MockProvider();
export const ollamaProvider = new OllamaProvider();
export const webLlmProvider = new WebLlmProvider(webLlmLoader);
// the budget counts with the in-browser model's own tokenizer once that model is started
setEngineCounter((model, texts) => webLlmProvider.countTokens(model, texts));

export function providerFor(choice: RoomModelChoice): Provider {
  switch (choice.kind) {
    case 'mock':
      return mockProvider;
    case 'ollama':
      return ollamaProvider;
    case 'webllm':
      return webLlmProvider;
    case 'byok': {
      const endpoint = choice.endpoint ?? '';
      return new ByokProvider({ endpoint, getKey: () => keyStore.get(endpoint) });
    }
  }
}
