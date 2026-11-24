import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const ROOT = new URL('..', import.meta.url).pathname; // web servers run from the repo root
const executablePath = process.env.PW_CHROMIUM_PATH;
// E2E_REALTIME=supabase runs the same tests through the real Supabase project; its URL and anon key
// are read by Vite from apps/web/.env.local. The default is the local relay (no hosted service).
const SUPABASE = process.env.E2E_REALTIME === 'supabase';

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
    ...(SUPABASE
      ? []
      : [
          {
            command: 'node scripts/dev-relay.mjs',
            cwd: ROOT,
            url: 'http://localhost:8787',
            reuseExistingServer: false,
            timeout: 30_000,
          },
        ]),
    {
      // A build that syncs rooms through the local relay (or Supabase, see above).
      command: `pnpm --filter @promptalong/web ${SUPABASE ? 'build:e2e:supabase' : 'build:e2e'} && pnpm --filter @promptalong/web preview:e2e`,
      cwd: ROOT,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
