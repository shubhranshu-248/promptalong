import { expect, test } from '@playwright/test';

test('landing page loads with its main actions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Everyone prompts.');
  await expect(page.getByRole('link', { name: 'Start a room' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try the live demo' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('two people open the same room link in separate browsers', async ({ browser }) => {
  // P1 smoke: two isolated contexts (like two laptops) reach the same room route.
  // P2 replaces this with real shared typing.
  const a = await browser.newContext();
  const b = await browser.newContext();
  try {
    const [pageA, pageB] = await Promise.all([a.newPage(), b.newPage()]);
    await Promise.all([pageA.goto('/r/k7q-m2x'), pageB.goto('/r/K7QM2X')]);
    for (const p of [pageA, pageB]) {
      await expect(p.getByRole('heading', { name: 'Room K7Q-M2X' })).toBeVisible();
    }
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

test('client-side navigation and unknown routes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Try the live demo' }).click();
  await expect(page).toHaveURL(/\/demo$/u);
  await expect(page.getByRole('heading', { name: 'Live demo' })).toBeVisible();
  await page.goto('/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('self-hosted fonts and icons load from our own origin', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:')) foreign.push(r.url());
  });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('700 60px "Space Grotesk"'))).toBe(true);
  const icon = await page.request.get('/favicon.svg');
  expect(icon.ok()).toBe(true);
  expect(foreign).toEqual([]);
});
