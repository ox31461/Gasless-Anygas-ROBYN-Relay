// Spend policy for the local MCP server's signing tools (robyn_cross_chain, robyn_agent_execute, robyn_yield_spend).
//
// An agent's instructions can come from untrusted text, so every spend is checked BEFORE anything is signed:
//
//   * destination: toAddress must be the signer itself unless it is listed in ROBYN_ALLOWED_TO (comma-separated).
//     Moving value to yourself across chains is the tools' purpose; paying a third party needs the operator's word.
//   * destination token: a toToken given as an address must be listed in ROBYN_ALLOWED_TOKENS, a symbol must be
//     listed in ROBYN_ALLOWED_SYMBOLS (default USDC, USDC.e, EURC), and any other form is refused.
//   * destination chain: toChain must be an EVM chain id; Stellar recipients cannot be allowlisted yet.
//   * ROBYN_RELAYER: the Permit2 spender must equal this address (index.mjs requires it whenever a signer key is set).
//   * ROBYN_MAX_PER_CALL / ROBYN_MAX_PER_DAY: caps in the token's base units, per (chain, token), when set. The daily
//     total is kept in a small JSON ledger (ROBYN_SPEND_LEDGER, default ~/.anygas-mcp/spend.json), written atomically
//     (temp file + rename) and counted BEFORE signing, so a signature that leaves the process always counts.
//
// One server process per ledger file: two processes sharing one can each spend up to the daily cap.
// Pure apart from the injected fs/now, so tests run it against a scratch ledger and a fake clock.
import nodeFs from 'node:fs';
import nodePath from 'node:path';
import os from 'node:os';

export class SpendPolicyError extends Error {
  constructor(message, reason) { super(message); this.name = 'SpendPolicyError'; this.errorCode = 'SPEND_POLICY'; this.reason = reason; }
}

const UINT = /^[0-9]+$/;
function capOf(raw, name) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  if (!UINT.test(s)) throw new Error(name + ' must be a whole number of token base units');
  return BigInt(s);
}

const ADDR = /^0x[0-9a-f]{40}$/;
const SYMBOL = /^[A-Za-z][A-Za-z0-9.]{0,11}$/;
function symbolList(raw) {
  const out = new Set();
  for (const x of String(raw).split(',').map((v) => v.trim()).filter(Boolean)) {
    if (!SYMBOL.test(x)) throw new Error('ROBYN_ALLOWED_SYMBOLS entries must be plain token symbols: ' + x);
    out.add(x.toUpperCase());
  }
  return out;
}
function addrList(raw, name) {
  const out = new Set();
  for (const x of String(raw || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)) {
    if (!ADDR.test(x)) throw new Error(name + ' entries must be 0x-prefixed 20-byte addresses: ' + x);
    out.add(x);
  }
  return out;
}

/// Reads the policy from an env object. A malformed cap or list entry throws (the server must not start with a rule it ignores).
export function policyFromEnv(env = process.env) {
  const relayer = String(env.ROBYN_RELAYER || '').trim().toLowerCase();
  if (relayer && !ADDR.test(relayer)) throw new Error('ROBYN_RELAYER must be a 0x-prefixed 20-byte address');
  return {
    maxPerCall: capOf(env.ROBYN_MAX_PER_CALL, 'ROBYN_MAX_PER_CALL'),
    maxPerDay: capOf(env.ROBYN_MAX_PER_DAY, 'ROBYN_MAX_PER_DAY'),
    allowedTo: addrList(env.ROBYN_ALLOWED_TO, 'ROBYN_ALLOWED_TO'),
    allowedTokens: addrList(env.ROBYN_ALLOWED_TOKENS, 'ROBYN_ALLOWED_TOKENS'),
    allowedSymbols: symbolList(env.ROBYN_ALLOWED_SYMBOLS === undefined ? 'USDC,USDC.e,EURC' : env.ROBYN_ALLOWED_SYMBOLS),
    relayer: relayer || null,
    ledgerPath: env.ROBYN_SPEND_LEDGER || nodePath.join(os.homedir(), '.anygas-mcp', 'spend.json'),
  };
}

