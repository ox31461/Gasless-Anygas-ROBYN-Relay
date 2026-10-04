import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ethers } from 'ethers';
import { createServer, READ_TOOLS, EXECUTE_TOOLS, PERMIT2, DEFAULT_SVC } from '../server.mjs';
import { mockFetch, router, json } from './helpers.mjs';

const SVC = 'https://svc.test/svc';
const P2_TYPES = {
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ],
  TokenPermissions: [ { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' } ] };
const TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const RELAYER = '0x1111111111111111111111111111111111111111';

async function connect(opts) {
  const server = createServer(opts);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}
const parse = (res) => {
  const t = res.content[0].text;
  try { return JSON.parse(t); } catch { return t; }
};

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });

describe('tool registration', () => {
  test('without a key only read-only tools are registered', async () => {
    const client = await connect({ svc: SVC });
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...READ_TOOLS].sort());
    for (const n of EXECUTE_TOOLS) assert.ok(!names.includes(n), n + ' must not be exposed');
  });

  test('with a key the execute tools are registered too', async () => {
    const client = await connect({ svc: SVC, key: ethers.Wallet.createRandom().privateKey });
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...READ_TOOLS, ...EXECUTE_TOOLS].sort());
  });

  test('calling an execute tool on a read-only server is refused', async () => {
    const client = await connect({ svc: SVC });
    const res = await client.callTool({ name: 'robyn_cross_chain', arguments: {} }).catch((e) => ({ isError: true, e }));
    assert.equal(res.isError, true);
  });

  test('defaults to the public gateway', async () => {
    assert.equal(DEFAULT_SVC, 'https://api.anygas.xyz/svc');
    mock = mockFetch(() => ({ ok: true }));
    const client = await connect({});
    await client.callTool({ name: 'robyn_errors', arguments: {} });
    assert.equal(mock.calls[0].url, 'https://api.anygas.xyz/svc/api/errors');
  });
});

describe('read tools', () => {
  test('robyn_mesh GETs /api/route/chains (trailing slash on svc stripped)', async () => {
    mock = mockFetch(router(SVC, { 'GET /api/route/chains': { relayer: RELAYER, chains: [8453] } }));
    const client = await connect({ svc: SVC + '/' });
    const res = await client.callTool({ name: 'robyn_mesh', arguments: {} });
    assert.equal(mock.calls[0].url, SVC + '/api/route/chains');
    assert.deepEqual(parse(res), { relayer: RELAYER, chains: [8453] });
  });

  test('robyn_quote POSTs fromChain/toChain/amount as JSON', async () => {
    mock = mockFetch(router(SVC, { 'POST /api/route/quote': { estOut: '24900000' } }));
    const client = await connect({ svc: SVC });
    const args = { fromChain: 8453, fromToken: TOKEN, toChain: 'stellar', toToken: 'USDC', amount: '25000000' };
    const res = await client.callTool({ name: 'robyn_quote', arguments: args });
    const c = mock.calls[0];
    assert.equal(c.method, 'POST');
    assert.equal(c.headers['content-type'], 'application/json');
    assert.deepEqual(c.body, args);
    assert.deepEqual(parse(res), { estOut: '24900000' });
  });

  test('robyn_route_status URL-encodes the id', async () => {
    mock = mockFetch(() => ({ status: 'DONE' }));
    const client = await connect({ svc: SVC });
    await client.callTool({ name: 'robyn_route_status', arguments: { id: 'rt_a b&c' } });
    assert.equal(mock.calls[0].url, SVC + '/api/route/status?id=rt_a%20b%26c');
  });

  test('robyn_agent_do forwards the intent untouched', async () => {
    mock = mockFetch(router(SVC, { 'POST /api/agent/do': { status: 'quoted' } }));
    const client = await connect({ svc: SVC });
    const args = { intent: 'send 25 USDC to 0xabc on arbitrum', fromChain: 8453, sandbox: true };
    const res = await client.callTool({ name: 'robyn_agent_do', arguments: args });
    assert.deepEqual(mock.calls[0].body, args);
    assert.equal(parse(res).status, 'quoted');
  });

  test('typed API errors (JSON body, non-2xx) are handed back as data', async () => {
    mock = mockFetch(() => json({ errorCode: 'NO_ROUTE', retryable: false }, 422));
    const client = await connect({ svc: SVC });
    const res = await client.callTool({ name: 'robyn_quote', arguments: { fromChain: 1, fromToken: TOKEN, toChain: 2, toToken: 'USDC', amount: '1' } });
    assert.equal(parse(res).errorCode, 'NO_ROUTE');
  });

  test('a non-JSON response surfaces as a clear tool error', async () => {
    mock = mockFetch(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    const client = await connect({ svc: SVC });
    const res = await client.callTool({ name: 'robyn_mesh', arguments: {} });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /non-JSON \(HTTP 502\)/);
  });

  test('robyn_yield_account needs an agent when no key is set', async () => {
    mock = mockFetch(() => { throw new Error('should not fetch'); });
    const client = await connect({ svc: SVC });
    const res = await client.callTool({ name: 'robyn_yield_account', arguments: {} });
    assert.match(parse(res), /pass agent/);
  });

  test('robyn_yield_account/quote default the agent to the key address', async () => {
    const w = ethers.Wallet.createRandom();
    mock = mockFetch(() => ({ ok: true }));
    const client = await connect({ svc: SVC, key: w.privateKey });
    await client.callTool({ name: 'robyn_yield_account', arguments: {} });
    assert.equal(mock.calls[0].url, SVC + '/api/ncaccount/' + w.address);
    await client.callTool({ name: 'robyn_yield_quote', arguments: { srcChain: 8453, amount: '5000000' } });
    assert.deepEqual(mock.calls[1].body, { agent: w.address, srcChain: 8453, amount: '5000000', toChain: 8453, toAddress: w.address });
  });
});

