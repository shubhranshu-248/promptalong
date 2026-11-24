import { CATALOG, DEFAULT_MODEL, findEndpoint } from './catalog/index';
import type { ProviderKind, RoomModelChoice } from './types';

const KINDS = new Set<ProviderKind>(['mock', 'byok', 'webllm', 'ollama']);

/** Validates a model choice read from the room document (it comes from the network). */
export function readModelChoice(value: unknown): RoomModelChoice {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_MODEL };
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== 'string' || !KINDS.has(v.kind as ProviderKind)) return { ...DEFAULT_MODEL };
  if (typeof v.model !== 'string' || v.model.length === 0 || v.model.length > 200) {
    return { ...DEFAULT_MODEL };
  }
  const kind = v.kind as ProviderKind;
  const choice: RoomModelChoice = { kind, model: v.model };
  if (kind === 'byok') {
    if (typeof v.endpoint !== 'string' || !findEndpoint(v.endpoint)) return { ...DEFAULT_MODEL };
    choice.endpoint = v.endpoint;
  }
  if (typeof v.setBy === 'string' && v.setBy.length <= 64) choice.setBy = v.setBy;
  return choice;
}

export function sameChoice(a: RoomModelChoice, b: RoomModelChoice): boolean {
  return a.kind === b.kind && a.model === b.model && a.endpoint === b.endpoint;
}

/** "Demo model", "OpenRouter · Llama 3.3 70B (free)", "In your browser · Qwen …", "Ollama · llama3.2". */
export function modelLabel(choice: RoomModelChoice, short = false): string {
  const model = CATALOG[choice.kind].find((m) => m.id === choice.model);
  switch (choice.kind) {
    case 'mock':
      return short ? 'Demo' : 'Demo model';
    case 'byok': {
      const endpoint = findEndpoint(choice.endpoint);
      const name = model?.label ?? choice.model;
      return short ? (endpoint?.label ?? 'Own key') : `${endpoint?.label ?? 'Own key'} · ${name}`;
    }
    case 'webllm':
      return short ? 'In browser' : `In-browser · ${model?.label ?? choice.model}`;
    case 'ollama':
      return short ? 'Ollama' : `Ollama · ${choice.model}`;
  }
}
