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

  test('Copy puts the exact answer on the clipboard; Retry asks again', async ({
    browser,
    browserName,
  }) => {
    const aarav = await person(browser, 'Aarav');
    // Clipboard permissions can only be granted in Chromium; elsewhere the test reads what the
    // page wrote to the clipboard.
    const realClipboard = browserName === 'chromium';
    try {
      if (realClipboard) {
        await aarav.context.grantPermissions(['clipboard-read', 'clipboard-write']);
      } else {
        await aarav.page.addInitScript(() => {
          const w = window as unknown as { copied?: string };
          navigator.clipboard.writeText = (text: string) => {
            w.copied = text;
            return Promise.resolve();
          };
        });
      }
      await createRoom(aarav);
      await editor(aarav).click();
      await aarav.page.keyboard.type('/short Three slide titles');
      await aarav.page.getByTestId('send-button').click();
      const answer = aarav.page.getByTestId('turn-answer').last();
      await expect(answer).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
      const shown = (await answer.getByTestId('answer-text').innerText()).trim();
      await answer.getByRole('button', { name: 'Copy answer' }).click();
      await expect(answer.getByRole('button', { name: 'Copied' })).toBeVisible();
      const copied = realClipboard
        ? await aarav.page.evaluate(() => navigator.clipboard.readText())
        : await aarav.page.evaluate(() => (window as unknown as { copied?: string }).copied ?? '');
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

  test('Edit puts an old prompt back with its authors; Compare shows two answers side by side', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await editor(aarav).click();
      await aarav.page.keyboard.type('/short Three slide');
      await expect.poll(() => promptText(meera)).toBe('/short Three slide');
      await editor(meera).click();
      await meera.page.keyboard.press('End');
      await meera.page.keyboard.type(' titles');
      await expect.poll(() => promptText(aarav)).toBe('/short Three slide titles');
      await aarav.page.getByTestId('send-button').click();
      await expect(aarav.page.getByTestId('turn-answer')).toHaveCount(1);
      await expect(aarav.page.getByTestId('send-button')).toBeVisible();

      // Edit: the prompt comes back for everyone, each part still marked with who wrote it
      await meera.page.getByTestId('edit-prompt').click();
      for (const p of [aarav, meera]) {
        await expect.poll(() => promptText(p)).toBe('/short Three slide titles');
      }
      await expect(editor(aarav).locator('.pa-author').first()).toBeVisible();
      await editor(meera).click();
      await meera.page.keyboard.press('End');
      await meera.page.keyboard.type(' for judges');
      await meera.page.getByTestId('send-button').click();
      await expect(aarav.page.getByTestId('turn-answer')).toHaveCount(2);

      // Compare: the same prompt to a second model; both answers under one prompt
      await aarav.page.getByTestId('compare-answer').last().click();
      const dialog = aarav.page.getByRole('dialog', { name: 'Compare with another model' });
      await dialog.getByRole('button', { name: 'Send to this model' }).click();
      for (const p of [aarav, meera]) {
        const pair = p.page.getByTestId('compare');
        await expect(pair).toHaveCount(1);
        await expect(pair.getByTestId('turn-answer')).toHaveCount(2);
        await expect(p.page.getByTestId('turn-prompt')).toHaveCount(2); // one prompt per pair
      }
    } finally {
      await closeAll([aarav, meera]);
    }
  });
});
