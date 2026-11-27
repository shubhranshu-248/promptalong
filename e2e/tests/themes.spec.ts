import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { closeAll, createRoom, editor, joinRoom, person, type Person } from './helpers';

const SHOTS = process.env.PA_SCREENSHOTS; // a folder: screenshots are saved there when set

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

test.describe('themes', () => {
  test('the switch changes the theme on the site and in the room, and is kept', async ({
    browser,
  }) => {
    const aarav = await person(browser, 'Aarav');
    try {
      await aarav.page.emulateMedia({ colorScheme: 'light' });
      await aarav.page.goto('/');
      const html = aarav.page.locator('html');
      await expect(html).toHaveAttribute('data-theme', 'light');
      await aarav.page.getByTestId('theme-toggle').click();
      await expect(html).toHaveAttribute('data-theme', 'dark');
      // the credit line stays on the home screen, its heart in the text colour
      const credit = aarav.page.getByTestId('made-by-pinned');
      await expect(credit).toBeInViewport();
      const colours = await credit.evaluate((el) => ({
        text: getComputedStyle(el).color,
        heart: getComputedStyle(el.querySelector('svg') as Element).color,
      }));
      expect(colours.heart).toBe(colours.text);
      // dark theme: light text, so a light heart (the theme's off-white)
      const [r = 0, g = 0, b = 0] = (colours.text.match(/\d+/gu) ?? []).map(Number);
      expect(r + g + b).toBeGreaterThan(600);
      await aarav.page.mouse.wheel(0, 3000);
      await expect(credit).toBeInViewport();

      await createRoom(aarav);
      await expect(html).toHaveAttribute('data-theme', 'dark'); // kept
      await aarav.page.getByTestId('theme-toggle').click();
      await expect(html).toHaveAttribute('data-theme', 'light');
      await aarav.page.goto('/');
      await expect(html).toHaveAttribute('data-theme', 'light');
      const light = await aarav.page
        .getByTestId('made-by-pinned')
        .evaluate((el) => getComputedStyle(el.querySelector('svg') as Element).color);
      expect(light).toBe(
        await aarav.page.getByTestId('made-by-pinned').evaluate((el) => getComputedStyle(el).color),
      );
    } finally {
      await closeAll([aarav]);
    }
  });

  test('search finds an answer in another session and opens it there', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    const meera = await person(browser, 'Meera');
    try {
      const code = await createRoom(aarav);
      await joinRoom(meera, code);
      await editor(aarav).click();
      await aarav.page.keyboard.type('/short Lost and found pitch');
      await aarav.page.getByTestId('send-button').click();
      await expect(aarav.page.getByTestId('turn-answer')).toHaveCount(1);
      // a second session, empty
      await aarav.page.getByTestId('new-session').click();
      const dialog = aarav.page.getByRole('dialog', { name: 'New session' });
      await dialog.getByTestId('session-name').fill('Slides');
      await dialog.getByTestId('session-save').click();
      await expect(aarav.page.getByTestId('session-title')).toHaveText(' / Slides');
      await expect(aarav.page.getByTestId('turn-answer')).toHaveCount(0);

      await aarav.page.keyboard.press('Control+K');
      await aarav.page.getByTestId('search-input').fill('found pitch');
      const hit = aarav.page.getByTestId('search-hit');
      await expect(hit).toHaveCount(1);
      await expect(hit).toContainText('General · T1 · prompt');
      await aarav.page.keyboard.press('Enter');
      await expect(aarav.page.getByTestId('session-title')).toHaveText(' / General');
      await expect(aarav.page.locator('.pa-found')).toBeVisible();
      await expect(aarav.page.getByTestId('turn-answer')).toHaveCount(1);
    } finally {
      await closeAll([aarav, meera]);
    }
  });

  test('the invite has a QR code and a big join screen', async ({ browser }) => {
    const aarav = await person(browser, 'Aarav');
    try {
      const code = await createRoom(aarav);
      await aarav.page.getByRole('button', { name: 'Share link' }).click();
      const share = aarav.page.getByRole('dialog', { name: 'Invite your team' });
      await expect(share.getByTestId('qr-code')).toHaveAttribute('data-ready', 'true');
      await expect(share.getByRole('img', { name: /QR code for .*\/r\// })).toBeVisible();
      await share.getByTestId('join-screen-open').click();
      const screen = aarav.page.getByTestId('join-screen');
      await expect(screen).toContainText(`${code.slice(0, 3)}-${code.slice(3)}`);
      await expect(screen.getByTestId('qr-code')).toHaveAttribute('data-ready', 'true');
      expect(await axe(aarav.page)).toEqual([]);
      await aarav.page.keyboard.press('Escape');
      await expect(screen).toBeHidden();
    } finally {
      await closeAll([aarav]);
    }
  });
});

// Every screen, both themes, laptop and phone: no accessibility problem (contrast included).
for (const scheme of ['light', 'dark'] as const) {
  for (const vp of VIEWPORTS) {
    test(`audit: every screen, ${scheme}, ${vp.name}`, async ({ browser }) => {
      test.setTimeout(90_000);
      const host = await person(browser, 'Aarav');
      const guest = await person(browser, 'Meera');
      const people: Person[] = [host, guest];
      try {
        for (const p of people) {
          await p.page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        }
        const page = host.page;
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const check = async (name: string) => {
          expect(await axe(page), name).toEqual([]);
          await shot(page, `${vp.name}-${scheme}-${name}`);
        };
        for (const [path, name] of [
          ['/', 'landing'],
          ['/new', 'lobby'],
          ['/about', 'about'],
          ['/nowhere', 'not-found'],
        ] as const) {
          await page.goto(path);
          await expect(page.locator('h1').first()).toBeVisible();
          await check(name);
        }

        const code = await createRoom(host);
        await joinRoom(guest, code);
        await editor(host).click();
        await page.keyboard.type('/short Three slide titles');
        await page.getByTestId('send-button').click();
        await expect(page.getByTestId('turn-answer')).toHaveCount(1);
        await page.getByTestId('pin-answer').click();
        if (vp.name === 'mobile') await page.getByTestId('open-sidebar').click();
        await page.getByTestId('new-session').click();
        const dialog = page.getByRole('dialog', { name: 'New session' });
        await expect(dialog).toBeVisible();
        await check('new-session');
        await dialog.getByTestId('session-name').fill('Slides');
        await dialog.getByTestId('member-Meera').check();
        await dialog.getByTestId('session-save').click();
        await expect(dialog).toBeHidden();
        // (on a phone the sidebar drawer is still open after the dialog)
        await expect(page.getByTestId('session-list')).toBeVisible();
        await expect(page.getByTestId('pin-list')).toBeVisible();
        await check('room-sidebar');
        if (vp.name === 'mobile') await page.keyboard.press('Escape');
        await check('room');

        await page.keyboard.press('Control+K');
        await page.getByTestId('search-input').fill('slide');
        await expect(page.getByTestId('search-hit').first()).toBeVisible();
        await check('search');
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: 'Room menu' }).click();
        await page.getByRole('menuitem', { name: 'Export' }).click();
        await expect(page.getByTestId('export-preview')).toBeVisible();
        await check('export');
        await page.keyboard.press('Escape');

        await page.getByTestId('model-button').click();
        await expect(page.getByRole('dialog', { name: 'Model for this session' })).toBeVisible();
        await check('model');
        await page.keyboard.press('Escape');

        await page.goto('/demo');
        await expect(page.getByTestId('prompt-editor')).toBeVisible();
        await check('demo');
      } finally {
        await closeAll(people);
      }
    });
  }
}
