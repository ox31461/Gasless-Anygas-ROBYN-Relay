// Checks a Permit2 signing request that came back from the Robyn service BEFORE this server signs it.
//
// robyn_agent_do_execute asks the service to plan a move and then signs the EIP-712 payload the service returns. The
// payload is the service's choice, so it is checked here against what a Permit2 transfer for this request must be:
// the canonical Permit2 contract, the chain the move starts on, the token and amount being moved, a relayer that
// matches the one the service advertises (or ROBYN_RELAYER when pinned), a short deadline, and a submit body that
// names the same chain, token, amount and destination. The spend policy (spend-policy.mjs) then runs on those values.
// Pure: no network, no clock unless passed in.
import { SpendPolicyError } from './spend-policy.mjs';

export const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';
export const MAX_DEADLINE_SECS = 7200;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^[0-9]+$/;
const bad = (why) => { throw new SpendPolicyError('refused: the service returned a signing request that does not match this move (' + why + '); nothing was signed', 'payload'); };
const lc = (s) => String(s).toLowerCase();
const uint = (v, why) => { const s = String(v); if (!UINT.test(s)) bad(why); return BigInt(s); };
const chainNum = (v, why) => { let n; try { n = BigInt(String(v).trim()); } catch (e) { bad(why); } if (n <= 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) bad(why); return Number(n); };

/// checkPermit2Request(sr, { spender, request, nowSecs }) -> { chainId, token, amount, toAddress, toChain, toToken }
///   sr       the service's signRequest: { eip712: { domain, value }, submitBody }
///   spender  the relayer this server expects (ROBYN_RELAYER, else the one /api/route/chains advertises)
///   request  the agent's structured fields, when given: { fromChain, token, amount, toChain, toAddress }
/// Throws SpendPolicyError (reason 'payload') on any mismatch.
export function checkPermit2Request(sr, { spender, request = {}, nowSecs = Math.floor(Date.now() / 1000) } = {}) {
  if (!sr || typeof sr !== 'object' || !sr.eip712 || typeof sr.eip712 !== 'object') bad('no EIP-712 payload');
  const { domain, value } = sr.eip712;
  const body = sr.submitBody;
  if (!domain || !value || !body || typeof body !== 'object') bad('incomplete payload');
  // domain: the canonical Permit2 contract on the chain the move starts on, nothing else
  const keys = Object.keys(domain).sort().join(',');
  if (keys !== 'chainId,name,verifyingContract') bad('unexpected domain fields');
  if (domain.name !== 'Permit2') bad('domain is not Permit2');
  if (!ADDR.test(String(domain.verifyingContract)) || lc(domain.verifyingContract) !== PERMIT2) bad('verifyingContract is not Permit2');
  const chainId = chainNum(domain.chainId, 'domain chain id');
  // value: the token, amount and spender being permitted
  if (!value.permitted || typeof value.permitted !== 'object') bad('no permitted token');
  const token = String(value.permitted.token);
  if (!ADDR.test(token)) bad('permitted token is not an address');
  const amount = uint(value.permitted.amount, 'permitted amount');
  if (amount <= 0n) bad('permitted amount');
  if (!ADDR.test(String(spender || '')) || !ADDR.test(String(value.spender)) || lc(value.spender) !== lc(spender)) bad('spender is not the expected relayer');
  uint(value.nonce, 'nonce');
  const deadline = uint(value.deadline, 'deadline');
  if (deadline <= BigInt(nowSecs) || deadline > BigInt(nowSecs + MAX_DEADLINE_SECS)) bad('deadline');
  // submit body: what the relayer executes must be what is signed
  if (chainNum(body.fromChain, 'submit chain') !== chainId) bad('submit chain differs from the signed chain');
  if (!ADDR.test(String(body.fromToken)) || lc(body.fromToken) !== lc(token)) bad('submit token differs from the signed token');
  if (uint(body.amount, 'submit amount') !== amount) bad('submit amount differs from the signed amount');
  if (body.toAddress === undefined || body.toAddress === null || String(body.toAddress) === '') bad('submit body names no destination');
  // the agent's own structured fields, when it gave them, must survive the plan unchanged
  if (request.fromChain !== undefined && chainNum(request.fromChain, 'requested chain') !== chainId) bad('chain differs from the request');
  if (request.token !== undefined && ADDR.test(String(request.token).trim()) && lc(String(request.token).trim()) !== lc(token)) bad('token differs from the request');
  if (request.amount !== undefined && uint(String(request.amount).trim(), 'requested amount') !== amount) bad('amount differs from the request');
  if (request.toAddress !== undefined && lc(request.toAddress) !== lc(body.toAddress)) bad('destination differs from the request');
  if (request.toChain !== undefined && chainNum(request.toChain, 'requested destination chain') !== chainNum(body.toChain, 'submit destination chain')) bad('destination chain differs from the request');
  return { chainId, token, amount: amount.toString(), toAddress: String(body.toAddress), toChain: body.toChain, toToken: body.toToken };
}
