import { promptText, type SendResult, type TurnError } from '@promptalong/core';
import { ProviderError, modelLabel, scrubSecrets } from '@promptalong/providers';
import { providerFor } from '../models/providers';
import type { RoomSession } from './session';

/** A thrown error, made safe to show to everyone in the room (no key, no header). */
export function describeError(error: unknown): TurnError {
  if (error instanceof ProviderError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.status !== undefined ? { status: error.status } : {}),
    };
  }
  const text = error instanceof Error ? error.message : String(error);
  return {
    code: 'other',
    message: scrubSecrets(text).slice(0, 300) || 'The model did not answer.',
  };
}

/**
 * Sends the shared prompt (or, for Retry, an earlier turn's prompt) with the room's model. Only
 * this browser calls the model; the answer reaches everyone through the room document.
 */
export function sendPrompt(session: RoomSession, retryText?: string): Promise<SendResult> {
  const snap = session.getSnapshot();
  const choice = snap.model;
  const provider = providerFor(choice);
  const text = retryText ?? promptText(session.doc).trim();
  return session.stream.send({
    promptText: text,
    provider: {
      kind: choice.kind,
      model: choice.model,
      label: modelLabel(choice),
      ...(choice.endpoint ? { endpoint: choice.endpoint } : {}),
    },
    buildBody: (messages) => provider.buildRequestBody({ model: choice.model, messages }),
    stream: (body, signal) => provider.stream(body, signal),
    clearPrompt: retryText === undefined,
    describeError,
  });
}
