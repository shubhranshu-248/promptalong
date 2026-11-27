import { createHash } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  closeAll,
  createRoom,
  focusEnd,
  joinRoom,
  person,
  promptText,
  type Person,
} from './helpers';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

async function write(p: Person, text: string): Promise<void> {
  await focusEnd(p);
  await p.page.keyboard.type(text);
}

/** Set inside a page by the "under a second" test. */
interface Watch {
  __seen?: Promise<number>;
}

function panel(p: Person) {
  return p.page.getByTestId('context-panel');
}

/** The context drawer opens from the composer's Context button. */
async function openPanel(p: Person): Promise<void> {
  if (await panel(p).isVisible()) return;
  await p.page.getByTestId('context-button').click();
  await expect(panel(p)).toBeVisible();
}

async function addNote(p: Person, title: string, text: string): Promise<void> {
  await openPanel(p);
  await panel(p).getByRole('button', { name: 'Add note' }).click();
  const dialog = p.page.getByRole('dialog', { name: 'Add a note' });
  await dialog.getByTestId('item-title').fill(title);
  await dialog.getByTestId('item-text').fill(text);
  await dialog.getByTestId('item-save').click();
  await expect(dialog).toBeHidden();
}

async function uploadText(p: Person, name: string, content: string | Buffer): Promise<void> {
  await openPanel(p);
  await panel(p)
    .getByTestId('context-file')
    .setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: typeof content === 'string' ? Buffer.from(content, 'utf8') : content,
    });
}

function item(p: Person, title: string) {
  return panel(p).getByTestId('context-item').filter({ hasText: title });
}

/** Opens Payload > JSON and returns the exact string shown, with its hash. */
async function shownPayload(p: Person): Promise<{ body: string; hash: string }> {
  await openPanel(p);
  await panel(p).getByTestId('ctx-tab-payload').click();
  await panel(p).getByTestId('payload-json-button').click();
  const pre = panel(p).getByTestId('payload-json');
  await expect(pre).toBeVisible();
  let body = '';
  let hash = '';
  // the hash is computed a moment after the text: wait until both describe the same bytes
  await expect
    .poll(async () => {
      body = (await pre.textContent()) ?? '';
      hash = (await panel(p).getByTestId('payload-hash').getAttribute('data-hash')) ?? '';
      return hash === sha256(body);
    })
    .toBe(true);
  return { body, hash };
}

async function lastSentHash(p: Person): Promise<string> {
  return (await panel(p).getByTestId('payload-last').getAttribute('data-hash')) ?? '';
}

async function waitDone(people: Person[], turns: number): Promise<void> {
  for (const p of people) {
    await expect(p.page.getByTestId('turn-answer')).toHaveCount(turns, { timeout: 15_000 });
    await expect(p.page.getByTestId('turn-answer').last()).toHaveAttribute('data-status', 'done', {
      timeout: 15_000,
    });
  }
}

