import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { robyn, TOOLS, PERMIT2 } from '../core.mjs';
import { robynOpenAITools, robynAnthropicTools, robynDispatcher } from '../schemas.mjs';
import { mockFetch, router, json } from './helpers.mjs';

const SVC = 'https://svc.test/svc';
const RELAYER = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const P2_TYPES = {
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ],
  TokenPermissions: [ { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' } ] };

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });

describe('core robyn()', () => {
  test('defaults to the public gateway, strips trailing slash, reports signer', () => {
    assert.equal(robyn()._svc, 'https://api.anygas.xyz/svc');
    assert.equal(robyn({ svc: SVC + '/' })._svc, SVC);
    assert.equal(robyn({ svc: SVC })._hasSigner, false);
    assert.equal(robyn({ svc: SVC, signer: ethers.Wallet.createRandom() })._hasSigner, true);
    assert.equal(PERMIT2, '0x000000000022D473030F116dDEE9F6B43aC78BA3');
  });

  test('mesh / quote / status hit the right endpoints with the right shape', async () => {
    mock = mockFetch(() => ({ ok: true }));
    const r = robyn({ svc: SVC });
    await r.mesh();
    const q = { fromChain: 8453, fromToken: TOKEN, toChain: 'stellar', toToken: 'USDC', amount: '25000000' };
    await r.quote(q);
    await r.status('rt 1');
    assert.equal(mock.calls[0].url, SVC + '/api/route/chains');
    assert.equal(mock.calls[0].method, 'GET');
    assert.equal(mock.calls[1].url, SVC + '/api/route/quote');
    assert.equal(mock.calls[1].method, 'POST');
    assert.equal(mock.calls[1].headers['content-type'], 'application/json');
    assert.deepEqual(mock.calls[1].body, q);
    assert.equal(mock.calls[2].url, SVC + '/api/route/status?id=rt%201');
  });

  test('typed API errors are returned as data; non-JSON raises a clear error', async () => {
    mock = mockFetch(() => json({ errorCode: 'NO_ROUTE' }, 422));
    assert.deepEqual(await robyn({ svc: SVC }).mesh(), { errorCode: 'NO_ROUTE' });
    mock.restore();
    mock = mockFetch(() => new Response('upstream timeout', { status: 504 }));
    await assert.rejects(robyn({ svc: SVC }).mesh(), /non-JSON \(HTTP 504\)/);
  });

  test('crossChain requires a signer', async () => {
    await assert.rejects(robyn({ svc: SVC }).crossChain({}), /signer is required/);
  });

  test('crossChain throws when the relayer is unavailable', async () => {
    mock = mockFetch(router(SVC, { 'GET /api/route/chains': {} }));
    await assert.rejects(robyn({ svc: SVC, signer: ethers.Wallet.createRandom() }).crossChain({ fromChain: 1, fromToken: TOKEN, amount: '1', toChain: 2, toToken: 'USDC' }), /relayer\/spender unavailable/);
  });

  test('crossChain signs a Permit2 transfer that recovers to the signer, honouring ttlSecs', async () => {
    const w = ethers.Wallet.createRandom();
    mock = mockFetch(router(SVC, {
      'GET /api/route/chains': { relayer: RELAYER },
      'POST /api/route/execute': { id: 'rt_1' },
    }));
    const before = Math.floor(Date.now() / 1000);
    const res = await robyn({ svc: SVC, signer: w }).crossChain({ fromChain: '8453', fromToken: TOKEN, amount: 25_000000n, toChain: 42161, toToken: 'USDC', toAddress: RELAYER, ttlSecs: 60 });
    assert.deepEqual(res, { id: 'rt_1' });
    const b = mock.calls[1].body;
    assert.equal(b.mode, 'permit2');
    assert.equal(b.fromChain, '8453');
    assert.equal(b.amount, '25000000');
    assert.equal(b.toAddress, RELAYER);
    assert.equal(b.permit2.owner, w.address);
    const dl = Number(b.permit2.deadline);
    assert.ok(dl >= before + 60 && dl <= before + 62, 'ttlSecs applied');
    assert.equal(ethers.verifyTypedData({ name: 'Permit2', chainId: 8453, verifyingContract: PERMIT2 }, P2_TYPES,
      { permitted: b.permit2.permitted, spender: RELAYER, nonce: b.permit2.nonce, deadline: b.permit2.deadline }, b.permit2.signature), w.address);
  });
});

describe('schemas', () => {
  test('OpenAI and Anthropic formats carry the canonical metadata', () => {
    const oa = robynOpenAITools();
    const an = robynAnthropicTools();
    assert.deepEqual(oa.map((t) => t.function.name), Object.keys(TOOLS));
    assert.deepEqual(an.map((t) => t.name), Object.keys(TOOLS));
    for (const t of oa) {
      assert.equal(t.type, 'function');
      assert.equal(t.function.description, TOOLS[t.function.name].description);
      assert.equal(t.function.parameters.type, 'object');
    }
    for (const t of an) assert.equal(t.description, TOOLS[t.name].description);
  });

  test('includeExecute:false drops robyn_cross_chain', () => {
    assert.ok(!robynOpenAITools({ includeExecute: false }).some((t) => t.function.name === 'robyn_cross_chain'));
    assert.ok(!robynAnthropicTools({ includeExecute: false }).some((t) => t.name === 'robyn_cross_chain'));
  });

  test('every documented param is in the schema; required = non-optional params', () => {
    for (const t of robynAnthropicTools()) {
      const params = TOOLS[t.name].params;
      assert.deepEqual(Object.keys(t.input_schema.properties).sort(), Object.keys(params).sort(), t.name);
      const required = Object.keys(params).filter((k) => !params[k].startsWith('(optional)'));
      assert.deepEqual([...t.input_schema.required].sort(), required.sort(), t.name);
    }
  });

  test('dispatcher routes each tool to the client and rejects unknown names', async () => {
    mock = mockFetch(() => ({ ok: true }));
    const run = robynDispatcher({ svc: SVC });
    await run('robyn_mesh');
    await run('robyn_quote', { fromChain: 1, fromToken: TOKEN, toChain: 2, toToken: 'USDC', amount: '1' });
    await run('robyn_route_status', { id: 'x' });
    assert.deepEqual(mock.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), [
      'GET /svc/api/route/chains', 'POST /svc/api/route/quote', 'GET /svc/api/route/status']);
    await assert.rejects(run('robyn_cross_chain', {}), /signer is required/);
    await assert.rejects(run('nope'), /unknown Robyn tool: nope/);
  });
});
