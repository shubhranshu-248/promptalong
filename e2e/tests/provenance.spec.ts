import { expect, test } from '@playwright/test';
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

/**
 * The participant id from localStorage (the session hook is relay-only): the browser id with the
 * relay, the signed-in user's id with Supabase (kept in the saved sign-in).
 */
async function pidOf(p: Person): Promise<string> {
  const pid = await p.page.evaluate(() => {
    const auth = localStorage.getItem('promptalong:auth');
    if (auth) {
      const id = (JSON.parse(auth) as { user?: { id?: unknown } }).user?.id;
      if (typeof id === 'string') return id;
    }
    return localStorage.getItem('promptalong:pid') ?? '';
  });
  expect(pid).not.toBe('');
  return pid;
}

/** Sends and waits until a NEW answer is done for everyone (not the previous one). */
async function sendAndWait(p: Person, others: Person[] = []): Promise<void> {
  const before = await p.page.getByTestId('turn-answer').count();
  await p.page.getByTestId('send-button').click();
  for (const x of [p, ...others]) {
    await expect(x.page.getByTestId('turn-answer')).toHaveCount(before + 1, { timeout: 15_000 });
    await expect(x.page.getByTestId('turn-answer').last()).toHaveAttribute('data-status', 'done', {
      timeout: 15_000,
    });
  }
}

async function write(p: Person, text: string): Promise<void> {
  await focusEnd(p);
  await p.page.keyboard.type(text);
}

test.describe('provenance', () => {
  test('each person’s text is attributed to them, live and in the sent turn', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      const [a, m] = [await pidOf(aarav), await pidOf(meera)];
      await write(aarav, 'Make it ');
      await expect.poll(() => promptText(meera)).toBe('Make it ');
      await write(meera, '2 minutes');
      await expect.poll(() => promptText(aarav)).toBe('Make it 2 minutes');

      // live: both screens show who wrote which part
      for (const p of [aarav, meera]) {
        await expect(editor(p).locator(`.pa-author[data-author="${a}"]`)).toHaveText('Make it ');
        await expect(editor(p).locator(`.pa-author[data-author="${m}"]`)).toHaveText('2 minutes');
      }
      // hover names the writer
      await editor(aarav).locator(`.pa-author[data-author="${m}"]`).hover();
      await expect(aarav.page.getByRole('tooltip')).toHaveText('Written by Meera');
      // the toggle (room menu) is per viewer
      await aarav.page.getByRole('button', { name: 'Room menu' }).click();
      await aarav.page.getByTestId('show-authors').click();
      await expect(editor(aarav).locator('.pa-show-authors')).toHaveCount(0);
      await expect(aarav.page.locator('.pa-show-authors')).toHaveCount(0);
      await expect(meera.page.locator('.pa-show-authors')).toHaveCount(1);
      await aarav.page.getByRole('button', { name: 'Room menu' }).click();
      await aarav.page.getByTestId('show-authors').click();
      await expect(aarav.page.locator('.pa-show-authors')).toHaveCount(1);

      // Send freezes the authors into the turn
      await sendAndWait(meera, [aarav]);
      const bubble = aarav.page.getByTestId('turn-prompt').last();
      await expect(bubble.locator('[title="Written by you"]')).toHaveText('Make it ');
      await expect(bubble.locator('[title="Written by Meera"]')).toHaveText('2 minutes');
      // renaming relabels every span
      await meera.page.getByRole('button', { name: 'Room menu' }).click();
      await meera.page.getByRole('menuitem', { name: 'Change your name' }).click();
      await meera.page.getByRole('dialog').getByRole('textbox').fill('Meera K');
      await meera.page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
      await expect(bubble.locator('[title="Written by Meera K"]')).toHaveText('2 minutes');
    } finally {
      await closeAll([aarav, meera]);
    }
  });
});
