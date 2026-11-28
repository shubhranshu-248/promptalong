import { expect, test, type Page } from '@playwright/test';
import {
  closeAll,
  createRoom,
  editor,
  focusEnd,
  joinRoom,
  person,
  promptText,
  type Person,
} from './helpers';

/** The answer text of the last turn, as this person sees it. */
async function lastAnswer(p: Person): Promise<string> {
  const answers = p.page.getByTestId('answer-text');
  if ((await answers.count()) === 0) return '';
  return (await answers.last().innerText()).replace(/\s*stopped$/u, '');
}

function lastTurn(p: Person) {
  return p.page.getByTestId('turn-answer').last();
}

async function writePrompt(p: Person, text: string): Promise<void> {
  await focusEnd(p);
  await p.page.keyboard.type(text);
}

/** Watches one person's view of the last answer and checks it only ever grows (no reorder). */
function recordGrowth(p: Person) {
  const seen: string[] = [];
  const state = { stopped: false };
  const loop = (async () => {
    while (!state.stopped) {
      const text = await lastAnswer(p).catch(() => '');
      if (text && text !== seen.at(-1)) seen.push(text);
      await p.page.waitForTimeout(25);
    }
  })();
  return {
    seen,
    async stop() {
      state.stopped = true;
      await loop;
    },
  };
}

