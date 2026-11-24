import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';

// Writes review screenshots only when SCREENSHOT_DIR is set (not part of CI).
const dir = process.env.SCREENSHOT_DIR;

test.describe('screenshots', () => {
  test.skip(!dir, 'set SCREENSHOT_DIR to write screenshots');

  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [1440, 390]) {
      test(`landing ${width} ${scheme}`, async ({ page }) => {
        if (!dir) return;
        mkdirSync(dir, { recursive: true });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.goto('/');
        await page.evaluate(() => document.fonts.ready);
        const suffix = scheme === 'light' ? '' : '-dark';
        await page.screenshot({
          path: join(dir, `01-landing-${width}${suffix}.png`),
          fullPage: true,
        });
      });
    }
  }
});
