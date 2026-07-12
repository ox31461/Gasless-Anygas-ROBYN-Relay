// Robyn Agent Kit - the one-import way for an AI agent (or any automated system) to operate
// on Robyn Chain, and every EVM chain Robyn deploys to, with ZERO gas management: no native
// token, no per-chain balances, no refills. The agent holds a verified asset (WETH/USDG/...)
// and transacts by signing intents; Robyn's relayer fronts gas and is repaid from the asset.
// Built on Gasless Pay v1/v2/v3 + the Robyn Router (cross-chain). ethers v6. MIT.
//
//   import { RobynAgent } from './robyn-agent-kit.js';
//   const agent = new RobynAgent({ signer, svc: 'https://your-robyn/svc' });
//   await agent.pay({ token: USDG, to: merchant, amount: 25_000000n });          // gasless transfer
//   await agent.payAny({ token: ANY, to, amount, verifiedAsset: USDG });          // pay in ANY verified-swappable token
//   await agent.buy({ token: USDG, amount, target: market, calldata });           // gasless purchase via an allowlisted venue
//   await agent.route({ fromChain, fromToken, toChain, toToken, amount });         // quote a cross-chain route
//   await agent.crossChain({ fromChain, fromToken, amount, toChain, toToken });    // MOVE value across chains, gasless, one signature
//
// The agent's signer needs NO native balance - it only signs. Everything else is handled.

