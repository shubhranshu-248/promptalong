import { expect, test } from '@playwright/test';
import {
  closeAll,
  createRoom,
  editor,
  expectSameText,
  focusEnd,
  joinRoom,
  person,
  promptText,
  type Person,
} from './helpers';

// Each person types only from their own letters, so the final text proves that no character was
// lost or duplicated and that everyone's own order survived the merge.
const ALPHABETS = ['abcdef', 'ghijkm', 'nopqrs', 'tuvwxy'];

function typedBy(index: number, length: number): string {
  const letters = ALPHABETS[index] ?? '';
  return Array.from({ length }, (_, i) => letters[i % letters.length]).join('');
}

function onlyLetters(text: string, letters: string): string {
  return Array.from(text)
    .filter((ch) => letters.includes(ch))
    .join('');
}

test.describe('shared prompt', () => {
  test('two people see each other and each other’s named cursor', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await expect(aarav.page.getByTestId('people-list').getByText('Meera')).toBeVisible();
      await expect(meera.page.getByTestId('people-list').getByText('Aarav')).toBeVisible();
      await expect(meera.page.getByTestId('room-title')).toHaveText('Hackathon pitch');

      await focusEnd(meera);
      await meera.page.keyboard.type('Judges care about real users');
      await expect(aarav.page.locator('.pa-caret[data-name="Meera"]')).toBeVisible();
      await expect(aarav.page.locator('.pa-caret__label[data-name="Meera"]')).toBeVisible();
      await expectSameText([aarav, meera]);
    } finally {
      await closeAll([aarav, meera]);
    }
  });

  for (const count of [2, 3, 4]) {
    test(`${count} people typing at once: no lost or duplicated characters`, async ({
      browser,
    }) => {
      const people: Person[] = [];
      try {
        for (let i = 0; i < count; i++) people.push(await person(browser, `Person ${i + 1}`));
        const [host, ...rest] = people;
        if (!host) throw new Error('no host');
        const code = await createRoom(host);
        for (const p of rest) await joinRoom(p, code);
        await expect(host.page.getByTestId('people-list').locator('li')).toHaveCount(count);

        for (const p of people) await focusEnd(p);
        const length = 60;
        await Promise.all(
          people.map((p, i) => p.page.keyboard.type(typedBy(i, length), { delay: 12 })),
        );

        const final = await expectSameText(people);
        expect(final.length).toBe(length * count);
        people.forEach((_, i) => {
          expect(onlyLetters(final, ALPHABETS[i] ?? '')).toBe(typedBy(i, length));
        });
      } finally {
        await closeAll(people);
      }
    });
  }

  test('network cut mid-typing, then reconnect: nothing is lost', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    // Meera types capitals and Aarav lower case, so each person's letters can be checked on their own.
    const meeraBefore = 'BEFORE CUT ';
    const meeraOffline = 'TYPED WHILE OFFLINE';
    const aaravOnline = 'typed by the online person ';
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await focusEnd(meera);
      await meera.page.keyboard.type(meeraBefore, { delay: 10 });
      await meera.context.setOffline(true);
      await meera.page.keyboard.type(meeraOffline, { delay: 10 });
      await expect(meera.page.getByTestId('offline-banner')).toBeVisible();
      await focusEnd(aarav);
      await aarav.page.keyboard.type(aaravOnline, { delay: 10 });
      await meera.page.waitForTimeout(300);
      expect(await promptText(aarav)).not.toContain('OFFLINE');

      await meera.context.setOffline(false);
      await expect(meera.page.getByTestId('offline-banner')).toBeHidden();
      const final = await expectSameText([aarav, meera]);
      expect(final.length).toBe(meeraBefore.length + meeraOffline.length + aaravOnline.length);
      expect(
        Array.from(final)
          .filter((c) => /[A-Z]/u.test(c))
          .join(''),
      ).toBe((meeraBefore + meeraOffline).replace(/ /gu, ''));
      expect(
        Array.from(final)
          .filter((c) => /[a-z]/u.test(c))
          .join(''),
      ).toBe(aaravOnline.replace(/ /gu, ''));
    } finally {
      await closeAll([aarav, meera]);
    }
  });

  test('a reload keeps the prompt and a late joiner receives it', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    const kabir = await person(browser, 'Kabir');
    try {
      const code = await createRoom(aarav);
      await focusEnd(aarav);
      await aarav.page.keyboard.type('Written before anyone joined.');
      await aarav.page.waitForTimeout(200);
      await aarav.page.reload();
      await expect(editor(aarav)).toContainText('Written before anyone joined.');
      await joinRoom(kabir, code);
      await expect(editor(kabir)).toContainText('Written before anyone joined.');
      await expect(kabir.page.getByTestId('room-title')).toHaveText('Hackathon pitch');
    } finally {
      await closeAll([aarav, kabir]);
    }
  });

  test('undo is per person', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await focusEnd(aarav);
      await aarav.page.keyboard.type('From Aarav. ');
      await expectSameText([aarav, meera]);
      await focusEnd(meera);
      await meera.page.keyboard.type('From Meera.');
      await expectSameText([aarav, meera]);
      await editor(aarav).focus();
      await aarav.page.keyboard.press('Control+z');
      const final = await expectSameText([aarav, meera]);
      expect(final).not.toContain('From Aarav.');
      expect(final).toContain('From Meera.');
    } finally {
      await closeAll([aarav, meera]);
    }
  });

  test('keystroke to the other screen: p95 under 300 ms', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await focusEnd(aarav);
      const samples: number[] = [];
      for (let i = 0; i < 20; i++) {
        const marker = `m${i}z`;
        const seen = meera.page.evaluate(
          (m) =>
            new Promise<number>((resolve) => {
              const el = document.querySelector('[data-testid="prompt-editor"]');
              const check = () => {
                if (el?.textContent.includes(m)) {
                  resolve(Date.now());
                  return true;
                }
                return false;
              };
              if (check()) return;
              const obs = new MutationObserver(() => {
                if (check()) obs.disconnect();
              });
              if (el) obs.observe(el, { childList: true, subtree: true, characterData: true });
            }),
          marker,
        );
        const start = Date.now();
        await aarav.page.keyboard.type(marker);
        samples.push((await seen) - start);
      }
      samples.sort((a, b) => a - b);
      const p95 = samples[Math.ceil(samples.length * 0.95) - 1] ?? Infinity;
      test.info().annotations.push({ type: 'p95 ms', description: String(p95) });
      expect(p95).toBeLessThan(300);
    } finally {
      await closeAll([aarav, meera]);
    }
  });

  test('the ninth person sees “room full”', async ({ browser }) => {
    test.setTimeout(90_000);
    const people: Person[] = [];
    try {
      for (let i = 0; i < 9; i++) people.push(await person(browser, `P${i + 1}`));
      const [host, ...rest] = people;
      const ninth = rest.pop();
      if (!host || !ninth) throw new Error('missing people');
      const code = await createRoom(host);
      for (const p of rest) await joinRoom(p, code);
      await expect(host.page.getByTestId('people-list').locator('li')).toHaveCount(8);
      await ninth.page.goto(`/r/${code}`);
      await expect(ninth.page.getByTestId('room-full')).toBeVisible();
      await host.page.waitForTimeout(500);
      await expect(host.page.getByTestId('people-list').locator('li')).toHaveCount(8);
    } finally {
      await closeAll(people);
    }
  });
});
