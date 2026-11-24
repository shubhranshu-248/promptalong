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

/** The participant id lives in localStorage in every realtime mode (the session hook is relay-only). */
async function pidOf(p: Person): Promise<string> {
  const pid = await p.page.evaluate(() => localStorage.getItem('promptalong:pid') ?? '');
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
      // the toggle is per viewer
      await aarav.page.getByTestId('show-authors').click();
      await expect(aarav.page.getByTestId('show-authors')).toHaveAttribute('aria-pressed', 'false');
      await expect(meera.page.getByTestId('show-authors')).toHaveAttribute('aria-pressed', 'true');
      await aarav.page.getByTestId('show-authors').click();

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

test.describe('conversation tree', () => {
  test('branch from a turn, room-wide switch, compare, merge back, nothing lost', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await write(aarav, '/short Pitch outline');
      await sendAndWait(aarav, [meera]);
      await write(aarav, '/short Keep the notes under 40 words each');
      await sendAndWait(aarav, [meera]);

      // Branch from T1: the new draft starts as T2's prompt (edit and retry)
      await meera.page
        .getByTestId('turn-answer')
        .first()
        .getByRole('button', { name: 'Branch from here' })
        .click();
      const dialog = meera.page.getByRole('dialog', { name: 'Branch from turn 1' });
      await dialog.getByTestId('branch-name').fill('Shorter Version');
      await expect(dialog).toContainText('Saved as "shorter-version"');
      await dialog.getByRole('button', { name: 'Create branch' }).click();

      // everyone switches; Aarav is told who switched
      for (const p of [aarav, meera])
        await expect(p.page.getByTestId('branch-chip')).toHaveText('shorter-version');
      await expect(aarav.page.getByTestId('switch-notice')).toContainText(
        'Meera switched the room to shorter-version',
      );
      await expect.poll(() => promptText(aarav)).toBe('/short Keep the notes under 40 words each');
      await expect(aarav.page.getByTestId('turn-prompt')).toHaveCount(1); // T1 only on the branch so far

      // edit the branch prompt and send: T2b
      await editor(meera).click();
      await meera.page.keyboard.press('Control+A');
      await meera.page.keyboard.type('/short Keep the notes to two short lines');
      await sendAndWait(meera, [aarav]);
      await expect(aarav.page.getByTestId('turn-prompt')).toHaveCount(2);
      await expect(aarav.page.getByTestId('turn-prompt').last()).toHaveText(
        '/short Keep the notes to two short lines',
      );

      // the tree shows both branches; main is untouched
      await aarav.page.getByTestId('panel-tree').click();
      await expect(aarav.page.getByTestId('tree-turn')).toHaveCount(3);
      await expect(aarav.page.locator('[data-testid="tree-turn"][data-label="T2b"]')).toBeVisible();

      // compare T2 (main) with T2b (branch)
      await aarav.page.locator('[data-testid="tree-turn"][data-label="T2"]').click();
      await aarav.page.locator('[data-testid="tree-turn"][data-label="T2b"]').click();
      await aarav.page.getByRole('button', { name: /Compare T2 vs T2b/u }).click();
      await expect(
        aarav.page.getByTestId('compare-prompt-a').locator('del').filter({ hasText: 'under' }),
      ).toHaveCount(1);
      await expect(aarav.page.getByTestId('compare-prompt-a')).toContainText('under');
      await expect(
        aarav.page.getByTestId('compare-prompt-b').locator('ins').filter({ hasText: 'two' }),
      ).toHaveCount(1);

      // back on main, merge the branch's prompt into main's (empty) draft
      await aarav.page.getByRole('button', { name: 'Back to the chat' }).click();
      await aarav.page.getByRole('button', { name: 'Switch to main' }).click();
      for (const p of [aarav, meera])
        await expect(p.page.getByTestId('branch-chip')).toHaveCount(0);
      await expect(aarav.page.getByTestId('turn-prompt')).toHaveCount(2);
      await expect(aarav.page.getByTestId('turn-prompt').last()).toHaveText(
        '/short Keep the notes under 40 words each',
      );
      await aarav.page.getByRole('button', { name: 'Merge into main…' }).click();
      const merge = aarav.page.getByRole('dialog', { name: 'Merge "shorter-version" into main' });
      if ((await merge.getByTestId('merge-conflict').count()) > 0) {
        await merge.getByRole('radio', { name: 'Keep theirs' }).click();
      }
      await merge.getByRole('button', { name: 'Merge into main' }).click();
      for (const p of [aarav, meera]) {
        await expect.poll(() => promptText(p)).toBe('/short Keep the notes to two short lines');
      }
      await expect(aarav.page.getByTestId('tree')).toContainText(
        'you merged shorter-version into main',
      );
      await expect(meera.page.getByTestId('panel-tree')).toBeVisible();
      // nothing deleted: three turns, two branches
      await expect(aarav.page.getByTestId('tree-turn')).toHaveCount(3);
      await expect(aarav.page.getByTestId('tree-branch')).toHaveCount(2);
    } finally {
      await closeAll([aarav, meera]);
    }
  });

  test('fork room copies the path with authors marked from the old room', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await write(meera, '/short Written by Meera');
      await sendAndWait(aarav, [meera]);
      await write(aarav, '/short Second turn');
      await sendAndWait(aarav, [meera]);

      await aarav.page.getByTestId('panel-tree').click();
      await aarav.page.getByRole('button', { name: 'Fork room' }).click();
      const dialog = aarav.page.getByRole('dialog', { name: 'Fork this room' });
      await dialog.getByLabel('Copy up to').selectOption({ index: 0 });
      await dialog.getByLabel('New room name').fill('Pitch fork');
      await dialog.getByRole('button', { name: 'Fork room' }).click();

      await aarav.page.waitForURL(
        (u) => /\/r\/[1-9A-Z]{6}$/u.test(u.pathname) && !u.pathname.endsWith(code),
      );
      const share = aarav.page.getByRole('dialog');
      if (await share.isVisible()) await share.getByRole('button', { name: 'Close' }).click();
      await expect(aarav.page.getByTestId('room-title')).toHaveText('Pitch fork');
      await expect(aarav.page.getByTestId('turn-prompt')).toHaveCount(1);
      await expect(
        aarav.page
          .getByTestId('turn-prompt')
          .locator(`[title="Written by Meera (from room ${code})"]`),
      ).toHaveText('/short Written by Meera');
      await expect(aarav.page.getByTestId('turn-answer')).toHaveAttribute('data-status', 'done');
      // the old room is unchanged
      await expect(meera.page.getByTestId('turn-prompt')).toHaveCount(2);
    } finally {
      await closeAll([aarav, meera]);
    }
  });
});
