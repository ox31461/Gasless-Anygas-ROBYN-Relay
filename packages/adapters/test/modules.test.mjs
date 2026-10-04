// Every entry point loads without its optional framework peer installed, and each .d.ts declares
// exactly the runtime exports of its module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

for (const [sub, spec] of Object.entries(pkg.exports)) {
  test(`${sub}: ${spec.types} matches ${spec.default} exports`, async () => {
    const mod = await import(new URL('../' + spec.default, import.meta.url));
    const dts = readFileSync(new URL('../' + spec.types, import.meta.url), 'utf8');
    const declared = [...dts.matchAll(/^export (?:declare )?(?:function|const|class) (\w+)/gm)].map((m) => m[1]).sort();
    assert.deepEqual(declared, Object.keys(mod).sort());
    for (const f of [spec.default, spec.types]) assert.ok(pkg.files.includes(f.replace(/^\.\//, '')), f + ' is published');
  });
}

const PEERS = { './ai-sdk': ['robynTools', 'ai'], './langchain': ['robynLangchainTools', '@langchain/core'], './agentkit': ['robynActionProvider', '@coinbase/agentkit'] };
for (const [sub, [fn, peer]] of Object.entries(PEERS)) {
  test(`${sub}: ${fn}() reports the missing optional peer ${peer}`, async (t) => {
    try { await import(peer); t.skip(peer + ' is installed'); return; } catch { /* expected: not installed */ }
    const mod = await import(new URL('../' + pkg.exports[sub].default, import.meta.url));
    await assert.rejects(mod[fn]({ svc: 'https://svc.test/svc' }), (e) => e.code === 'ERR_MODULE_NOT_FOUND' && e.message.includes(peer));
  });
}
