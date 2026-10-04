import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { RobynAgent } from '../index.js';
import { mockFetch, router, json } from './helpers.mjs';

const SVC = 'https://svc.test/svc';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const HOME_CHAIN = 777;            // the service's own chain (info.chainId)
const ROUTER = '0x2222222222222222222222222222222222222222';
const ANY_ROUTER_BASE = '0x3333333333333333333333333333333333333333';
const RELAYER = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDG = '0x4444444444444444444444444444444444444444';
const MERCHANT = '0x5555555555555555555555555555555555555555';
const INFO = { router: ROUTER, chainId: HOME_CHAIN, anyGasRouter: ROUTER, gaslessChains: { 8453: { address: ANY_ROUTER_BASE } } };

const PERMIT_TYPES = { Permit: [
  { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' },
  { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ]};
const P2_TYPES = {
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ],
  TokenPermissions: [ { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' } ] };

// Minimal offline provider: answers ERC-20 name()/nonces() and getNetwork().
const erc20 = new ethers.Interface(['function name() view returns (string)', 'function nonces(address) view returns (uint256)']);
function fakeProvider({ chainId = HOME_CHAIN, tokenName = 'Test USD', permitNonce = 7n } = {}) {
  return {
    async getNetwork() { return { chainId: BigInt(chainId) }; },
    async resolveName(n) { return n; },
    async call(tx) {
      const sel = tx.data.slice(0, 10);
      if (sel === erc20.getFunction('name').selector) return erc20.encodeFunctionResult('name', [tokenName]);
      if (sel === erc20.getFunction('nonces').selector) return erc20.encodeFunctionResult('nonces', [permitNonce]);
      throw new Error('unexpected call ' + sel);
    },
  };
}
const wallet = (opts) => ethers.Wallet.createRandom().connect(fakeProvider(opts));

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });

describe('construction & reads', () => {
  test('defaults svc to the public gateway and strips a trailing slash', () => {
    assert.equal(new RobynAgent({}).svc, 'https://api.anygas.xyz/svc');
    assert.equal(new RobynAgent({ svc: SVC + '/' }).svc, SVC);
    assert.equal(new RobynAgent({}).permit2, PERMIT2);
  });

  test('info() is fetched once and cached; chains() reads gaslessChains', async () => {
    mock = mockFetch(router(SVC, { 'GET /api/gasless/info': INFO }));
    const a = new RobynAgent({ svc: SVC });
    assert.deepEqual(await a.chains(), INFO.gaslessChains);
    assert.deepEqual(await a.info(), INFO);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, SVC + '/api/gasless/info');
  });

  test('route() POSTs fromChain/toChain/amount (bigint serialised as string)', async () => {
    mock = mockFetch(router(SVC, { 'POST /api/route/quote': { estOut: '1' } }));
    const a = new RobynAgent({ svc: SVC });
    const q = await a.route({ fromChain: 8453, fromToken: TOKEN, toChain: 42161, toToken: 'USDC', amount: 25_000000n, slippage: 0.005 });
    assert.deepEqual(q, { estOut: '1' });
    const c = mock.calls[0];
    assert.equal(c.method, 'POST');
    assert.equal(c.headers['content-type'], 'application/json');
    assert.deepEqual(c.body, { fromChain: 8453, fromToken: TOKEN, toChain: 42161, toToken: 'USDC', amount: '25000000', slippage: 0.005 });
  });

  test('routeStatus() URL-encodes the id; errors() hits /api/errors', async () => {
    mock = mockFetch(() => ({ ok: true }));
    const a = new RobynAgent({ svc: SVC });
    await a.routeStatus('rt_1/2 3');
    await a.errors();
    assert.equal(mock.calls[0].url, SVC + '/api/route/status?id=rt_1%2F2%203');
    assert.equal(mock.calls[1].url, SVC + '/api/errors');
  });

  test('agentDo() sends only the fields given, sandbox only when truthy', async () => {
    mock = mockFetch(router(SVC, { 'POST /api/agent/do': { status: 'quoted' } }));
    const a = new RobynAgent({ svc: SVC });
    await a.agentDo({ intent: 'send 25 USDC on arbitrum', fromChain: 8453, amount: 25_000000n, sandbox: false });
    await a.agentDo({ token: 'USDC', amountHuman: 25, toChain: 42161, toAddress: MERCHANT, sandbox: true });
    await a.agentDo();
    assert.deepEqual(mock.calls[0].body, { intent: 'send 25 USDC on arbitrum', fromChain: 8453, amount: '25000000' });
    assert.deepEqual(mock.calls[1].body, { token: 'USDC', amountHuman: 25, toChain: 42161, toAddress: MERCHANT, sandbox: true });
    assert.deepEqual(mock.calls[2].body, {});
  });

  test('typed API errors (JSON, non-2xx) are returned as data', async () => {
    mock = mockFetch(() => json({ errorCode: 'NO_ROUTE', retryable: false }, 422));
    const r = await new RobynAgent({ svc: SVC }).route({ fromChain: 1, fromToken: TOKEN, toChain: 2, toToken: 'USDC', amount: 1n });
    assert.equal(r.errorCode, 'NO_ROUTE');
  });

  test('a non-JSON response raises a clear error', async () => {
    mock = mockFetch(() => new Response('<html>Bad Gateway</html>', { status: 502 }));
    await assert.rejects(new RobynAgent({ svc: SVC }).errors(), /non-JSON \(HTTP 502\)/);
  });
});

describe('gasless signing paths', () => {
  test('pay() signs a Pay intent + EIP-2612 permit that recover to the signer', async () => {
    const w = wallet();
    mock = mockFetch(router(SVC, {
      'GET /api/gasless/info': INFO,
      'POST /api/gasless/quote': { suggestedMaxFee: '1000' },
      'POST /api/gasless/submit': { txHash: '0xabc' },
    }));
    const res = await new RobynAgent({ signer: w, svc: SVC }).pay({ token: USDG, to: MERCHANT, amount: '25000000' });
    assert.deepEqual(res, { txHash: '0xabc' });
    assert.deepEqual(mock.calls[1].body, { token: USDG, kind: 'pay' });
    const { kind, intent, userSig, auth, route } = mock.calls[2].body;
    assert.equal(kind, 'pay');
    assert.equal(route, 'direct');
    assert.equal(intent.user, w.address);
    assert.equal(intent.amount, '25000000');
    assert.equal(intent.maxFee, '1000');
    const PAY_TYPES = { Pay: [
      { name: 'user', type: 'address' }, { name: 'token', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }, { name: 'maxFee', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ]};
    assert.equal(ethers.verifyTypedData({ name: 'RobynGaslessRouter', version: '1', chainId: HOME_CHAIN, verifyingContract: ROUTER }, PAY_TYPES, intent, userSig), w.address);
    // permit: owner=user, spender=router, value=amount, nonce from token.nonces()
    assert.equal(auth.mode, 1);
    assert.equal(auth.permitValue, '25000000');
    const permitSig = ethers.Signature.from({ v: auth.v, r: auth.r, s: auth.s }).serialized;
    assert.equal(ethers.verifyTypedData({ name: 'Test USD', version: '1', chainId: HOME_CHAIN, verifyingContract: USDG }, PERMIT_TYPES,
      { owner: w.address, spender: ROUTER, value: 25000000n, nonce: 7n, deadline: BigInt(auth.deadline) }, permitSig), w.address);
  });

  test('buy() binds keccak256(calldata) into the Call signature', async () => {
    const w = wallet();
    mock = mockFetch(router(SVC, {
      'GET /api/gasless/info': INFO,
      'POST /api/gasless/quote': { suggestedMaxFee: '5' },
      'POST /api/gasless/submit': { ok: true },
    }));
    const calldata = '0xdeadbeef';
    await new RobynAgent({ signer: w, svc: SVC }).buy({ token: USDG, amount: 10n, target: MERCHANT, calldata });
    assert.deepEqual(mock.calls[1].body, { token: USDG, kind: 'call' });
    const { kind, intent, userSig } = mock.calls[2].body;
    assert.equal(kind, 'call');
    assert.equal(intent.callData, calldata);
    const CALL_TYPES = { Call: [
      { name: 'user', type: 'address' }, { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' },
      { name: 'target', type: 'address' }, { name: 'dataHash', type: 'bytes32' }, { name: 'maxFee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ]};
    const signed = { ...intent, dataHash: ethers.keccak256(calldata) };
    assert.equal(ethers.verifyTypedData({ name: 'RobynGaslessRouter', version: '1', chainId: HOME_CHAIN, verifyingContract: ROUTER }, CALL_TYPES, signed, userSig), w.address);
  });

  test('payAny() on a non-home chain signs intent AND permit for that chain', async () => {
    const w = wallet({ chainId: 8453 });
    mock = mockFetch(router(SVC, {
      'GET /api/gasless/info': INFO,
      'POST /api/gasless/quote': { suggestedMaxFee: '9' },
      'POST /api/gasless/submit': { ok: true },
    }));
    await new RobynAgent({ signer: w, svc: SVC }).payAny({ token: TOKEN, to: MERCHANT, amount: 3n, verifiedAsset: USDG });
    assert.deepEqual(mock.calls[1].body, { token: USDG, kind: 'pay' });
    const { kind, intent, userSig, auth, chainId } = mock.calls[2].body;
    assert.equal(kind, 'payAny');
    assert.equal(chainId, 8453);
    const PAYANY_TYPES = { PayAny: [
      { name: 'user', type: 'address' }, { name: 'token', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }, { name: 'maxFee', type: 'uint256' }, { name: 'verifiedAsset', type: 'address' },
      { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ]};
    assert.equal(ethers.verifyTypedData({ name: 'RobynAnyGasRouter', version: '1', chainId: 8453, verifyingContract: ANY_ROUTER_BASE }, PAYANY_TYPES, intent, userSig), w.address);
    const permitSig = ethers.Signature.from({ v: auth.v, r: auth.r, s: auth.s }).serialized;
    assert.equal(ethers.verifyTypedData({ name: 'Test USD', version: '1', chainId: 8453, verifyingContract: TOKEN }, PERMIT_TYPES,
      { owner: w.address, spender: ANY_ROUTER_BASE, value: 3n, nonce: 7n, deadline: BigInt(auth.deadline) }, permitSig), w.address,
      'EIP-2612 permit must be signed for the chain the token lives on');
  });

  test('payAny() refuses a chain with no anyGasRouter', async () => {
    mock = mockFetch(router(SVC, { 'GET /api/gasless/info': INFO }));
    await assert.rejects(new RobynAgent({ signer: wallet({ chainId: 10 }), svc: SVC }).payAny({ token: TOKEN, to: MERCHANT, amount: 1n, verifiedAsset: USDG }), /no anyGasRouter on chain 10/);
  });
});

describe('cross-chain (Permit2)', () => {
  test('crossChain() signs a Permit2 transfer for the source chain that recovers to the signer', async () => {
    const w = ethers.Wallet.createRandom();
    mock = mockFetch(router(SVC, {
      'GET /api/route/chains': { relayer: RELAYER },
      'POST /api/route/execute': { id: 'rt_1' },
    }));
    const res = await new RobynAgent({ signer: w, svc: SVC }).crossChain({ fromChain: 8453, fromToken: TOKEN, amount: '25000000', toChain: 'stellar', toToken: 'USDC' });
    assert.deepEqual(res, { id: 'rt_1' });
    const b = mock.calls[1].body;
    assert.equal(b.mode, 'permit2');
    assert.equal(b.toChain, 'stellar');
    assert.equal(b.amount, '25000000');
    assert.equal(b.toAddress, w.address);
    assert.equal(b.permit2.owner, w.address);
    assert.equal(ethers.verifyTypedData({ name: 'Permit2', chainId: 8453, verifyingContract: PERMIT2 }, P2_TYPES,
      { permitted: b.permit2.permitted, spender: RELAYER, nonce: b.permit2.nonce, deadline: b.permit2.deadline }, b.permit2.signature), w.address);
  });

  test('crossChain() throws when the relayer is unavailable; routeInfo is cached', async () => {
    mock = mockFetch(router(SVC, { 'GET /api/route/chains': {} }));
    const a = new RobynAgent({ signer: ethers.Wallet.createRandom(), svc: SVC });
    await assert.rejects(a.crossChain({ fromChain: 1, fromToken: TOKEN, amount: 1n, toChain: 2, toToken: 'USDC' }), /relayer\/spender unavailable/);
    await a.routeInfo();
    assert.equal(mock.calls.length, 1);
  });
});

describe('non-custodial yield account', () => {
  const SPEND_TYPES = { Spend: [{ name: 'agent', type: 'address' }, { name: 'srcChain', type: 'uint256' }, { name: 'amount', type: 'uint256' }, { name: 'toChain', type: 'uint256' }, { name: 'toAddress', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };

  test('yieldAccount() defaults to the signer; yieldQuote() sends base-unit amount', async () => {
    const w = ethers.Wallet.createRandom();
    mock = mockFetch(() => ({ ok: true }));
    const a = new RobynAgent({ signer: w, svc: SVC });
    await a.yieldAccount();
    await a.yieldAccount(MERCHANT);
    await a.yieldQuote({ srcChain: '8453', amount: 5_000000n });
    assert.equal(mock.calls[0].url, SVC + '/api/ncaccount/' + w.address);
    assert.equal(mock.calls[1].url, SVC + '/api/ncaccount/' + MERCHANT);
    assert.deepEqual(mock.calls[2].body, { agent: w.address, srcChain: 8453, amount: '5000000', toChain: 8453, toAddress: w.address });
  });

  test('yieldQuote() works read-only with an explicit agent; signer-only calls fail clearly', async () => {
    mock = mockFetch(() => ({ ok: true }));
    const a = new RobynAgent({ svc: SVC });
    await a.yieldQuote({ srcChain: 8453, amount: 5_000000n, agent: MERCHANT });
    assert.deepEqual(mock.calls[0].body, { agent: MERCHANT, srcChain: 8453, amount: '5000000', toChain: 8453, toAddress: MERCHANT });
    await assert.rejects(a.yieldQuote({ srcChain: 8453, amount: 1n }), /needs a signer/);
  });

  test('yieldSpend() signs a RobynNCAccount Spend that recovers to the signer', async () => {
    const w = ethers.Wallet.createRandom();
    mock = mockFetch(router(SVC, { 'POST /api/ncaccount/spend': { ok: true } }));
    await new RobynAgent({ signer: w, svc: SVC }).yieldSpend({ srcChain: 8453, amount: '5000000', toChain: 42161, toAddress: MERCHANT });
    const { intent, signature, live } = mock.calls[0].body;
    assert.equal(live, true);
    assert.deepEqual({ ...intent, nonce: undefined, deadline: undefined }, { agent: w.address, srcChain: 8453, amount: '5000000', toChain: 42161, toAddress: MERCHANT, nonce: undefined, deadline: undefined });
    assert.equal(ethers.verifyTypedData({ name: 'RobynNCAccount', version: '1', chainId: 8453 }, SPEND_TYPES, intent, signature), w.address);
  });

  test('approveYield() refuses a chain with no position', async () => {
    mock = mockFetch(() => ({ positions: [{ chainId: 8453, aToken: TOKEN }], relayer: RELAYER }));
    await assert.rejects(new RobynAgent({ signer: ethers.Wallet.createRandom(), svc: SVC }).approveYield({ chainId: 10, budget: 1n }), /no yield position on chain 10/);
  });

  test('spend() uses the yield position when it covers the amount', async () => {
    const w = ethers.Wallet.createRandom();
    mock = mockFetch(router(SVC, {
      [`GET /api/ncaccount/${w.address}`]: { positions: [{ chainId: 8453, earningUsd: 10 }] },
      'POST /api/ncaccount/spend': { ok: true },
    }));
    await new RobynAgent({ signer: w, svc: SVC }).spend({ to: MERCHANT, amount: 5_000000n, chain: 42161, srcChain: 8453 });
    const { intent } = mock.calls[1].body;
    assert.equal(intent.srcChain, 8453);
    assert.equal(intent.toChain, 42161);
    assert.equal(intent.toAddress, MERCHANT);
  });

  test('spend() falls back to a Permit2 cross-chain move with the given USDC address', async () => {
    const w = ethers.Wallet.createRandom();
    mock = mockFetch(router(SVC, {
      [`GET /api/ncaccount/${w.address}`]: { positions: [{ chainId: 8453, earningUsd: 1 }] },
      'GET /api/route/chains': { relayer: RELAYER },
      'POST /api/route/execute': { id: 'rt_2' },
    }));
    const res = await new RobynAgent({ signer: w, svc: SVC }).spend({ to: MERCHANT, amount: 5_000000n, chain: 42161, srcChain: 8453, fromToken: TOKEN });
    assert.deepEqual(res, { id: 'rt_2' });
    const b = mock.calls[2].body;
    assert.equal(b.fromToken, TOKEN);
    assert.equal(b.toToken, 'USDC');
    assert.equal(b.toAddress, MERCHANT);
    assert.equal(ethers.verifyTypedData({ name: 'Permit2', chainId: 8453, verifyingContract: PERMIT2 }, P2_TYPES,
      { permitted: { token: TOKEN, amount: '5000000' }, spender: RELAYER, nonce: b.permit2.nonce, deadline: b.permit2.deadline }, b.permit2.signature), w.address);
  });

  test('spend() fallback without a token address fails with a clear message', async () => {
    const w = ethers.Wallet.createRandom();
    mock = mockFetch(router(SVC, {
      [`GET /api/ncaccount/${w.address}`]: { positions: [] },
      'GET /api/route/chains': { relayer: RELAYER },
    }));
    await assert.rejects(new RobynAgent({ signer: w, svc: SVC }).spend({ to: MERCHANT, amount: 1n, chain: 8453 }), /fromToken/);
  });
});
