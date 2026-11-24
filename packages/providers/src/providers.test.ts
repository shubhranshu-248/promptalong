import {
  ByokProvider,
  CATALOG,
  DEFAULT_MODEL,
  ENDPOINTS,
  MockProvider,
  OllamaProvider,
  ProviderError,
  WebLlmProvider,
  mockChunks,
  modelLabel,
  ndjson,
  readModelChoice,
  scrubSecrets,
  sseData,
  type RoomModelChoice,
  type StreamChunk,
  type WebLlmLoader,
} from './index';

const CANARY = 'sk-test-PA-canary-123';
const enc = new TextEncoder();

/** A body stream that delivers the given text split into the given pieces (byte-level). */
function streamOf(text: string, pieceBytes = 7): ReadableStream<Uint8Array> {
  const bytes = enc.encode(text);
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i >= bytes.length) {
        ctrl.close();
        return;
      }
      ctrl.enqueue(bytes.slice(i, i + pieceBytes));
      i += pieceBytes;
    },
  });
}

async function collect(it: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

const text = (chunks: StreamChunk[]) => chunks.map((c) => c.text).join('');
const req = (prompt: string) => ({
  model: 'm',
  messages: [{ role: 'user' as const, content: prompt }],
});

describe('catalog and room choice', () => {
  it('the default model is a free mock model that exists in the catalog', () => {
    const model = CATALOG[DEFAULT_MODEL.kind].find((m) => m.id === DEFAULT_MODEL.model);
    expect(model?.free).toBe(true);
  });

  it('a room model choice has no field that could hold a key', () => {
    const choice: RoomModelChoice = { ...DEFAULT_MODEL };
    expect(Object.keys(choice).sort()).toEqual(['kind', 'model']);
    const parsed = readModelChoice({
      kind: 'byok',
      model: 'x',
      endpoint: 'groq',
      setBy: 'p1',
      key: CANARY,
      apiKey: CANARY,
    });
    expect(JSON.stringify(parsed)).not.toContain(CANARY);
    expect(Object.keys(parsed).sort()).toEqual(['endpoint', 'kind', 'model', 'setBy']);
  });

  it('rejects unknown kinds and endpoints from the network', () => {
    expect(readModelChoice({ kind: 'paid', model: 'x' })).toEqual(DEFAULT_MODEL);
    expect(readModelChoice({ kind: 'byok', model: 'x', endpoint: 'evil.example' })).toEqual(
      DEFAULT_MODEL,
    );
    expect(readModelChoice(null)).toEqual(DEFAULT_MODEL);
  });

  it('every hosted endpoint is https and names its host', () => {
    for (const e of ENDPOINTS) {
      expect(new URL(e.baseUrl).protocol).toBe('https:');
      expect(new URL(e.baseUrl).host).toBe(e.host);
    }
  });

  it('labels', () => {
    expect(modelLabel(DEFAULT_MODEL)).toBe('Demo model');
    expect(
      modelLabel({ kind: 'byok', endpoint: 'groq', model: 'llama-3.1-8b-instant' }, true),
    ).toBe('Groq');
  });
});

describe('scrubSecrets', () => {
  it.each([
    `invalid key ${CANARY}`,
    'Authorization: Bearer gsk_abcdefghijklmnop',
    'bad api key AIzaSyA-1234567890abcdef',
    '{"headers":{"authorization":"Bearer abcdefghijkl"}}',
    'https://x.test/v1?key=abcdefghijkl',
  ])('%s', (input) => {
    const out = scrubSecrets(input);
    expect(out).toContain('[hidden]');
    expect(out).not.toMatch(/canary|gsk_abc|AIzaSy|abcdefghijkl/u);
  });

  it('also hides an exact secret given by the caller', () => {
    expect(scrubSecrets('echo plainsecretvalue', ['plainsecretvalue'])).toBe('echo [hidden]');
  });

  it('ProviderError messages are scrubbed', () => {
    expect(new ProviderError('auth', `bad ${CANARY}`).message).not.toContain(CANARY);
  });
});

describe('stream readers', () => {
  it('SSE: events split across chunks, CRLF, comments, multi-line data', async () => {
    const raw =
      ': keep-alive\r\n\r\ndata: {"a":1}\r\n\r\nevent: x\ndata: line1\ndata: line2\n\ndata: [DONE]\n\n';
    const out: string[] = [];
    for await (const d of sseData(streamOf(raw, 3), new AbortController().signal)) out.push(d);
    expect(out).toEqual(['{"a":1}', 'line1\nline2', '[DONE]']);
  });

  it('NDJSON: UTF-8 characters split across chunks', async () => {
    const raw = '{"t":"héllo ✓"}\n\n{"t":"नमस्ते"}';
    const out: unknown[] = [];
    for await (const v of ndjson(streamOf(raw, 2), new AbortController().signal)) out.push(v);
    expect(out).toEqual([{ t: 'héllo ✓' }, { t: 'नमस्ते' }]);
  });
});

describe('mock provider', () => {
  const mock = new MockProvider({ chunkMs: 0 });

  it('the same request gives exactly the same chunks every time', async () => {
    const body = mock.buildRequestBody(req('Make it 2 minutes and end with one ask'));
    const a = await collect(mock.stream(body, new AbortController().signal));
    const b = await collect(mock.stream(body, new AbortController().signal));
    expect(a).toEqual(b);
    expect(text(a).length).toBeGreaterThan(100);
    expect(a.at(-1)).toMatchObject({ done: true });
    expect(a.at(-1)?.usage?.output).toBeGreaterThan(10);
  });

  it('chunks join back to the full answer', () => {
    const s = 'One two  three\nfour five six seven.';
    expect(mockChunks(s).join('')).toBe(s);
    expect(mockChunks(s).length).toBeGreaterThan(1);
  });

  it('/slow streams the same answer five times slower', async () => {
    const timed = new MockProvider({ chunkMs: 4 });
    const t0 = Date.now();
    const chunks = await collect(
      timed.stream(timed.buildRequestBody(req('/slow hi')), new AbortController().signal),
    );
    expect(Date.now() - t0).toBeGreaterThanOrEqual((chunks.length - 1) * 4 * 5 - 5);
  });

  it('/fail answers with a rate-limit error', async () => {
    const body = mock.buildRequestBody(req('/fail please'));
    await expect(collect(mock.stream(body, new AbortController().signal))).rejects.toMatchObject({
      code: 'rate-limit',
      status: 429,
    });
  });

  it('stops when aborted', async () => {
    const slow = new MockProvider({ chunkMs: 5 });
    const ctrl = new AbortController();
    const got: string[] = [];
    await expect(
      (async () => {
        for await (const c of slow.stream(slow.buildRequestBody(req('hello')), ctrl.signal)) {
          got.push(c.text);
          if (got.length === 3) ctrl.abort();
        }
      })(),
    ).rejects.toThrow(/abort/iu);
    expect(got.length).toBe(3);
  });
});

describe('byok provider', () => {
  function fakeFetch(response: Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fn = (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: input instanceof Request ? input.url : input.toString(),
        init: init ?? {},
      });
      return Promise.resolve(response);
    };
    return { fn: fn, calls };
  }

  const sse = (parts: string[]) =>
    new Response(streamOf(parts.map((p) => `data: ${p}\n\n`).join(''), 11), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

  it('sends the key only in the Authorization header to the endpoint host', async () => {
    const { fn, calls } = fakeFetch(
      sse([
        '{"choices":[{"delta":{"content":"Hel"}}]}',
        '{"choices":[{"delta":{"content":"lo"}}]}',
        '{"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
        '[DONE]',
      ]),
    );
    const p = new ByokProvider({
      endpoint: 'openrouter',
      getKey: () => Promise.resolve(CANARY),
      fetch: fn,
    });
    const body = p.buildRequestBody({ ...req('hi'), maxTokens: 50 });
    expect(body).not.toContain(CANARY);
    const chunks = await collect(p.stream(body, new AbortController().signal));
    expect(text(chunks)).toBe('Hello');
    expect(chunks.at(-1)).toEqual({ text: '', done: true, usage: { input: 5, output: 2 } });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(new URL(call?.url ?? '').host).toBe('openrouter.ai');
    expect(call?.init.body).toBe(body); // the exact bytes the panel shows
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${CANARY}`);
    expect(call?.init.credentials).toBe('omit');
    expect(JSON.parse(body)).toMatchObject({ model: 'm', stream: true, max_tokens: 50 });
  });

  it('a rejected key becomes a scrubbed auth error', async () => {
    const { fn } = fakeFetch(
      new Response(JSON.stringify({ error: { message: `invalid key ${CANARY}` } }), {
        status: 401,
      }),
    );
    const p = new ByokProvider({
      endpoint: 'groq',
      getKey: () => Promise.resolve(CANARY),
      fetch: fn,
    });
    const err = await collect(p.stream(p.buildRequestBody(req('x')), new AbortController().signal))
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe('auth');
    expect((err as ProviderError).status).toBe(401);
    expect((err as ProviderError).message).not.toContain(CANARY);
  });

  it('network failure is scrubbed too', async () => {
    const p = new ByokProvider({
      endpoint: 'groq',
      getKey: () => Promise.resolve(CANARY),
      fetch: () => Promise.reject(new TypeError(`failed ${CANARY}`)),
    });
    const err = (await collect(p.stream('{}', new AbortController().signal)).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(err.code).toBe('network');
    expect(err.message).not.toContain(CANARY);
  });

  it('without a key it says so and never calls the network', async () => {
    const { fn, calls } = fakeFetch(new Response(''));
    const p = new ByokProvider({
      endpoint: 'google',
      getKey: () => Promise.resolve(null),
      fetch: fn,
    });
    expect(await p.available()).toMatchObject({ ok: false });
    await expect(collect(p.stream('{}', new AbortController().signal))).rejects.toMatchObject({
      code: 'auth',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('ollama provider', () => {
  it('detects models and streams NDJSON', async () => {
    const calls: string[] = [];
    const fn = ((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push(url);
      if (url.endsWith('/api/tags')) {
        return Promise.resolve(Response.json({ models: [{ name: 'llama3.2:latest' }] }));
      }
      const lines = [
        { message: { content: 'Hi ' }, done: false },
        { message: { content: 'there' }, done: false },
        { message: { content: '' }, done: true, prompt_eval_count: 9, eval_count: 2 },
      ];
      return Promise.resolve(
        new Response(streamOf(lines.map((l) => JSON.stringify(l)).join('\n'), 5)),
      );
    }) as typeof fetch;
    const p = new OllamaProvider({ fetch: fn });
    expect(await p.available()).toEqual({ ok: true });
    expect((await p.listModels()).map((m) => m.id)).toEqual(['llama3.2:latest']);
    const body = p.buildRequestBody({ ...req('x'), model: 'llama3.2:latest', temperature: 0.2 });
    expect(JSON.parse(body)).toMatchObject({ stream: true, options: { temperature: 0.2 } });
    const chunks = await collect(p.stream(body, new AbortController().signal));
    expect(text(chunks)).toBe('Hi there');
    expect(chunks.at(-1)).toEqual({ text: '', done: true, usage: { input: 9, output: 2 } });
    expect(calls.every((u) => u.startsWith('http://localhost:11434/'))).toBe(true);
  });

  it('not running -> not available', async () => {
    const p = new OllamaProvider({
      fetch: () => Promise.reject(new TypeError('refused')),
    });
    expect(await p.available()).toMatchObject({ ok: false });
    expect(await p.listModels()).toEqual([]);
  });
});

describe('webllm provider (fake engine)', () => {
  function loader(webgpu = true) {
    const loads: string[] = [];
    let interrupted = false;
    const l: WebLlmLoader = {
      hasWebGpu: () => Promise.resolve(webgpu),
      isCached: () => Promise.resolve(false),
      load: (model, onProgress) => {
        loads.push(model);
        onProgress({ progress: 0.5, text: 'half' });
        onProgress({ progress: 1, text: 'ready' });
        return Promise.resolve({
          interruptGenerate: () => {
            interrupted = true;
          },
          chat: {
            completions: {
              create: () =>
                Promise.resolve(
                  (async function* () {
                    await Promise.resolve();
                    yield { choices: [{ delta: { content: 'in ' } }] };
                    yield { choices: [{ delta: { content: 'browser' } }] };
                    yield { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } };
                  })(),
                ),
            },
          },
        });
      },
    };
    return { l, loads, wasInterrupted: () => interrupted };
  }

  it('loads once, reports progress, streams', async () => {
    const { l, loads } = loader();
    const p = new WebLlmProvider(l);
    const progress: number[] = [];
    p.onProgress((x) => progress.push(x.progress));
    const body = p.buildRequestBody({ ...req('x'), model: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC' });
    expect(text(await collect(p.stream(body, new AbortController().signal)))).toBe('in browser');
    await collect(p.stream(body, new AbortController().signal));
    expect(loads).toHaveLength(1);
    expect(progress).toEqual([0.5, 1]);
  });

  it('no WebGPU -> not available with a reason', async () => {
    expect(await new WebLlmProvider(loader(false).l).available()).toMatchObject({ ok: false });
  });
});
