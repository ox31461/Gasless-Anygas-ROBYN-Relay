// robyn-adapters/core.mjs — the shared Robyn client used by every framework adapter.
//
// One place for: read (mesh / quote / status) and execute (crossChain via a single Permit2
// signature). Adapters below (AI SDK, LangChain, AgentKit, raw schemas) are thin wrappers over
// this. The signer only ever SIGNS — Robyn's relayer submits and fronts all gas.
import { ethers } from 'ethers';

export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const P2_TYPES = {
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ],
  TokenPermissions: [ { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' } ] };
const strBig = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));

// robyn({ svc, signer? }) -> { mesh, quote, status, crossChain }
// - svc:    Robyn service base URL, e.g. "https://<gateway>/svc"
// - signer: an ethers v6 Signer/Wallet (only needed for crossChain). It signs; it never sends.
export function robyn({ svc, signer } = {}) {
  if (!svc) throw new Error('robyn: svc (service base URL) required');
  svc = svc.replace(/\/$/, '');
  const GET = async (p) => (await fetch(svc + p)).json();
  const POST = async (p, b) => (await fetch(svc + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(strBig(b)) })).json();

  async function crossChain(a) {
    if (!signer) throw new Error('robyn.crossChain: a signer is required');
    const owner = await signer.getAddress();
    const ri = await GET('/api/route/chains');
    const spender = ri.relayer;
    if (!spender) throw new Error('robyn: relayer/spender unavailable from the service');
    const amount = BigInt(a.amount);
    const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + (a.ttlSecs || 3600));
    const signature = await signer.signTypedData(
      { name: 'Permit2', chainId: Number(a.fromChain), verifyingContract: PERMIT2 },
      P2_TYPES, { permitted: { token: a.fromToken, amount }, spender, nonce, deadline });
    return POST('/api/route/execute', {
      fromChain: a.fromChain, fromToken: a.fromToken, amount: a.amount,
      toChain: a.toChain, toToken: a.toToken, toAddress: a.toAddress || owner, mode: 'permit2',
      permit2: { owner, permitted: { token: a.fromToken, amount }, nonce, deadline, signature },
    });
  }

  return {
    mesh: () => GET('/api/route/chains'),
    quote: (a) => POST('/api/route/quote', a),
    status: (id) => GET('/api/route/status?id=' + encodeURIComponent(id)),
    crossChain,
    _svc: svc, _hasSigner: !!signer,
  };
}

// Canonical tool metadata — reused by every adapter so descriptions/params stay identical.
export const TOOLS = {
  robyn_mesh: {
    description: 'List the Robyn gasless chains and the cross-chain route graph (22 EVM nodes + Stellar) plus the relayer/Permit2 addresses. No credentials needed.',
    params: {},
  },
  robyn_quote: {
    description: 'Quote the best gasless route to move a token between two Robyn chains. Returns estimated output, the bridge used, duration, and the Robyn fee. Read-only.',
    params: {
      fromChain: 'source chain id (number) or "stellar"',
      fromToken: 'token address on the source chain (0x0000…0000 for native)',
      toChain: 'destination chain id (number) or "stellar"',
      toToken: 'token address / symbol on the destination',
      amount: 'amount in fromToken base units, as a string (e.g. "25000000" = 25 USDC)',
      toAddress: '(optional) recipient on the destination chain',
    },
  },
  robyn_route_status: {
    description: 'Track an in-flight cross-chain route by id (BRIDGING -> DONE), with the destination tx once delivered.',
    params: { id: 'the route id returned by robyn_cross_chain' },
  },
  robyn_cross_chain: {
    description: 'Move value across chains GASLESSLY with one signature. Signs a single Permit2 intent; Robyn fronts all native gas on both chains + the bridge, reimbursed from the token. The agent pays no gas. Requires a signer + a one-time Permit2 approval of the token. Returns a route id — track with robyn_route_status.',
    params: {
      fromChain: 'source chain id or "stellar"',
      fromToken: 'token address on the source chain',
      amount: 'amount in fromToken base units, as a string',
      toChain: 'destination chain id or "stellar"',
      toToken: 'token address / symbol on the destination',
      toAddress: '(optional) recipient (defaults to the signer)',
    },
  },
};
