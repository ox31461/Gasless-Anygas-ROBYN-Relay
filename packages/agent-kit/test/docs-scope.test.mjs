// Docs scope check: the packages publish as @anygas/* (JSR) and anygas-* (npm). The legacy
// @robyn/* scope stopped at 1.0.x, so any Markdown in the repo that still tells people to install
// or import it is a bug. A stale name is allowed only on a line that explains it is the legacy one.
//
// The test is skipped when the repo root is not present (e.g. when the published package is
// installed on its own); the test directory is not part of the published files anyway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

function findRepoRoot(from) {
  let dir = from;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'CONTRIBUTING.md')) && existsSync(join(dir, 'packages'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

function* markdownFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.git')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* markdownFiles(p);
    else if (name.endsWith('.md')) yield p;
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = findRepoRoot(HERE);

// Each stale name, and the regexp that catches it in prose and code blocks.
const STALE = [
  { name: '@robyn/* (JSR scope)', re: /@robyn\// },
  { name: 'robyn-mcp (npm bin)', re: /\brobyn-mcp\b/ },
  { name: 'robyn-agent-kit (npm package)', re: /\brobyn-agent-kit\b/ },
];
const LEGACY_LINE = /legacy/i;

test('Markdown docs use the @anygas/* scope, not the legacy @robyn/* one', { skip: !ROOT && 'repo root not found' }, () => {
  const offenders = [];
  for (const file of markdownFiles(ROOT)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (LEGACY_LINE.test(line)) return;
      for (const { name, re } of STALE) {
        if (re.test(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}: ${name}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], 'stale package names in docs (mention them only on a line that says "legacy"):\n' + offenders.join('\n'));
});

test('every jsr.json publishes under @anygas/* and the README names that package', { skip: !ROOT && 'repo root not found' }, () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const pkgs = readdirSync(join(ROOT, 'packages')).filter((d) => existsSync(join(ROOT, 'packages', d, 'jsr.json')));
  assert.ok(pkgs.length >= 3, 'expected agent-kit, mcp and adapters to have a jsr.json');
  for (const d of pkgs) {
    const { name } = JSON.parse(readFileSync(join(ROOT, 'packages', d, 'jsr.json'), 'utf8'));
    assert.match(name, /^@anygas\//, `${d}/jsr.json publishes as ${name}`);
    assert.ok(readme.includes(name), `README.md does not mention ${name}`);
    assert.ok(readme.includes(`https://jsr.io/badges/${name}`), `README.md badge missing for ${name}`);
  }
});
