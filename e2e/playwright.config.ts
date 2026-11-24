import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const ROOT = new URL('..', import.meta.url).pathname; // web servers run from the repo root
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.env.PW_ALL_BROWSERS
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],
  webServer: [
    {
      command: 'node scripts/dev-relay.mjs',
      cwd: ROOT,
      url: 'http://localhost:8787',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // A build that syncs rooms through the local relay instead of Supabase.
      command:
        'pnpm --filter @promptalong/web build:e2e && pnpm --filter @promptalong/web preview:e2e',
      cwd: ROOT,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