test.describe('send and shared stream', () => {
  test('one Send: three people watch the same answer stream in, token by token', async ({
    browser,
  }) => {
    const people = await Promise.all(['Aarav', 'Meera', 'Kabir'].map((n) => person(browser, n)));
    const [aarav, meera, kabir] = people as [Person, Person, Person];
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await joinRoom(kabir, code);
      // (a prompt whose demo answer is plain prose: answers render as Markdown, and a table or a
      // list reads differently once formatted, which this growth check would mistake for a reorder)
      await writePrompt(meera, 'Make it 2 minutes and end with one clear ask for the judges');
      await expect
        .poll(() => promptText(aarav))
        .toBe('Make it 2 minutes and end with one clear ask for the judges');

      const watchers = [meera, kabir].map(recordGrowth);
      await aarav.page.getByTestId('send-button').click();

      // everyone sees it streaming and who is sending; anyone may stop it
      for (const p of people) await expect(lastTurn(p)).toHaveAttribute('data-status', 'streaming');
      await expect(lastTurn(meera).getByTestId('turn-meta')).toContainText('Answering Aarav');
      await expect(meera.page.getByTestId('send-hint')).toContainText(
        "Send is free again when Aarav's answer ends.",
      );
      await expect(meera.page.getByTestId('stop-button')).toBeVisible();
      for (const p of people)
        await expect(lastTurn(p)).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
      await Promise.all(watchers.map((w) => w.stop()));

      const finals = await Promise.all(people.map(lastAnswer));
      expect(new Set(finals).size).toBe(1);
      expect(finals[0]?.length).toBeGreaterThan(100);
      for (const w of watchers) {
        expect(w.seen.length).toBeGreaterThan(2); // it streamed, it did not arrive in one piece
        for (const partial of w.seen) expect(finals[0]?.startsWith(partial)).toBe(true);
      }
      // the prompt is frozen into the turn and cleared for everyone
      await expect(meera.page.getByTestId('turn-prompt')).toHaveText(
        'Make it 2 minutes and end with one clear ask for the judges',
      );
      for (const p of people) await expect.poll(() => promptText(p)).toBe('');
      for (const p of people) {
        await expect(p.page.getByTestId('send-button')).toHaveAccessibleName('Send');
        // the prompt is empty again: nothing to send until someone writes
        await expect(p.page.getByTestId('send-button')).toBeDisabled();
      }
    } finally {
      await closeAll(people);
    }
  });

  test('anyone can Stop; the answer so far is kept for everyone', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    const kabir = await person(browser, 'Kabir');
    try {
      const code = await createRoom(aarav);
      await joinRoom(kabir, code);
      // '/slow' keeps the answer streaming long enough for the Stop click on every browser
      await writePrompt(aarav, '/slow Three slide titles and speaker notes');
      await aarav.page.keyboard.press('Control+Enter'); // keyboard Send
      await expect(lastTurn(kabir)).toHaveAttribute('data-status', 'streaming');
      await expect.poll(() => lastAnswer(kabir)).not.toBe('');
      await kabir.page.getByRole('button', { name: 'Stop' }).click();
      for (const p of [aarav, kabir]) {
        await expect(lastTurn(p)).toHaveAttribute('data-status', 'stopped');
      }
      await expect(lastTurn(aarav).getByTestId('turn-meta')).toContainText('Stopped by Kabir');
      await expect(lastTurn(kabir).getByTestId('turn-meta')).toContainText('Stopped by you');
      expect(await lastAnswer(aarav)).toBe(await lastAnswer(kabir));
      await writePrompt(kabir, 'Shorter');
      await expect(kabir.page.getByTestId('send-button')).toBeEnabled();
    } finally {
      await closeAll([aarav, kabir]);
    }
  });

  test('host-only rooms: guests co-write but cannot Send', async ({ browser }) => {
    const meera = await person(browser, 'Meera');
    const ishita = await person(browser, 'Ishita');
    try {
      await meera.page.goto('/new');
      await meera.page.getByLabel('Room name').fill('Host only room');
      await meera.page.getByTestId('host-only').check();
      await meera.page.getByRole('button', { name: 'Create room' }).click();
      await meera.page.waitForURL(/\/r\/[1-9A-Z]{6}$/u);
      await meera.page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
      const code = meera.page.url().split('/r/')[1] ?? '';
      await joinRoom(ishita, code);
      await writePrompt(ishita, '/short guest wrote this');
      await expect(ishita.page.getByTestId('send-button')).toBeDisabled();
      await expect(ishita.page.getByTestId('send-hint')).toContainText(
        'Only Meera (host) can press Send',
      );
      await expect.poll(() => promptText(meera)).toBe('/short guest wrote this');
      await meera.page.getByTestId('send-button').click();
      await expect(lastTurn(ishita)).toHaveAttribute('data-status', 'done');
    } finally {
      await closeAll([meera, ishita]);
    }
  });

  test('a model error is shown to everyone with Retry', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await writePrompt(aarav, '/fail summarise the survey');
      await aarav.page.getByTestId('send-button').click();
      await expect(lastTurn(meera)).toHaveAttribute('data-status', 'failed');
      await expect(meera.page.getByTestId('turn-error')).toContainText('rate limit reached');
      await expect(lastTurn(meera).getByRole('button', { name: 'Retry' })).toBeVisible();
      await writePrompt(meera, 'Try once more');
      await expect(meera.page.getByTestId('send-button')).toBeEnabled();
    } finally {
      await closeAll([aarav, meera]);
    }
  });

  test('the sender leaves mid-stream: the answer so far is kept as interrupted', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await writePrompt(aarav, '/slow A sharper version of the closing line');
      await aarav.page.getByTestId('send-button').click();
      await expect.poll(() => lastAnswer(meera)).not.toBe('');
      await aarav.page.close();
      await expect(lastTurn(meera)).toHaveAttribute('data-status', 'interrupted', {
        timeout: 15_000,
      });
      await expect(lastTurn(meera).getByTestId('turn-meta')).toContainText('Interrupted');
      expect((await lastAnswer(meera)).length).toBeGreaterThan(0);
      await expect(meera.page.getByTestId('send-button')).toHaveAccessibleName('Send');
      await writePrompt(meera, 'Again please');
      await expect(meera.page.getByTestId('send-button')).toBeEnabled();
    } finally {
      await closeAll([aarav, meera]);
    }
  });

  test('the demo model works with every model host blocked', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    const outside: string[] = [];
    try {
      await aarav.context.route(
        (url) => !['localhost', '127.0.0.1'].includes(url.hostname),
        async (route) => {
          outside.push(route.request().url());
          await route.abort();
        },
      );
      await createRoom(aarav);
      await writePrompt(aarav, '/short offline demo');
      await aarav.page.getByTestId('send-button').click();
      await expect(lastTurn(aarav)).toHaveAttribute('data-status', 'done');
      expect(outside).toEqual([]);
    } finally {
      await closeAll([aarav]);
    }
  });
});

const CANARY = 'sk-test-PA-canary-123';

/** The relay build exposes the open room for tests (see useRoomSession). */
interface TestWindow {
  __promptalong?: { session: { doc: { toJSON(): unknown } } };
}

/** Everything a page could leak a key into, as one string. */
async function pageStorage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const dump = (s: Storage) =>
      Array.from(
        { length: s.length },
        (_, i) => `${s.key(i) ?? ''}=${s.getItem(s.key(i) ?? '') ?? ''}`,
      ).join('\n');
    const doc = (window as unknown as TestWindow).__promptalong?.session.doc.toJSON() ?? {};
    return [dump(localStorage), dump(sessionStorage), JSON.stringify(doc), document.cookie].join(
      '\n',
    );
  });
}