test.describe('context panel', () => {
  test('payload equality: the panel string is the request body, byte for byte', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    const people = [aarav, meera];
    const posted: string[] = [];
    try {
      for (const p of people) {
        // the provider answers with a tiny stream; the request never leaves this machine
        await p.context.route('https://openrouter.ai/**', async (route) => {
          posted.push(route.request().postData() ?? '');
          await route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' },
            body: [
              'data: {"choices":[{"delta":{"content":"Same bytes."}}]}',
              'data: [DONE]',
              '',
            ].join('\n\n'),
          });
        });
      }
      const code = await createRoom(aarav);
      await joinRoom(meera, code);

      // context from two people, one item switched off, and a room line
      await uploadText(
        meera,
        'judging-criteria.txt',
        '1. Real user problem (30%)\r\n2. Working demo (30%)\n',
      );
      await addNote(aarav, 'App features', '- live map of found items\n- "photo + pin" in one tap');
      await addNote(aarav, 'Old pitch draft', 'We help students find things.');
      await expect(panel(meera).getByTestId('context-item')).toHaveCount(3);
      await item(meera, 'Old pitch draft').getByRole('checkbox').uncheck();
      await expect(item(aarav, 'Old pitch draft')).toContainText('excluded by Meera');
      await panel(aarav).getByTestId('ctx-tab-payload').click();
      await panel(aarav).getByRole('button', { name: 'Add room line' }).click();
      await aarav.page
        .getByTestId('room-line-input')
        .fill('You are helping a team prepare a pitch.');
      await aarav.page.getByTestId('room-line-save').click();

      await aarav.page.getByTestId('model-button').click();
      const dialog = aarav.page.getByRole('dialog', { name: 'Model for this room' });
      await dialog.getByText('Your own key', { exact: true }).click();
      await dialog.getByTestId('key-input').fill('sk-test-PA-context-1');
      await dialog.getByRole('button', { name: 'Use for this room' }).click();
      await expect(dialog).toBeHidden();

      await write(meera, 'Turn this into three slide titles — "short" ones.');
      await expect.poll(() => promptText(aarav)).toContain('short');

      const before = await shownPayload(aarav);
      // every browser builds the same bytes from the shared room
      await expect.poll(async () => (await shownPayload(meera)).hash).toBe(before.hash);
      const parsed = JSON.parse(before.body) as { messages: { role: string; content: string }[] };
      expect(parsed.messages.map((m) => m.role)).toEqual(['system', 'user']);
      expect(parsed.messages[0]?.content).toBe(
        'You are helping a team prepare a pitch.\n\n' +
          '[context: judging-criteria.txt · Meera]\n1. Real user problem (30%)\n2. Working demo (30%)\n\n' +
          '[context: App features · Aarav]\n- live map of found items\n- "photo + pin" in one tap',
      );
      expect(before.body).not.toContain('Old pitch draft');
      expect(before.body).not.toContain('sk-test-PA-context-1');

      await aarav.page.getByTestId('send-button').click();
      await waitDone(people, 1);

      expect(posted).toHaveLength(1);
      expect(posted[0]).toBe(before.body); // panel === request body
      expect(sha256(posted[0] ?? '')).toBe(before.hash); // === the hash the panel showed
      for (const p of people) {
        await panel(p).getByTestId('ctx-tab-payload').click();
        await expect.poll(() => lastSentHash(p)).toBe(before.hash); // === the turn's requestHash
        await expect(p.page.getByTestId('turn-context')).toHaveText(', with 2 context items');
      }
    } finally {
      await closeAll(people);
    }
  });

  test('demo model: the hash shown before Send is the hash stored with the turn', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    try {
      // the tokenizer is a big download: a short prompt in an empty room is only estimated
      const tokenizer: string[] = [];
      aarav.context.on('request', (req) => {
        if (req.url().includes('tokenizer.worker')) tokenizer.push(req.url());
      });
      await createRoom(aarav);
      await write(aarav, '/short Make it 2 minutes');
      await expect(aarav.page.getByTestId('composer-tokens')).toHaveText(/^~\d+ \/ 1M$/u);
      expect(tokenizer).toEqual([]);
      await addNote(aarav, 'Survey numbers', '61 of 80 students lost something this sem.');
      await expect.poll(() => tokenizer.length).toBe(1);
      const first = await shownPayload(aarav);
      await aarav.page.getByTestId('send-button').click();
      await waitDone([aarav], 1);
      await expect.poll(() => lastSentHash(aarav)).toBe(first.hash);

      // the second request carries the first turn as history, and the same context
      await write(aarav, '/short Now shorter');
      const second = await shownPayload(aarav);
      const parsed = JSON.parse(second.body) as { messages: { role: string; content: string }[] };
      expect(parsed.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
      expect(parsed.messages[1]?.content).toBe('/short Make it 2 minutes');
      await aarav.page.getByTestId('send-button').click();
      await waitDone([aarav], 2);
      await expect.poll(() => lastSentHash(aarav)).toBe(second.hash);
      // the readable view lists the same sources
      await panel(aarav).getByTestId('payload-text-button').click();
      await expect(panel(aarav).getByTestId('seg-context')).toContainText(
        '[context: Survey numbers · Aarav]',
      );
      await expect(panel(aarav).getByTestId('seg-history')).toContainText(
        'history (T1, T2 + answers)',
      );
    } finally {
      await closeAll([aarav]);
    }
  });

  test('including or excluding an item reaches everyone in under a second', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    const kabir = await person(browser, 'Kabir');
    const people = [aarav, meera, kabir];
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await joinRoom(kabir, code);
      await addNote(aarav, 'App features', 'live map, photo + pin, match alerts '.repeat(20));
      for (const p of people) await openPanel(p);
      for (const p of people) await expect(item(p, 'App features')).toBeVisible();
      const withItem = await panel(kabir).getByTestId('budget-numbers').innerText();

      const times: number[] = [];
      for (const [who, want] of [
        [meera, 'false'],
        [kabir, 'true'],
        [aarav, 'false'],
      ] as const) {
        const others = people.filter((p) => p !== who);
        // each other browser notes the moment its own panel shows the change
        for (const p of others) {
          await item(p, 'App features').evaluate((el, wanted) => {
            (window as unknown as Watch).__seen = new Promise<number>((resolve) => {
              const observer = new MutationObserver(() => {
                if (el.getAttribute('data-included') !== wanted) return;
                observer.disconnect();
                resolve(Date.now());
              });
              observer.observe(el, { attributes: true, attributeFilter: ['data-included'] });
            });
          }, want);
        }
        const clicked = await item(who, 'App features')
          .getByRole('checkbox')
          .evaluate((el: HTMLInputElement) => {
            const at = Date.now();
            el.click();
            return at;
          });
        const seen = await Promise.all(
          others.map((p) => p.page.evaluate(() => (window as unknown as Watch).__seen)),
        );
        times.push(Math.max(...seen.map((at) => (at ?? Infinity) - clicked)));
      }
      test.info().annotations.push({ type: 'toggle ms', description: times.join(', ') });
      expect(Math.max(...times)).toBeLessThan(1000);

      // it says who, and the budget of people who did nothing changed too
      await expect(item(kabir, 'App features')).toContainText('excluded by Aarav');
      await expect(item(aarav, 'App features')).toContainText('excluded by you');
      await expect(panel(kabir).getByTestId('budget-numbers')).not.toHaveText(withItem);
      await expect(panel(kabir).getByTestId('context-count')).toHaveText('0 of 1 included');
    } finally {
      await closeAll(people);
    }
  });

  test('over budget: Send is off for everyone until something is excluded', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    const people = [aarav, meera];
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await write(aarav, '/short Summarise the notes');
      await expect.poll(() => promptText(meera)).toContain('Summarise');
      for (const p of people) await expect(p.page.getByTestId('send-button')).toBeEnabled();

      // five files of ~880 KB, about 1.1 million tokens: more than the demo model's 1,040,384
      // (and far more than one realtime message can carry: each travels in parts)
      for (let n = 1; n <= 5; n++) {
        await uploadText(
          meera,
          n === 5 ? 'all-notes.md' : `notes-${String(n)}.md`,
          `Week ${String(n)}. Lost and found on campus, week by week. `.repeat(18_000),
        );
      }
      for (const p of people) await openPanel(p);
      for (const p of people) await expect(panel(p).getByTestId('context-item')).toHaveCount(5);
      for (const p of people) {
        await expect(panel(p).getByTestId('budget')).toHaveAttribute('data-over', 'true');
        await expect(panel(p).getByTestId('budget')).toContainText(
          'This does not fit. Remove about',
        );
        await expect(p.page.getByTestId('send-button')).toBeDisabled();
        await expect(p.page.getByTestId('send-hint')).toContainText('remove about');
      }
      // Ctrl+Enter does not get around it
      await focusEnd(aarav);
      await aarav.page.keyboard.press('Control+Enter');
      await expect(aarav.page.getByTestId('turn-answer')).toHaveCount(0);

      await item(aarav, 'all-notes.md').getByRole('checkbox').uncheck();
      for (const p of people) {
        await expect(panel(p).getByTestId('budget')).toHaveAttribute('data-over', 'false');
        await expect(p.page.getByTestId('send-button')).toBeEnabled();
      }
      // nothing was dropped: the item is still there, only excluded
      await expect(item(meera, 'all-notes.md')).toContainText('excluded by Aarav');
      await aarav.page.getByTestId('send-button').click();
      await waitDone(people, 1);
      await expect(aarav.page.getByTestId('turn-context')).toHaveText(', with 4 context items');
    } finally {
      await closeAll(people);
    }
  });

  test('a 900 KB file reaches the other person: big changes travel in parts', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await expect(meera.page.getByTestId('people-list').locator('li')).toHaveCount(2);
      const line = 'The judges score problem, solution, demo and pitch. ';
      const text = line.repeat(Math.floor((900 * 1024) / line.length));
      await uploadText(aarav, 'notes.txt', text);
      await expect(item(aarav, 'notes.txt')).toBeVisible();
      await openPanel(meera);
      // one realtime message may be at most 256 KB on the free plan: this one needs several
      await expect(item(meera, 'notes.txt')).toBeVisible({ timeout: 20_000 });
      await expect(item(meera, 'notes.txt')).toContainText('Aarav · file');
    } finally {
      await closeAll([aarav, meera]);
    }
  });

  test('only .txt and .md text up to 1 MB can be added', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    try {
      await createRoom(aarav);
      const problem = panel(aarav).getByTestId('context-problem');
      await uploadText(aarav, 'slides.pdf', '%PDF-1.7');
      await expect(problem).toContainText('"slides.pdf" is not a .txt or .md file');
      await uploadText(aarav, 'huge.txt', 'a'.repeat(1024 * 1024 + 64));
      await expect(problem).toContainText('"huge.txt" is larger than 1 MB');
      await uploadText(aarav, 'photo.txt', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a]));
      await expect(problem).toContainText('"photo.txt" is not UTF-8 text');
      await expect(panel(aarav).getByTestId('context-item')).toHaveCount(0);

      await uploadText(aarav, 'criteria.md', '# Judging\n\n- problem\n- demo');
      await expect(item(aarav, 'criteria.md')).toContainText('You · file · 27 B');
      await expect(problem).toBeHidden();

      // the owner can read and change it; the size limit applies to edits too
      await item(aarav, 'criteria.md')
        .getByRole('button', { name: 'criteria.md', exact: true })
        .click();
      const dialog = aarav.page.getByRole('dialog', { name: 'Edit context' });
      await expect(dialog.getByTestId('item-text')).toHaveValue('# Judging\n\n- problem\n- demo');
      await dialog.getByTestId('item-text').fill('# Judging\n\n- problem\n- demo\n- ask');
      await dialog.getByTestId('item-save').click();
      await expect(item(aarav, 'criteria.md')).toContainText('33 B');

      await item(aarav, 'criteria.md')
        .getByRole('button', { name: 'More for criteria.md' })
        .click();
      await aarav.page.getByRole('menuitem', { name: 'Remove from the room…' }).click();
      await aarav.page.getByTestId('item-remove-confirm').click();
      await expect(panel(aarav).getByTestId('context-item')).toHaveCount(0);
    } finally {
      await closeAll([aarav]);
    }
  });

  test('someone else’s item can be read and switched off, not changed or removed', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    const kabir = await person(browser, 'Kabir');
    const people = [aarav, meera, kabir];
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await joinRoom(kabir, code);
      await addNote(meera, 'Survey numbers', '61 of 80 students');
      await openPanel(kabir);
      await expect(item(kabir, 'Survey numbers')).toContainText('Meera · note');

      await item(kabir, 'Survey numbers')
        .getByRole('button', { name: 'More for Survey numbers' })
        .click();
      await expect(kabir.page.getByRole('menuitem', { name: 'View', exact: true })).toBeVisible();
      await expect(kabir.page.getByRole('menuitem', { name: /Remove/u })).toHaveCount(0);
      await kabir.page.getByRole('menuitem', { name: 'View', exact: true }).click();
      const view = kabir.page.getByRole('dialog', { name: 'Survey numbers' });
      await expect(view.getByTestId('item-text')).toHaveValue('61 of 80 students');
      await expect(view.getByTestId('item-text')).not.toBeEditable();
      await view.getByRole('button', { name: 'Close' }).last().click();

      // the host can remove anyone's item
      await openPanel(aarav);
      await item(aarav, 'Survey numbers')
        .getByRole('button', { name: 'More for Survey numbers' })
        .click();
      await aarav.page.getByRole('menuitem', { name: 'Remove from the room…' }).click();
      await aarav.page.getByTestId('item-remove-confirm').click();
      for (const p of people) await expect(panel(p).getByTestId('context-item')).toHaveCount(0);
    } finally {
      await closeAll(people);
    }
  });

  test('the context drawer opens from the composer, on a laptop and on a phone', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    try {
      await createRoom(aarav);
      await expect(panel(aarav)).toBeHidden();
      await addNote(aarav, 'App features', '- live map');
      await expect(aarav.page.getByTestId('context-button')).toContainText('1');
      await panel(aarav).getByTestId('ctx-tab-payload').click();
      await expect(panel(aarav).getByTestId('payload')).toBeVisible();
      await panel(aarav).getByTestId('ctx-close').click();
      await expect(panel(aarav)).toBeHidden();
      await expect(aarav.page.getByTestId('prompt-editor')).toBeVisible();

      await aarav.page.setViewportSize({ width: 390, height: 844 });
      // the sidebar was open beside the chat; on a phone it is a drawer, closed until asked for
      await expect(aarav.page.getByTestId('sidebar')).toBeHidden();
      await openPanel(aarav);
      await panel(aarav).getByTestId('ctx-tab-context').click();
      await expect(item(aarav, 'App features')).toBeVisible();
      const overflow = await aarav.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await aarav.page.keyboard.press('Escape');
      await expect(panel(aarav)).toBeHidden();
    } finally {
      await closeAll([aarav]);
    }
  });
});

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations.map((v) => `${v.id}: ${v.help}`);
}

for (const scheme of ['light', 'dark'] as const) {
  for (const vp of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`axe: context panel ${vp.name} ${scheme}`, async ({ browser }) => {
      const aarav = await person(browser, 'Aarav');
      try {
        await aarav.page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await createRoom(aarav);
        await addNote(aarav, 'App features', '- live map');
        await addNote(aarav, 'Old pitch draft', 'We help students find things.');
        await item(aarav, 'Old pitch draft').getByRole('checkbox').uncheck();
        await write(aarav, 'Three slide titles');
        await aarav.page.setViewportSize({ width: vp.width, height: vp.height });
        await openPanel(aarav);
        await panel(aarav).getByTestId('ctx-tab-context').click();
        await expect(item(aarav, 'App features')).toBeVisible();
        expect(await axe(aarav.page)).toEqual([]);
        await panel(aarav).getByTestId('ctx-tab-payload').click();
        await expect(panel(aarav).getByTestId('seg-prompt')).toBeVisible();
        expect(await axe(aarav.page)).toEqual([]);
      } finally {
        await closeAll([aarav]);
      }
    });
  }
}
