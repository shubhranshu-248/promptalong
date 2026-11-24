/**
 * The one interface every model backend implements. Backends arrive in P3:
 * mock (scripted, no network), byok (the user's own key, browser -> provider),
 * webllm (in the browser via WebGPU) and ollama (localhost).
 */
export type ProviderKind = 'mock' | 'byok' | 'webllm' | 'ollama';

export interface ModelInfo {
  id: string;
  label: string;
  contextWindow: number;
  tokenizer: 'exact' | 'approx';
  free?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface StreamChunk {
  text: string;
  done?: boolean;
  usage?: { input: number; output: number };
}

export type Availability = { ok: true } | { ok: false; reason: string };

export interface Provider {
  readonly kind: ProviderKind;
  available(): Promise<Availability>;
  listModels(): Promise<ModelInfo[]>;
  /** The exact request body. The context panel shows this string and Send posts this string. */
  buildRequestBody(req: ChatRequest): string;
  stream(body: string, signal: AbortSignal): AsyncIterable<StreamChunk>;
}

/** What a room stores about its model. Never a key. */
export interface RoomModelChoice {
  kind: ProviderKind;
  model: string;
}
