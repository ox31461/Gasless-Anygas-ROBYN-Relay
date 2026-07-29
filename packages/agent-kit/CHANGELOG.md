# Changelog

## 1.2.0
- Add `agentDo()` - the one-call entry point. Send a plain-language or structured intent and get back a
  quoted plan plus the exact EIP-712 payload to sign (`signRequest.eip712`) and where to submit it.
  `sandbox: true` runs the identical path with no funds and nothing broadcast.
- Add `errors()` - the full error contract, so you can branch on `errorCode` instead of parsing messages.
- Types shipped in step with the implementation: `AgentDoParams`, `AgentDoSignRequest`, `AgentDoResult`.

## 1.1.0
- Add AnyGas Account (non-custodial yield): yieldAccount(), yieldQuote(), approveYield(), yieldSpend().
  Keep USDC in your own wallet in Aave v3 or Moonwell (best-yield auto-selected, earning while it pays your gas); spend it as any token or native gas on any chain, gaslessly, just-in-time.

