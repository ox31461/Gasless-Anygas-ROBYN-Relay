// node --test packages/mcp/test/
// The local MCP server checks every Permit2 payload and spend before it signs (spend-policy.mjs, permit2-check.mjs).
// No network, no real key: the policy runs on a scratch ledger and a fixed clock, and the wiring rows read index.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { policyFromEnv, makeSpendGuard, SpendPolicyError } from '../spend-policy.mjs';
import { checkPermit2Request, PERMIT2 } from '../permit2-check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIGNER = '0x1111111111111111111111111111111111111111';
const RELAYER = '0x2222222222222222222222222222222222222222';
const OTHER = '0x3333333333333333333333333333333333333333';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NOW = 1_800_000_000;
const reasonOf = (fn) => { try { fn(); return 'passed'; } catch (e) { if (!(e instanceof SpendPolicyError)) throw e; return e.reason; } };

const goodRequest = (o = {}) => ({
  eip712: {
    domain: { name: 'Permit2', chainId: 8453, verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3' },
    value: { permitted: { token: USDC, amount: '25000000' }, spender: RELAYER, nonce: '7', deadline: String(NOW + 1800) },
  },
  submitBody: { fromChain: 8453, fromToken: USDC, amount: '25000000', toChain: 42161, toToken: 'USDC', toAddress: SIGNER },
  ...o,
});
const withValue = (v) => { const r = goodRequest(); r.eip712.value = { ...r.eip712.value, ...v }; return r; };
const withDomain = (d) => { const r = goodRequest(); r.eip712.domain = { ...r.eip712.domain, ...d }; return r; };
const withBody = (b) => { const r = goodRequest(); r.submitBody = { ...r.submitBody, ...b }; return r; };
const LISTED = new Set([USDC.toLowerCase()]);
const check = (sr, request = {}, spender = RELAYER, allowedTokens = LISTED) => reasonOf(() => checkPermit2Request(sr, { spender, request, allowedTokens, nowSecs: NOW }));

test('a payload that matches the move passes and returns the values to police', () => {
  const out = checkPermit2Request(goodRequest(), { spender: RELAYER, allowedTokens: LISTED, request: { fromChain: 8453, token: 'USDC', amount: '25000000', toChain: 42161, toAddress: SIGNER }, nowSecs: NOW });
  assert.deepEqual(out, { chainId: 8453, token: USDC, amount: '25000000', toAddress: SIGNER, toChain: 42161, toToken: 'USDC' });
  assert.equal(PERMIT2, '0x000000000022d473030f116ddee9f6b43ac78ba3');
});

test('the domain must be exactly Permit2 on the source chain', () => {
  assert.equal(check(withDomain({ verifyingContract: OTHER })), 'payload');
  assert.equal(check(withDomain({ name: 'Permit3' })), 'payload');
  assert.equal(check(withDomain({ version: '1' })), 'payload');
  assert.equal(check(withDomain({ chainId: 1 })), 'payload', 'a domain chain the submit body does not name');
  assert.equal(check(withDomain({ chainId: 'base' })), 'payload');
});

test('token, amount and spender must be what this move permits', () => {
  assert.equal(check(withValue({ permitted: { token: OTHER, amount: '25000000' } })), 'payload', 'a token the body does not move');
  assert.equal(check(withValue({ permitted: { token: USDC, amount: '99000000' } })), 'payload', 'an amount the body does not move');
  assert.equal(check(withValue({ permitted: { token: USDC, amount: '0' } })), 'payload');
  assert.equal(check(withValue({ spender: OTHER })), 'payload', 'a spender that is not the expected relayer');
  assert.equal(check(goodRequest(), {}, null), 'payload', 'no expected relayer known');
});

test('the deadline must be in the future and short', () => {
  assert.equal(check(withValue({ deadline: String(NOW) })), 'payload');
  assert.equal(check(withValue({ deadline: String(NOW + 7201) })), 'payload');
  assert.equal(check(withValue({ deadline: '1e20' })), 'payload');
  assert.equal(check(withValue({ nonce: '-1' })), 'payload');
});

test('the submit body must name the same chain, token, amount and a destination', () => {
  assert.equal(check(withBody({ fromChain: 1 })), 'payload');
  assert.equal(check(withBody({ fromToken: OTHER })), 'payload');
  assert.equal(check(withBody({ amount: '25000001' })), 'payload');
  assert.equal(check(withBody({ toAddress: undefined })), 'payload');
  assert.equal(check({ eip712: goodRequest().eip712 }), 'payload');
  assert.equal(check(null), 'payload');
});

test("the agent's own structured fields survive the plan unchanged", () => {
  assert.equal(check(goodRequest(), { fromChain: 1 }), 'payload');
  assert.equal(check(goodRequest(), { token: OTHER }), 'payload');
  assert.equal(check(goodRequest(), { token: 'USDC' }), 'passed', 'a symbol is left to the spend policy');
  assert.equal(check(goodRequest(), { amount: '1' }), 'payload');
  assert.equal(check(goodRequest(), { toAddress: OTHER }), 'payload');
  assert.equal(check(goodRequest(), { toChain: 10 }), 'payload');
});

test('the service cannot pick the source token when the agent named it only by symbol', () => {
  assert.equal(check(goodRequest(), { token: 'USDC' }, RELAYER, new Set()), 'payload', 'no source-token list: a symbol-only request is refused');
  assert.equal(check(goodRequest(), {}, RELAYER, new Set()), 'payload', 'no token named at all');
  const evil = withValue({ permitted: { token: OTHER, amount: '25000000' } }); evil.submitBody.fromToken = OTHER;
  assert.equal(check(evil, { token: 'USDC' }), 'payload', 'a consistent plan for an unlisted token the signer holds');
  assert.equal(check(goodRequest(), { token: USDC }, RELAYER, new Set()), 'passed', 'the agent named the token by address');
});

test('the spend policy then refuses a stranger, an unlisted token or chain, and caps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-spend-'));
  try {
    const g = makeSpendGuard(policyFromEnv({ ROBYN_MAX_PER_DAY: '30000000', ROBYN_SPEND_LEDGER: path.join(dir, 'spend.json') }), { now: () => NOW * 1000 });
    const req = (o = {}) => ({ signer: SIGNER, chain: 8453, token: USDC, amount: '25000000', toAddress: SIGNER, toChain: 42161, toToken: 'USDC', spender: RELAYER, ...o });
    assert.equal(reasonOf(() => g.authorize(req({ toAddress: OTHER }))), 'recipient');
    assert.equal(reasonOf(() => g.authorize(req({ toToken: OTHER }))), 'to-token');
    assert.equal(reasonOf(() => g.authorize(req({ toToken: '' }))), 'to-token', 'a plan that names no destination token');
    assert.equal(reasonOf(() => g.authorize(req({ toChain: 'stellar' }))), 'to-chain');
    assert.equal(reasonOf(() => g.authorize(req({ toChain: '' }))), 'to-chain', 'a plan that names no destination chain');
    assert.equal(reasonOf(() => g.authorize(req())), 'passed');
    assert.equal(reasonOf(() => g.authorize(req({ amount: '5000001' }))), 'per-day');
    const pinned = makeSpendGuard(policyFromEnv({ ROBYN_RELAYER: RELAYER, ROBYN_SPEND_LEDGER: path.join(dir, 'b.json') }));
    assert.equal(reasonOf(() => pinned.authorize(req({ spender: OTHER }))), 'relayer');
    assert.equal(reasonOf(() => pinned.authorize(req({ spender: undefined }))), 'relayer', 'a caller that forgets the spender is still checked');
    const yieldReq = { signer: SIGNER, chain: 8453, token: 'yield-usdc', amount: '25000000', toAddress: SIGNER, toChain: 8453 };
    assert.equal(reasonOf(() => pinned.authorize(yieldReq)), 'relayer');
    assert.equal(reasonOf(() => pinned.authorize({ ...yieldReq, spenderless: true })), 'passed', 'the yield Spend intent names no spender');
    assert.equal(reasonOf(() => pinned.authorize({ ...yieldReq, spenderless: 'yes' })), 'relayer', 'only a literal true opts out');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('every signing tool asks the checks before it signs', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'index.mjs'), 'utf8');
  const handler = (name) => { const i = src.indexOf("server.registerTool('" + name + "'"); const j = src.indexOf('server.registerTool(', i + 10); assert.ok(i >= 0, name); return src.slice(i, j < 0 ? src.length : j); };
  const order = (h, ...marks) => { const at = marks.map((m) => h.indexOf(m)); assert.ok(at.every((x, k) => x >= 0 && (k === 0 || x > at[k - 1])), marks.join(' < ') + ' ' + at); };
  order(handler('robyn_cross_chain'), 'spendRefusal(', 'if (refusedX) return text(refusedX)', 'signTypedData(');
  order(handler('robyn_agent_execute'), 'checkPermit2Request(sr', 'spendRefusal(', 'if (refusedA) return text(refusedA)', 'signTypedData(');
  order(handler('robyn_yield_spend'), 'spendRefusal(', 'if (refusedY) return text(refusedY)', 'signTypedData(');
  assert.match(handler('robyn_yield_spend'), /spenderless: true/);
  assert.equal((src.match(/spenderless: true/g) || []).length, 1, 'only the yield tool skips the relayer comparison');
  assert.equal((src.match(/signTypedData\(/g) || []).length, 3, 'no other signing site');
  assert.match(handler('robyn_agent_execute'), /toChain: checked\.toChain \?\? '', toToken: checked\.toToken \?\? ''/);
  const ax = handler('robyn_agent_execute');
  assert.match(ax, /allowedTokens: POLICY\.allowedTokens/, 'the source-token list reaches the payload check');
  order(ax, 'POLICY.allowedTokens.size === 0', "POST('/api/agent/do'");
  order(ax, 'a.amount === undefined && POLICY.maxPerCall === null', "POST('/api/agent/do'");
  order(ax, 'if (a.sandbox) return', 'signTypedData(');
  assert.match(ax, /signTypedData\(sr\.eip712\.domain, P2_TYPES, v\)/, 'signs with the local Permit2 types');
  assert.doesNotMatch(ax, /\.\.\.sr\.submitBody/, 'the executed body is built from checked values only');
  assert.match(ax, /fromChain: checked\.chainId, fromToken: checked\.token, amount: checked\.amount,/);
  order(src, 'if (KEY && !POLICY.relayer)', 'process.exit(1)', 'server.registerTool(');
});

test('fields the service adds to the permit value do not change what is signed', async () => {
  const { ethers } = await import('ethers');
  const src = fs.readFileSync(path.join(HERE, '..', 'index.mjs'), 'utf8');
  const m = /const P2_TYPES = (\{[\s\S]*?\] \});/.exec(src); assert.ok(m, 'P2_TYPES is a local constant');
  const P2_TYPES = Function('return ' + m[1])();
  const w = new ethers.Wallet('0x' + '11'.repeat(32));   // fixed throwaway key, never funded
  const r = goodRequest(); const v = r.eip712.value;
  const plain = await w.signTypedData(r.eip712.domain, P2_TYPES, v);
  const extra = await w.signTypedData(r.eip712.domain, P2_TYPES, { ...v, witness: '0x' + 'ab'.repeat(32), to: OTHER });
  assert.equal(extra, plain);
});