test.describe('your own key', () => {
  test('the key goes only to the chosen provider, from the sender’s browser', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    const people = [aarav, meera];
    const leaks: string[] = [];
    const providerCalls: { auth: string | null; body: string | null }[] = [];
    try {
      for (const p of people) {
        // the provider answers with a tiny SSE stream (no real network)
        await p.context.route('https://openrouter.ai/**', async (route) => {
          const req = route.request();
          providerCalls.push({
            auth: await req.headerValue('authorization'),
            body: req.postData(),
          });
          await route.fulfill({
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'Access-Control-Allow-Origin': '*',
            },
            body: [
              'data: {"choices":[{"delta":{"content":"Key "}}]}',
              'data: {"choices":[{"delta":{"content":"stayed home."}}]}',
              'data: [DONE]',
              '',
            ].join('\n\n'),
          });
        });
        p.page.on('request', (req) => {
          const host = new URL(req.url()).hostname;
          const blob = `${req.url()} ${JSON.stringify(req.headers())} ${req.postData() ?? ''}`;
          if (host !== 'openrouter.ai' && blob.includes(CANARY)) leaks.push(`request ${req.url()}`);
          if (
            host === 'openrouter.ai' &&
            (req.url().includes(CANARY) || (req.postData() ?? '').includes(CANARY))
          ) {
            leaks.push('provider URL or body');
          }
        });
        p.page.on('websocket', (ws) => {
          ws.on('framesent', (f) => {
            if (String(f.payload).includes(CANARY)) leaks.push(`ws sent by ${p.name}`);
          });
          ws.on('framereceived', (f) => {
            if (String(f.payload).includes(CANARY)) leaks.push(`ws received by ${p.name}`);
          });
        });
        p.page.on('console', (m) => {
          if (m.text().includes(CANARY)) leaks.push(`console of ${p.name}`);
        });
      }

      const code = await createRoom(aarav);
      await joinRoom(meera, code);

      await aarav.page.getByTestId('model-button').click();
      const dialog = aarav.page.getByRole('dialog', { name: 'Model for this session' });
      await dialog.getByText('Your own key', { exact: true }).click();
      await dialog.getByTestId('key-input').fill(CANARY);
      await dialog.getByRole('button', { name: 'Use for this session' }).click();
      await expect(dialog).toBeHidden();

      // Meera sees whose key it is, never the key
      await expect(meera.page.getByTestId('model-notice')).toContainText("uses Aarav's key");
      await expect(meera.page.getByTestId('model-button')).toContainText('OpenRouter');

      await writePrompt(meera, 'Summarise the three survey answers in one table.');
      await expect.poll(() => promptText(aarav)).not.toBe('');
      await aarav.page.getByTestId('send-button').click();
      for (const p of people) await expect(lastTurn(p)).toHaveAttribute('data-status', 'done');
      expect(await lastAnswer(meera)).toBe('Key stayed home.');

      expect(providerCalls).toHaveLength(1);
      expect(providerCalls[0]?.auth).toBe(`Bearer ${CANARY}`);
      expect(providerCalls[0]?.body ?? '').not.toContain(CANARY);

      // Meera has no key: Send asks for her own key instead of using Aarav's
      await writePrompt(meera, 'again');
      await meera.page.getByTestId('send-button').click();
      await expect(meera.page.getByRole('dialog', { name: 'Add your key to send' })).toBeVisible();
      await meera.page.getByRole('button', { name: 'Close' }).click();

      for (const p of people) expect(await pageStorage(p.page)).not.toContain(CANARY);
      expect(await meera.page.content()).not.toContain(CANARY);
      expect(await aarav.page.content()).not.toContain(CANARY);
      expect(leaks).toEqual([]);
    } finally {
      await closeAll(people);
    }
  });
});

test('the people list shows who is sending', async ({ browser }) => {
  const aarav = await person(browser, 'Aarav');
  const meera = await person(browser, 'Meera');
  try {
    const code = await createRoom(aarav);
    await joinRoom(meera, code);
    await writePrompt(aarav, 'Three slide titles');
    await aarav.page.getByTestId('send-button').click();
    await expect(
      meera.page.getByTestId('people-list').locator('li', { hasText: 'Aarav' }),
    ).toContainText('sending…');
    await expect(lastTurn(meera)).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
    await expect(editor(meera)).toBeVisible();
  } finally {
    await closeAll([aarav, meera]);
  }
});
