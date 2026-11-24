#!/usr/bin/env node
// Fails when tool-attribution text shows up in the tracked tree, in commit messages or in
// the pull request title/body. Patterns are stored base64-encoded so this file stays clean.
//
// Usage:
//   node scripts/check-traces.mjs                 tree + commits not yet on origin/main
//   node scripts/check-traces.mjs --base <ref>    tree + commits in <ref>..HEAD
//   node scripts/check-traces.mjs --tree-only     tree only
//   node scripts/check-traces.mjs --message-file <path>   one commit message (commit-msg hook)
// PR_TITLE and PR_BODY environment variables are checked when present.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ENCODED = [
  'Y28tYXV0aG9yZWQtYnk=',
  'Z2VuZXJhdGVkIHdpdGg=',
  'Y2xhdWRl',
  'YW50aHJvcGlj',
  'Y29waWxvdA==',
  'Y2hhdGdwdA==',
  'YW50aWdyYXZpdHk=',
  'Y3Vyc29yXC5zaA==',
  '8J+klg==',
];
const patterns = ENCODED.map((b) => Buffer.from(b, 'base64').toString('utf8'));
const textRe = new RegExp(patterns.join('|'), 'iu');
// Binary files are scanned byte-wise (latin1) so embedded metadata is caught too.
const asciiRe = new RegExp(patterns.slice(0, -1).join('|'), 'i');

// Only model/vendor names in the provider catalog are allowed to match.
const EXEMPT_DIRS = ['packages/providers/src/catalog/'];
// Local-only files that must never be committed.
const toolName = patterns[2] ?? ''; // the assistant tool name, decoded above
const FORBIDDEN_PATH_RE = new RegExp(
  `(^|/)(${toolName}(\\.local)?\\.md|AGENTS\\.md|\\.mcp\\.json)$|(^|/)\\.${toolName}/`,
  'iu',
);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const hits = [];

function scanText(label, text) {
  text.split(/\r?\n/u).forEach((line, i) => {
    const m = line.match(textRe);
    if (m) hits.push(`${label}:${i + 1}: "${m[0]}"`);
  });
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

function scanTree() {
  const files = git('ls-files', '-z').split('\0').filter(Boolean);
  for (const file of files) {
    if (FORBIDDEN_PATH_RE.test(file)) hits.push(`${file}: local-only file is tracked`);
    if (EXEMPT_DIRS.some((d) => file.startsWith(d))) continue;
    const pathHit = file.match(textRe);
    if (pathHit) hits.push(`${file}: path contains "${pathHit[0]}"`);
    let buf;
    try {
      buf = readFileSync(file);
    } catch {
      continue; // deleted in the working tree
    }
    if (isBinary(buf)) {
      const m = buf.toString('latin1').match(asciiRe);
      if (m) hits.push(`${file}: binary contains "${m[0]}"`);
      if (buf.includes(Buffer.from(patterns.at(-1) ?? '', 'utf8')))
        hits.push(`${file}: binary contains emoji`);
    } else {
      scanText(file, buf.toString('utf8'));
    }
  }
  return files.length;
}

function resolveBase() {
  const explicit = value('--base');
  if (explicit) return explicit;
  for (const ref of ['origin/main', 'main']) {
    try {
      git('rev-parse', '--verify', '--quiet', ref);
      const head = git('rev-parse', 'HEAD').trim();
      const base = git('rev-parse', ref).trim();
      if (head !== base) return ref;
    } catch {
      // ref missing, try the next one
    }
  }
  return null; // no base: check every commit on HEAD
}

function scanCommits() {
  const base = resolveBase();
  const range = base ? [`${base}..HEAD`] : ['HEAD'];
  let shas;
  try {
    shas = git('rev-list', ...range)
      .split('\n')
      .filter(Boolean);
  } catch {
    return 0; // no commits yet
  }
  for (const sha of shas) {
    const raw = git('log', '-1', '--format=%an <%ae>%n%cn <%ce>%n%B', sha);
    scanText(`commit ${sha.slice(0, 8)}`, raw);
  }
  return shas.length;
}

let summary;
const messageFile = value('--message-file');
if (messageFile) {
  scanText('commit message', readFileSync(messageFile, 'utf8'));
  summary = 'commit message';
} else {
  const files = scanTree();
  const commits = flag('--tree-only') ? 0 : scanCommits();
  summary = `${files} files, ${commits} commits`;
}
for (const key of ['PR_TITLE', 'PR_BODY']) {
  if (process.env[key]) scanText(key, process.env[key]);
}

if (hits.length > 0) {
  console.error(`check-traces: ${hits.length} hit(s)`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`check-traces: clean (${summary})`);
