import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createRoom, focusEnd, person } from './helpers';

/**
 * The production security headers (apps/web/vercel.json). The test server sends the same headers
 * (apps/web/vite.config.ts, with the local relay added to connect-src), so every end-to-end test
 * runs under the production Content-Security-Policy; this file checks the policy itself and that
 * nothing the app does is blocked by it.
 */
interface VercelHeaders {
  headers: { source: string; headers: { key: string; value: string }[] }[];
}
const vercel = JSON.parse(
  readFileSync(new URL('../../apps/web/vercel.json', import.meta.url), 'utf8'),
) as VercelHeaders;
const all = vercel.headers.find((h) => h.source === '/(.*)')?.headers ?? [];
const csp = all.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';

async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener('securitypolicyviolation', (e) => {
      seen.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
}

const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

test('the production policy has no unsafe script sources', () => {
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  const script = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
  expect(script).not.toContain("'unsafe-inline'");
  expect(script).not.toContain("'unsafe-eval'");
  for (const key of ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options']) {
    expect(all.map((h) => h.key)).toContain(key);
  }
});

test('the app works under the production Content-Security-Policy', async ({ browser }) => {
  const aarav = await person(browser, 'Aarav');
  try {
    const page = aarav.page;
    await recordViolations(page);
    const res = await page.goto('/');
    expect(res?.headers()['content-security-policy']).toContain("default-src 'self'");
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Everyone prompts.');
    await page.goto('/about');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await violations(page)).toEqual([]);

    // a room: realtime, the server calls, the token counter's worker, a Send
    await createRoom(aarav);
    await focusEnd(aarav);
    await page.keyboard.type('/short check the policy');
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('turn-answer').last()).toHaveAttribute('data-status', 'done');
    expect(await violations(page)).toEqual([]);

    await page.goto('/demo');
    await expect(page.locator('.pa-caret').first()).toBeVisible({ timeout: 15_000 });
    expect(await violations(page)).toEqual([]);
  } finally {
    await aarav.context.close();
  }
});
