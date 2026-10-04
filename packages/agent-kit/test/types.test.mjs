// Keeps index.d.ts honest: every public runtime method/getter on RobynAgent is declared, and
// every declared member exists at runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as mod from '../index.js';

const dts = readFileSync(new URL('../index.d.ts', import.meta.url), 'utf8');

test('index.d.ts declares exactly the runtime exports', () => {
  const declared = [...dts.matchAll(/^export declare (?:class|function|const) (\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(declared, Object.keys(mod).sort());
});

test('RobynAgent members in index.d.ts match the runtime class', () => {
  const body = dts.slice(dts.indexOf('export declare class RobynAgent'));
  const declared = new Set([...body.matchAll(/^ {2}(?:readonly )?(\w+)\s*[(:?]/gm)].map((m) => m[1]));
  declared.delete('constructor');
  for (const f of ['signer', 'svc', 'permitVersion']) {
    assert.ok(declared.has(f), 'field ' + f + ' declared');
    declared.delete(f);
  }
  const runtime = Object.getOwnPropertyNames(mod.RobynAgent.prototype)
    .filter((n) => n !== 'constructor' && !n.startsWith('_'));
  assert.deepEqual([...declared].sort(), runtime.sort());
});
