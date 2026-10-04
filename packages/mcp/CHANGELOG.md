# Changelog

## 1.3.0 - 2026-10-04
- Signing tools (`robyn_cross_chain`, `robyn_agent_execute`, `robyn_yield_spend`) are only registered
  when `ROBYN_SIGNER_KEY` is set, matching the documented read-only mode. Previously they were always
  listed and refused at call time.
- Tool definitions live in `server.mjs` (`createServer({ svc, key })`); `index.mjs` remains the bin.
- Non-JSON service responses surface as a clear tool error instead of a `SyntaxError`.
- JSR: ship an (empty) `index.d.ts` for the bin entry point via `@ts-self-types`, clearing the
  slow-types warning.

## 1.2.0
- Add `robyn_agent_do` - one intent in, a quoted plan plus the exact EIP-712 payload to sign. Read-only,
  no key required. `sandbox: true` rehearses the whole path with no funds.
- Add `robyn_agent_execute` - end to end in a single call: plan, sign locally with ROBYN_SIGNER_KEY, and
  submit. Sends an idempotency key so a retried tool call cannot double-spend.
- Add `robyn_errors` - the full error contract, so agents branch on `errorCode` rather than message text.

## 1.1.0
- Add AnyGas Account (non-custodial yield): yieldAccount(), yieldQuote(), approveYield(), yieldSpend().
  Keep USDC in your own wallet in Aave v3 or Moonwell (best-yield auto-selected, earning while it pays your gas); spend it as any token or native gas on any chain, gaslessly, just-in-time.

