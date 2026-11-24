#!/usr/bin/env node
// Licence allow-list for every installed third-party package (ADR-001).
// Runtime packages (shipped to the browser): MIT, ISC, BSD-2/3, Apache-2.0, 0BSD, OFL-1.1 (fonts).
// Dev-only packages may also be MPL-2.0 (axe-core) and a few permissive extras.
import { execFileSync } from 'node:child_process';

const RUNTIME_OK = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'OFL-1.1',
]);
const DEV_ONLY_OK = new Set([
  ...RUNTIME_OK,
  'MPL-2.0',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'Python-2.0',
  'Unlicense',
]);

/** True when an SPDX expression is satisfied by the allowed set ("A OR B" needs one, "A AND B" needs all). */
export function allowed(expr, ok) {
  const clean = String(expr).replace(/[()]/gu, '').trim();
  if (/\sOR\s/iu.test(clean)) return clean.split(/\s+OR\s+/iu).some((p) => allowed(p, ok));
  if (/\sAND\s/iu.test(clean)) return clean.split(/\s+AND\s+/iu).every((p) => allowed(p, ok));
  return ok.has(clean);
}

function listLicenses(prodOnly) {
  // Runtime = what ships to the browser: production dependencies of the web app.
  const scope = prodOnly
    ? ['--filter', '@promptalong/web', 'licenses', 'list', '--prod']
    : ['licenses', 'list', '--recursive'];
  const out = execFileSync('pnpm', [...scope, '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const data = JSON.parse(out);
  /** @type {Map<string, string>} name@version -> licence */
  const result = new Map();
  for (const [license, pkgs] of Object.entries(data)) {
    for (const p of pkgs) {
      for (const v of p.versions ?? [p.version]) result.set(`${p.name}@${v}`, license);
    }
  }
  return result;
}

const runtime = listLicenses(true);
const all = listLicenses(false);
const problems = [];
for (const [pkg, license] of all) {
  if (pkg.startsWith('@promptalong/')) continue;
  const ok = runtime.has(pkg) ? RUNTIME_OK : DEV_ONLY_OK;
  if (!allowed(license, ok))
    problems.push(`${pkg}: ${license}${runtime.has(pkg) ? ' (runtime)' : ''}`);
}

if (problems.length > 0) {
  console.error('check-licenses: not on the allow-list:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-licenses: ok (${runtime.size} runtime, ${all.size} total packages)`);
