import { expect, test } from '@playwright/test';
import { closeAll, createRoom, editor, joinRoom, person, promptText } from './helpers';

test.describe('room interface', () => {
  test('a prompt idea fills the shared prompt for everyone, written by whoever chose it', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await expect(aarav.page.getByTestId('send-button')).toBeDisabled(); // nothing written yet
      const idea = meera.page.getByTestId('starter').first();
      const text = (await idea.textContent()) ?? '';
      await idea.click();
      await expect(editor(meera)).toBeFocused();
      for (const p of [aarav, meera]) await expect.poll(() => promptText(p)).toBe(text);
      // Aarav sees it marked as Meera's text; Meera's own text stays plain on her screen
      const underline = (el: Element) => getComputedStyle(el).textDecorationLine;
      await expect(editor(aarav).locator('.pa-author').first()).toBeVisible();
      expect(await editor(aarav).locator('.pa-author').first().evaluate(underline)).toBe(
        'underline',
      );
      expect(await editor(meera).locator('.pa-author').first().evaluate(underline)).toBe('none');
      await expect(aarav.page.getByTestId('send-button')).toBeEnabled();
    } finally {
      await closeAll([aarav, meera]);
    }
  });

  test('Copy puts the exact answer on the clipboard; Retry asks again', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    try {
      await aarav.context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await createRoom(aarav);
      await editor(aarav).click();
      await aarav.page.keyboard.type('/short Three slide titles');
      await aarav.page.getByTestId('send-button').click();
      const answer = aarav.page.getByTestId('turn-answer').last();
      await expect(answer).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
      const shown = (await answer.getByTestId('answer-text').innerText()).trim();
      await answer.getByRole('button', { name: 'Copy answer' }).click();
      await expect(answer.getByRole('button', { name: 'Copied' })).toBeVisible();
      const copied = await aarav.page.evaluate(() => navigator.clipboard.readText());
      expect(copied.length).toBeGreaterThan(0);
      expect(shown.replace(/\s+/gu, ' ')).toContain(
        copied.split('\n')[0]?.replace(/[*#`]/gu, '').trim() ?? '',
      );

      await answer.getByRole('button', { name: 'Retry' }).click();
      await expect(aarav.page.getByTestId('turn-answer')).toHaveCount(2);
      await expect(aarav.page.getByTestId('turn-prompt').last()).toHaveText(
        '/short Three slide titles',
      );
    } finally {
      await closeAll([aarav]);
    }
  });

  test('on a phone the sidebar is a drawer: people and the invite live there', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    try {
      await aarav.page.setViewportSize({ width: 390, height: 844 });
      const code = await createRoom(aarav);
      const sidebar = aarav.page.getByTestId('sidebar');
      await expect(sidebar).toBeHidden();
      await aarav.page.getByTestId('open-sidebar').click();
      await expect(sidebar).toBeVisible();
      await expect(sidebar).toContainText(`${code.slice(0, 3)}-${code.slice(3)}`);
      await expect(sidebar.getByTestId('people-list')).toContainText('Aarav');
      await aarav.page.keyboard.press('Escape');
      await expect(sidebar).toBeHidden();
      const overflow = await aarav.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await closeAll([aarav]);
    }
  });
});
