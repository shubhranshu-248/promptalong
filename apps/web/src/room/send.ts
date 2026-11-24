import { promptText, type SendResult, type Span, type TurnError } from '@promptalong/core';
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
 * Sends the active branch's shared prompt (or, for Retry, an earlier turn's prompt with its
 * authors) with the room's model. Only
 * this browser calls the model; the answer reaches everyone through the room document.
 */
export interface Retry {
  text: string;
  spans: Span[];
}

export function sendPrompt(session: RoomSession, retry?: Retry): Promise<SendResult> {
  const snap = session.getSnapshot();
  const choice = snap.model;
  const provider = providerFor(choice);
  const branchId = snap.activeBranch;
  const text = retry?.text ?? promptText(session.doc, branchId).trim();
  return session.stream.send({
    promptText: text,
    ...(retry ? { spans: retry.spans } : {}),
    branchId,
    provider: {
      kind: choice.kind,
      model: choice.model,
      label: modelLabel(choice),
      ...(choice.endpoint ? { endpoint: choice.endpoint } : {}),
    },
    buildBody: (messages) => provider.buildRequestBody({ model: choice.model, messages }),
    stream: (body, signal) => provider.stream(body, signal),
    clearPrompt: retry === undefined,
    describeError,
  });
}