import { ethers } from 'ethers';

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const PAY_TYPES = { Pay: [
  { name: 'user', type: 'address' }, { name: 'token', type: 'address' }, { name: 'to', type: 'address' },
  { name: 'amount', type: 'uint256' }, { name: 'maxFee', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ]};
const CALL_TYPES = { Call: [
  { name: 'user', type: 'address' }, { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' },
  { name: 'target', type: 'address' }, { name: 'dataHash', type: 'bytes32' }, { name: 'maxFee', type: 'uint256' },
  { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ]};
const PAYANY_TYPES = { PayAny: [
  { name: 'user', type: 'address' }, { name: 'token', type: 'address' }, { name: 'to', type: 'address' },
  { name: 'amount', type: 'uint256' }, { name: 'maxFee', type: 'uint256' }, { name: 'verifiedAsset', type: 'address' },
  { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ]};
const PERMIT_TYPES = { Permit: [
  { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' },
  { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ]};
// Permit2 SignatureTransfer - the user authorizes the relayer (spender) to pull `amount` once.
const PERMIT2_TRANSFER_TYPES = {
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ],
  TokenPermissions: [ { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' } ] };
const strBig = (o) => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
const POST = async (url, b) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(strBig(b)) }); return r.json(); };

export class RobynAgent {
  constructor({ signer, svc, permitVersion = '1' }) { this.signer = signer; this.svc = svc.replace(/\/$/, ''); this.permitVersion = permitVersion; this._info = null; this._route = null; }

  async chains() { return (await this.info()).gaslessChains || {}; }
  async info() { if (!this._info) this._info = await (await fetch(`${this.svc}/api/gasless/info`)).json(); return this._info; }
  async _user() { return this.signer.getAddress(); }
  _nonce() { return BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)); }
  _deadline(secs = 3600) { return BigInt(Math.floor(Date.now() / 1000) + secs); }

  // EIP-2612 permit authorizing the router to pull `amount` (truly gasless first tx)
  async _permitAuth(token, router, amount, deadline) {
    const provider = this.signer.provider; const user = await this._user();
    const erc = new ethers.Contract(token, ['function name() view returns (string)', 'function nonces(address) view returns (uint256)'], provider);
    const [name, pNonce] = await Promise.all([erc.name(), erc.nonces(user)]);
    const sig = ethers.Signature.from(await this.signer.signTypedData(
      { name, version: this.permitVersion, chainId: (await this.info()).chainId, verifyingContract: token }, PERMIT_TYPES,
      { owner: user, spender: router, value: amount, nonce: pNonce, deadline }));
    return { mode: 1, nonce: 0n, deadline, sig: '0x', permitValue: amount, v: sig.v, r: sig.r, s: sig.s };
  }
  _domain(router, name, chainId) { return { name, version: '1', chainId, verifyingContract: router }; }

  // Gasless transfer/payment (v1). token must be a verified fee token (WETH/USDG).
  async pay({ token, to, amount, route = 'direct' }) {
    amount = BigInt(amount); const info = await this.info(); const router = info.router, chainId = info.chainId; const user = await this._user();
    const q = await POST(`${this.svc}/api/gasless/quote`, { token, kind: 'pay' });
    const maxFee = BigInt(q.suggestedMaxFee); const nonce = this._nonce(); const deadline = this._deadline();
    const intent = { user, token, to, amount, maxFee, nonce, deadline };
    const userSig = await this.signer.signTypedData(this._domain(router, 'RobynGaslessRouter', chainId), PAY_TYPES, intent);
    const auth = await this._permitAuth(token, router, amount, deadline);
    return POST(`${this.svc}/api/gasless/submit`, { kind: 'pay', intent, userSig, auth, route });
  }

  // Gasless purchase through an allowlisted venue (v1 call). embed your own minOut in calldata.
  async buy({ token, amount, target, calldata, route = 'direct' }) {
    amount = BigInt(amount); const info = await this.info(); const router = info.router, chainId = info.chainId; const user = await this._user();
    const q = await POST(`${this.svc}/api/gasless/quote`, { token, kind: 'call' });
    const maxFee = BigInt(q.suggestedMaxFee); const nonce = this._nonce(); const deadline = this._deadline();
    const dataHash = ethers.keccak256(calldata);
    const userSig = await this.signer.signTypedData(this._domain(router, 'RobynGaslessRouter', chainId), CALL_TYPES,
      { user, token, amount, target, dataHash, maxFee, nonce, deadline });
    const auth = await this._permitAuth(token, router, amount, deadline);
    const intent = { user, token, amount, target, callData: calldata, maxFee, nonce, deadline };
    return POST(`${this.svc}/api/gasless/submit`, { kind: 'call', intent, userSig, auth, route });
  }

  // Pay in ANY verified-swappable token (v3). The fee is atomically converted to `verifiedAsset`.
  async payAny({ token, to, amount, verifiedAsset, route = 'direct' }) {
    amount = BigInt(amount); const info = await this.info(); const user = await this._user();
    const chainId = Number((await this.signer.provider.getNetwork()).chainId);
    const entry = (info.gaslessChains || {})[String(chainId)];
    const router = (entry && entry.address) || (chainId === info.chainId ? (info.anyGasRouter || info.router) : null);
    if (!router) throw new Error('Robyn gasless: no anyGasRouter on chain ' + chainId + ' (see info.gaslessChains)');
    const q = await POST(`${this.svc}/api/gasless/quote`, { token: verifiedAsset, kind: 'pay' });
    const maxFee = BigInt(q.suggestedMaxFee); const nonce = this._nonce(); const deadline = this._deadline();
    const intent = { user, token, to, amount, maxFee, verifiedAsset, nonce, deadline };
    const userSig = await this.signer.signTypedData(this._domain(router, 'RobynAnyGasRouter', chainId), PAYANY_TYPES, intent);
    const auth = await this._permitAuth(token, router, amount, deadline);
    return POST(`${this.svc}/api/gasless/submit`, { kind: 'payAny', intent, userSig, auth, route, chainId });
  }

  // ===================================================================
  // Robyn Router - the cross-chain intent layer. Move value across any two
  // Robyn gasless chains with ONE signature and ZERO gas on either side.
  // ===================================================================

  get permit2() { return PERMIT2_ADDRESS; }

  // The route graph + the relayer/Permit2 spender the SDK signs for.
  async routeInfo() { if (!this._route) this._route = await (await fetch(`${this.svc}/api/route/chains`)).json(); return this._route; }

  // Quote the best cross-chain route (read-only). amount is in fromToken base units.
  //   const q = await agent.route({ fromChain: 8453, fromToken: USDC_BASE, toChain: 42161, toToken: USDC_ARB, amount: 25_000000n });
  async route({ fromChain, fromToken, toChain, toToken, amount, toAddress, slippage }) {
    return POST(`${this.svc}/api/route/quote`, { fromChain, fromToken, toChain, toToken, amount, toAddress, slippage });
  }

  // Track an in-flight route to DONE.
  async routeStatus(id) { return (await fetch(`${this.svc}/api/route/status?id=${encodeURIComponent(id)}`)).json(); }

  // Permit2 SignatureTransfer - one off-chain signature authorizing the relayer to pull `amount`.
  async _permit2Sig({ token, amount, spender, nonce, deadline, chainId }) {
    return this.signer.signTypedData(
      { name: 'Permit2', chainId: Number(chainId), verifyingContract: PERMIT2_ADDRESS },
      PERMIT2_TRANSFER_TYPES, { permitted: { token, amount }, spender, nonce, deadline });
  }

  // MOVE value across chains, gasless, one signature. The agent signs a single Permit2 transfer;
  // Robyn's relayer pulls the token on the source chain, fronts all gas on BOTH chains, and
  // bridges to the destination (best route via LI.FI aggregation). Returns { id, srcTx, track }.
  //
  // One-time setup per (token, chain): the agent must have approved Permit2 to spend the token:
  //   await token.approve(agent.permit2, ethers.MaxUint256)  // standard, one-time Permit2 approval
  // After that, every cross-chain move is a single gasless signature - no native token ever.
  async crossChain({ fromChain, fromToken, amount, toChain, toToken, toAddress }) {
    amount = BigInt(amount);
    const user = await this._user();
    const ri = await this.routeInfo();
    const spender = ri.relayer;
    if (!spender) throw new Error('Robyn Router: relayer/spender unavailable (is /api/route/chains up?)');
    const nonce = this._nonce();
    const deadline = this._deadline();
    const signature = await this._permit2Sig({ token: fromToken, amount, spender, nonce, deadline, chainId: Number(fromChain) });
    return POST(`${this.svc}/api/route/execute`, {
      fromChain, fromToken, amount, toChain, toToken, toAddress: toAddress || user, mode: 'permit2',
      permit2: { owner: user, permitted: { token: fromToken, amount }, nonce, deadline, signature },
    });
  }
}
