import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { editor, focusEnd, promptText, type Person } from './helpers';

const T3 =
  'Now turn this into three slide titles with speaker notes. Keep the notes under 40 words each, and make the ask from the closing line the last slide.';

const asPerson = (page: Page): Person => ({ page, context: page.context(), name: 'You' });

async function untilYourTurn(page: Page): Promise<void> {
  await expect(page.getByTestId('demo-phase')).toContainText('Your turn', { timeout: 90_000 });
}

test.describe('live demo', () => {
  // The story runs in real time (about half a minute).
  test.describe.configure({ timeout: 150_000 });

  test('plays the whole story in the browser, with no server and no model account', async ({
    page,
  }) => {
    const remote: string[] = [];
    const sockets: string[] = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      // only this site's own files; the demo never calls an API
      if (url.port !== '4173' || url.pathname.startsWith('/api/')) remote.push(r.url());
    });
    page.on('websocket', (ws) => sockets.push(ws.url()));
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/demo');
    await expect(page.getByTestId('room-title')).toHaveText('Demo: Hackathon pitch');
    await expect(page.getByTestId('demo-banner')).toContainText(
      'Aarav, Meera and Kabir are scripted',
    );
    // four people, the scripted teammates first
    await expect(page.getByRole('img', { name: '4 people in the room' })).toBeVisible();
    // someone else's caret moves in the shared prompt
    await expect(page.locator('.pa-caret').first()).toBeVisible({ timeout: 15_000 });

    await untilYourTurn(page);
    const answers = page.getByTestId('turn-answer');
    await expect(answers).toHaveCount(2);
    for (const a of await answers.all()) await expect(a).toHaveAttribute('data-status', 'done');
    await expect(page.getByTestId('turn-prompt').first()).toContainText(
      '90-second hackathon pitch',
    );
    await expect.poll(() => promptText(asPerson(page))).toBe(T3);
    // three authors' marks in the prompt the visitor gets
    expect(await editor(asPerson(page)).locator('[data-author]').count()).toBeGreaterThanOrEqual(3);

    // the visitor sends turn 3: the answer is formatted (a numbered list)
    await page.getByTestId('send-button').click();
    const third = answers.nth(2);
    await expect(third).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
    await expect(third.getByRole('list')).toBeVisible();
    await expect(third.getByRole('listitem')).toHaveCount(3);

    expect(sockets).toEqual([]);
    expect(remote).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the visitor can type along; Replay starts an empty room', async ({ page }) => {
    await page.goto('/demo');
    await expect(page.locator('.pa-caret').first()).toBeVisible({ timeout: 15_000 });
    const you = asPerson(page);
    await focusEnd(you);
    await page.keyboard.type(' (from me)');
    await expect.poll(() => promptText(you)).toContain('(from me)');
    // the visitor's own text carries their author mark
    await expect(editor(you).locator('[data-author^="demo-you-"]').first()).toBeVisible();

    await page.getByTestId('demo-replay').click();
    await expect.poll(() => promptText(you)).not.toContain('(from me)');
    await expect(page.getByTestId('turn-answer')).toHaveCount(0);
    await expect(page.getByTestId('demo-phase')).toContainText('scripted');
  });

  test('the model cannot be changed in the demo, and there is nothing to share', async ({
    page,
  }) => {
    await page.goto('/demo');
    await expect(page.getByTestId('room-title')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share link' })).toHaveCount(0);
    await page.getByTestId('model-button').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('The demo room always uses the demo model.')).toBeVisible();
    await page.getByRole('button', { name: 'Room menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Share link and code' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Start your own room' }).click();
    await expect(page).toHaveURL(/\/new$/u);
  });

  for (const vp of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`axe: the finished demo room (${vp.name})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/demo');
      await untilYourTurn(page);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  }
});