/// '8453', 8453, '0x2105' and ' 8453' are one chain; anything that is not a positive integer is refused.
export function chainKey(chain) {
  let n;
  try { n = BigInt(String(chain).trim()); } catch (e) { n = 0n; }
  if (n <= 0n) throw new SpendPolicyError('chain must be a chain id', 'chain');
  return n.toString();
}
/// An EVM address with or without 0x, in any case, is one token; other ids (e.g. 'yield-usdc') are trimmed and lowercased.
export function tokenKey(token) {
  const t = String(token).trim().toLowerCase();
  return /^(0x)?[0-9a-f]{40}$/.test(t) ? '0x' + t.replace(/^0x/, '') : t;
}
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/// makeSpendGuard(policy, { fs, now }) -> { authorize({ signer, chain, token, amount, toAddress, toChain?, toToken?, spender?, spenderless? }) }
///   spenderless: true only for a signature that names no spender at all (the yield account's Spend intent); it skips
///   the relayer comparison and nothing else. An omitted spender without it is refused when ROBYN_RELAYER is set.
/// authorize() throws SpendPolicyError (nothing recorded) or records the amount and returns { day, spentToday }.
export function makeSpendGuard(policy, { fs = nodeFs, now = () => Date.now() } = {}) {
  const readLedger = () => {
    let j;
    try { j = JSON.parse(fs.readFileSync(policy.ledgerPath, 'utf8')); }
    catch (e) {
      if (e && e.code === 'ENOENT') return {};
      // An unreadable ledger must not reset the daily cap to zero.
      throw new SpendPolicyError('the daily spend ledger at ' + policy.ledgerPath + ' cannot be read; nothing was signed', 'ledger-unreadable');
    }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new SpendPolicyError('the daily spend ledger is corrupt; nothing was signed', 'ledger-unreadable');
    return j;
  };
  const writeLedger = (j) => {
    fs.mkdirSync(nodePath.dirname(policy.ledgerPath), { recursive: true, mode: 0o700 });
    const tmp = policy.ledgerPath + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(j), { mode: 0o600 });
    fs.renameSync(tmp, policy.ledgerPath);
  };
  return {
    authorize({ signer, chain, token, amount, toAddress, toChain, toToken, spender, spenderless = false }) {
      let amt;
      if (!UINT.test(String(amount))) throw new SpendPolicyError('amount must be a whole number of base units, digits only', 'amount');
      amt = BigInt(String(amount));
      if (amt <= 0n) throw new SpendPolicyError('amount must be positive', 'amount');
      const to = String(toAddress || signer).toLowerCase();
      if (to !== String(signer).toLowerCase() && !policy.allowedTo.has(to)) {
        throw new SpendPolicyError('refused: ' + toAddress + ' is not this signer and is not in ROBYN_ALLOWED_TO; nothing was signed', 'recipient');
      }
      if (toChain !== undefined) {
        let ok = false;
        try { ok = Number.isSafeInteger(Number(chainKey(toChain))); } catch (e) { ok = false; }
        if (!ok) throw new SpendPolicyError('refused: toChain ' + toChain + ' is not an EVM chain id (Stellar destinations are not supported by this server yet); nothing was signed', 'to-chain');
      }
      if (toToken !== undefined) {
        const t = String(toToken).trim();
        const listed = SYMBOL.test(t) ? (policy.allowedSymbols || new Set()).has(t.toUpperCase()) : (policy.allowedTokens || new Set()).has(tokenKey(t));
        if (!listed) {
          throw new SpendPolicyError('refused: destination token ' + t + ' is not in ROBYN_ALLOWED_SYMBOLS or ROBYN_ALLOWED_TOKENS; nothing was signed', 'to-token');
        }
      }
      if (policy.relayer && spenderless !== true && String(spender || '').toLowerCase() !== policy.relayer) {
        throw new SpendPolicyError('refused: the router reported relayer ' + spender + ', not ROBYN_RELAYER; nothing was signed', 'relayer');
      }
      if (policy.maxPerCall !== null && amt > policy.maxPerCall) {
        throw new SpendPolicyError('refused: ' + amt + ' exceeds ROBYN_MAX_PER_CALL (' + policy.maxPerCall + '); nothing was signed', 'per-call');
      }
      if (policy.maxPerDay === null) return { day: null, spentToday: null };
      const day = dayOf(now()), key = chainKey(chain) + ':' + tokenKey(token);
      const led = readLedger();
      const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
      if (led.day !== undefined && (typeof led.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(led.day) || led.day > day)) throw new SpendPolicyError('the daily spend ledger is corrupt; nothing was signed', 'ledger-unreadable');
      if (led.day === day && !isObj(led.spent)) throw new SpendPolicyError('the daily spend ledger is corrupt; nothing was signed', 'ledger-unreadable');
      const today = led.day === day ? led.spent : {};
      let prior;
      const raw = today[key] === undefined ? '0' : String(today[key]);
      if (!UINT.test(raw)) throw new SpendPolicyError('the daily spend ledger is corrupt; nothing was signed', 'ledger-unreadable');
      prior = BigInt(raw);
      if (prior + amt > policy.maxPerDay) {
        throw new SpendPolicyError('refused: today\'s total would be ' + (prior + amt) + ', over ROBYN_MAX_PER_DAY (' + policy.maxPerDay + '); nothing was signed', 'per-day');
      }
      writeLedger({ day, spent: { ...today, [key]: String(prior + amt) } });
      return { day, spentToday: prior + amt };
    },
  };
}
