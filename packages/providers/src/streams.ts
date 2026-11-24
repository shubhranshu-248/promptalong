/** Line-based stream readers that survive chunks split anywhere (even inside a UTF-8 character). */

async function* lines(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        yield buffer.slice(0, nl).replace(/\r$/u, '');
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer.replace(/\r$/u, '');
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

/** Server-sent events: yields each event's `data` (multi-line data joined with "\n"). */
export async function* sseData(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<string> {
  let data: string[] = [];
  for await (const line of lines(body, signal)) {
    if (line === '') {
      if (data.length > 0) yield data.join('\n');
      data = [];
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /u, ''));
    }
    // comments (": keep-alive"), event:, id:, retry: are ignored
  }
  if (data.length > 0) yield data.join('\n');
}

/** Newline-delimited JSON (Ollama): yields each parsed line. */
export async function* ndjson(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<unknown> {
  for await (const line of lines(body, signal)) {
    if (line.trim() === '') continue;
    yield JSON.parse(line) as unknown;
  }
}

/** Waits `ms`, or rejects with an AbortError when the signal fires. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Rough token estimate for display until the tokenizer arrives in P5 (~4 characters a token). */
export function approxTokens(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.round(text.length / 4));
}
