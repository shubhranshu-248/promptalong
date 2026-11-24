/**
 * Errors shown to people come from the network, so they are scrubbed before display: anything that
 * looks like a key or an Authorization header is replaced (ADR-003, R10).
 */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:authorization|x-api-key|api[-_]?key)\s*[:=]\s*(?:bearer\s+)?["']?[^\s"',}]+/giu,
  /\bbearer\s+[\w.~+/-]{8,}=*/giu,
  /\bsk-[\w-]{6,}/gu,
  /\bgsk_[\w-]{6,}/gu,
  /\bAIza[\w-]{10,}/gu,
  /\b(?:key|token)=[\w.~+/-]{8,}/giu,
];

export function scrubSecrets(text: string, extra: readonly string[] = []): string {
  let out = text;
  for (const secret of extra) {
    if (secret.length >= 4) out = out.split(secret).join('[hidden]');
  }
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[hidden]');
  return out;
}

export type ProviderErrorCode =
  | 'auth'
  | 'rate-limit'
  | 'not-found'
  | 'network'
  | 'unavailable'
  | 'bad-response'
  | 'aborted'
  | 'other';

/** A failure that is safe to show to everyone in the room (no key, no header). */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number | undefined;

  constructor(code: ProviderErrorCode, message: string, status?: number) {
    super(scrubSecrets(message).slice(0, 300));
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

export function codeForStatus(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status === 404) return 'not-found';
  if (status >= 500) return 'unavailable';
  return 'other';
}

/** Reads a provider's error response into a short, scrubbed message. */
export async function errorFromResponse(res: Response, secrets: readonly string[] = []) {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as unknown;
      detail = findMessage(json) ?? text;
    } catch {
      detail = text;
    }
  } catch {
    // no body
  }
  const message = scrubSecrets(detail.trim() || res.statusText || 'request failed', secrets);
  return new ProviderError(codeForStatus(res.status), message, res.status);
}

function findMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.message === 'string') return v.message;
  if (typeof v.error === 'string') return v.error;
  if (Array.isArray(value)) return findMessage(value[0]);
  return findMessage(v.error);
}

export function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof ProviderError && error.code === 'aborted') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}
