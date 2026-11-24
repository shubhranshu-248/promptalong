#!/usr/bin/env node
// First-load JS budget (performance budgets in docs/architecture.md): the JS referenced by index.html must be < 200 KB gzip.
// Lazy route chunks are not counted.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT_KB = 200;
const dist = 'apps/web/dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entries = [
  ...html.matchAll(/<script[^>]+src="\/([^"]+\.js)"/gu),
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/([^"]+\.js)"/gu),
].map((m) => m[1]);

let total = 0;
for (const file of new Set(entries)) {
  const size = gzipSync(readFileSync(join(dist, file))).length;
  total += size;
  console.log(`  ${file}: ${(size / 1024).toFixed(1)} KB gzip`);
}
const kb = total / 1024;
if (entries.length === 0) {
  console.error('check-budget: no entry scripts found in index.html');
  process.exit(1);
}
if (kb >= LIMIT_KB) {
  console.error(`check-budget: first-load JS ${kb.toFixed(1)} KB gzip >= ${LIMIT_KB} KB`);
  process.exit(1);
}
console.log(`check-budget: first-load JS ${kb.toFixed(1)} KB gzip (limit ${LIMIT_KB} KB)`);