describe('execute tools', () => {
  test('robyn_cross_chain signs a Permit2 transfer that recovers to the key', async () => {
    const w = ethers.Wallet.createRandom();
    mock = mockFetch(router(SVC, {
      'GET /api/route/chains': { relayer: RELAYER },
      'POST /api/route/execute': { id: 'rt_1', status: 'BRIDGING' },
    }));
    const client = await connect({ svc: SVC, key: w.privateKey });
    const res = await client.callTool({ name: 'robyn_cross_chain', arguments: { fromChain: 8453, fromToken: TOKEN, amount: '25000000', toChain: 42161, toToken: 'USDC' } });
    assert.deepEqual(parse(res), { id: 'rt_1', status: 'BRIDGING' });
    const b = mock.calls[1].body;
    assert.equal(b.mode, 'permit2');
    assert.equal(b.fromChain, 8453);
    assert.equal(b.toChain, 42161);
    assert.equal(b.amount, '25000000');
    assert.equal(b.toAddress, w.address);
    assert.equal(b.permit2.owner, w.address);
    assert.deepEqual(b.permit2.permitted, { token: TOKEN, amount: '25000000' });
    assert.equal(typeof b.permit2.nonce, 'string');
    const signer = ethers.verifyTypedData(
      { name: 'Permit2', chainId: 8453, verifyingContract: PERMIT2 }, P2_TYPES,
      { permitted: b.permit2.permitted, spender: RELAYER, nonce: b.permit2.nonce, deadline: b.permit2.deadline },
      b.permit2.signature);
    assert.equal(signer, w.address);
    assert.ok(BigInt(b.permit2.deadline) > BigInt(Math.floor(Date.now() / 1000)));
  });

  test('robyn_cross_chain reports a missing relayer instead of signing', async () => {
    mock = mockFetch(router(SVC, { 'GET /api/route/chains': {} }));
    const client = await connect({ svc: SVC, key: ethers.Wallet.createRandom().privateKey });
    const res = await client.callTool({ name: 'robyn_cross_chain', arguments: { fromChain: 8453, fromToken: TOKEN, amount: '1', toChain: 10, toToken: 'USDC' } });
    assert.match(parse(res), /relayer\/spender unavailable/);
    assert.equal(mock.calls.length, 1);
  });

  test('robyn_agent_execute signs the server payload and submits with an idempotency key', async () => {
    const w = ethers.Wallet.createRandom();
    const value = { permitted: { token: TOKEN, amount: '25000000' }, spender: RELAYER, nonce: '123', deadline: '9999999999' };
    const domain = { name: 'Permit2', chainId: 8453, verifyingContract: PERMIT2 };
    mock = mockFetch(router(SVC, {
      'POST /api/agent/do': { status: 'sign', rail: 'r1', receives: '24.9 USDC', understood: { token: 'USDC' },
        signRequest: { eip712: { domain, types: P2_TYPES, primaryType: 'PermitTransferFrom', value }, submitBody: { fromChain: 8453, toChain: 42161, mode: 'permit2' } } },
      'POST /api/route/execute': { id: 'rt_9' },
    }));
    const client = await connect({ svc: SVC, key: w.privateKey });
    const res = await client.callTool({ name: 'robyn_agent_execute', arguments: { intent: 'send 25 USDC on arbitrum' } });
    assert.deepEqual(mock.calls[0].body, { intent: 'send 25 USDC on arbitrum', toAddress: w.address });
    const ex = mock.calls[1];
    assert.match(ex.headers['x-idempotency-key'], new RegExp('^mcp-' + w.address.slice(2, 10) + '-\\d+$'));
    assert.equal(ex.body.fromChain, 8453);
    assert.equal(ex.body.mode, 'permit2');
    assert.equal(ex.body.permit2.owner, w.address);
    assert.equal(ethers.verifyTypedData(domain, P2_TYPES, value, ex.body.permit2.signature), w.address);
    const out = parse(res);
    assert.deepEqual(out.executed, { id: 'rt_9' });
    assert.equal(out.planned.rail, 'r1');
  });

  test('robyn_agent_execute returns refusals and sandbox completions without signing', async () => {
    const client = await connect({ svc: SVC, key: ethers.Wallet.createRandom().privateKey });
    for (const plan of [{ errorCode: 'INSUFFICIENT_ALLOWANCE' }, { status: 'done', sandbox: true }, { status: 'quoted' }]) {
      mock = mockFetch(router(SVC, { 'POST /api/agent/do': plan }));
      const res = await client.callTool({ name: 'robyn_agent_execute', arguments: { intent: 'x' } });
      assert.equal(mock.calls.length, 1, 'no submit for ' + JSON.stringify(plan));
      const out = parse(res);
      assert.deepEqual(plan.status === 'quoted' ? out.plan : out, plan);
      mock.restore(); mock = null;
    }
  });

  test('robyn_yield_spend signs a RobynNCAccount Spend that recovers to the key', async () => {
    const w = ethers.Wallet.createRandom();
    mock = mockFetch(router(SVC, { 'POST /api/ncaccount/spend': { ok: true } }));
    const client = await connect({ svc: SVC, key: w.privateKey });
    await client.callTool({ name: 'robyn_yield_spend', arguments: { srcChain: '8453', amount: '5000000', toChain: 42161 } });
    const { intent, signature, live } = mock.calls[0].body;
    assert.equal(live, true);
    assert.equal(intent.agent, w.address);
    assert.equal(intent.srcChain, 8453);
    assert.equal(intent.toChain, 42161);
    assert.equal(intent.toAddress, w.address);
    const types = { Spend: [{ name: 'agent', type: 'address' }, { name: 'srcChain', type: 'uint256' }, { name: 'amount', type: 'uint256' }, { name: 'toChain', type: 'uint256' }, { name: 'toAddress', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
    assert.equal(ethers.verifyTypedData({ name: 'RobynNCAccount', version: '1', chainId: 8453 }, types, intent, signature), w.address);
  });
});
