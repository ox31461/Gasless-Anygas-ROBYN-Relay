# Changelog

## Unreleased
- Fix `payAny()` on a chain other than the service's home chain: the EIP-2612 permit was signed with
  the home `chainId`, so it could never verify on the token's chain. It now uses the payAny chain.
- Fix `spend()` idle-balance fallback: it passed the symbol "USDC" as the Permit2 token, which ethers
  cannot sign (it tried to resolve it as an ENS name). Pass `fromToken` (the USDC address on the source
  chain) for the fallback; without it `spend()` now fails with a clear message.
- Non-JSON service responses raise `Robyn service returned non-JSON (HTTP <status>)` instead of a bare
  `SyntaxError`. JSON error bodies (`errorCode`) are still returned as data.
- Types: declare `spend()` / `SpendParams`; `AgentDoResult.status` includes `'blocked'`.
- `yieldQuote()` accepts `agent`, so it works read-only without a signer (matching the MCP
  `robyn_yield_quote` tool). Signer-only calls made without a signer now fail with
  `this call needs a signer` instead of a `TypeError`.

## 1.2.0
- Add `agentDo()` - the one-call entry point. Send a plain-language or structured intent and get back a
  quoted plan plus the exact EIP-712 payload to sign (`signRequest.eip712`) and where to submit it.
  `sandbox: true` runs the identical path with no funds and nothing broadcast.
- Add `errors()` - the full error contract, so you can branch on `errorCode` instead of parsing messages.
- Types shipped in step with the implementation: `AgentDoParams`, `AgentDoSignRequest`, `AgentDoResult`.

## 1.1.0
- Add AnyGas Account (non-custodial yield): yieldAccount(), yieldQuote(), approveYield(), yieldSpend().
  Keep USDC in your own wallet in Aave v3 or Moonwell (best-yield auto-selected, earning while it pays your gas); spend it as any token or native gas on any chain, gaslessly, just-in-time.

