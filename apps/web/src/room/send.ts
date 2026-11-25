import {
  promptText,
  type AssembledMessage,
  type SendResult,
  type Span,
  type TurnError,
} from '@promptalong/core';
import {
  ProviderError,
  modelLabel,
  scrubSecrets,
  type Provider,
  type RoomModelChoice,
} from '@promptalong/providers';
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
 * The exact request body for the room's model. The context panel shows this string and Send posts
 * this string (ADR-005): both call this one function.
 */
export function buildBody(choice: RoomModelChoice, messages: AssembledMessage[]): string {
  return providerFor(choice).buildRequestBody({ model: choice.model, messages });
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

export function sendPrompt(
  session: RoomSession,
  retry?: Retry,
  tokens?: (text: string) => { tokens: number; exact: boolean } | null,
  /** the model to call instead of the room's one (the demo's scripted people use a fast demo model in tests) */
  override?: Provider,
): Promise<SendResult> {
  const snap = session.getSnapshot();
  const choice = snap.model;
  const provider = override ?? providerFor(choice);
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
    buildBody: (messages) => buildBody(choice, messages),
    ...(tokens ? { tokens } : {}),
    stream: (body, signal) => provider.stream(body, signal),
    clearPrompt: retry === undefined,
    describeError,
  });
}
