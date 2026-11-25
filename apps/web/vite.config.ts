import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

interface VercelConfig {
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

/**
 * `vite preview` (used by the end-to-end tests) sends the same security headers as production
 * (vercel.json), so a policy change that breaks the app fails the tests. Only the local relay and
 * a local Supabase stack are added to connect-src.
 */
function productionHeaders(): Record<string, string> {
  const vercel = JSON.parse(
    readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'),
  ) as VercelConfig;
  const out: Record<string, string> = {};
  for (const h of vercel.headers.find((x) => x.source === '/(.*)')?.headers ?? []) {
    if (h.key === 'Strict-Transport-Security') continue; // http://localhost
    out[h.key] =
      h.key === 'Content-Security-Policy'
        ? h.value.replace(
            'connect-src ',
            'connect-src ws://localhost:8787 http://localhost:8787 http://127.0.0.1:54321 ws://127.0.0.1:54321 ',
          )
        : h.value;
  }
  return out;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true, headers: productionHeaders() },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
    env: { VITE_REALTIME: 'none' },
  },
});
