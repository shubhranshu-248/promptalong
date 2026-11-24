import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = ['/', '/new', '/demo', '/r/K7QM2X'];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const vp of VIEWPORTS) {
    for (const path of PAGES) {
      test(`axe: ${path} ${vp.name} ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(path);
        await expect(page.locator('h1')).toBeVisible();
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      });
    }
  }
}

test('no horizontal scroll on a 390 px phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
