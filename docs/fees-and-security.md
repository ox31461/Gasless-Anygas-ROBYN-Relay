# Fees & security

## Fees

Robyn's fee is always charged **in the token you're already using** — the agent never needs a native balance to cover gas or fees.

| Action | Fee |
|---|---|
| Gasless pay (`pay` / `payAny` / `buy`) | The real gas cost plus a small margin, **~5% of gas**, in-token. |
| Cross-chain (`crossChain`) | **0.25%** of the moved amount, in-token. |

Every quote returns the fee **before** you execute:

- Gasless: `POST /api/gasless/quote` returns a `suggestedMaxFee`. You sign a `maxFee` — the relayer can never charge more than the amount you signed.
- Cross-chain: `route` / `robyn_quote` returns the estimated output, the bridge used, the duration, and the Robyn fee.

For `payAny`, the fee is atomically converted into a verified asset during execution, so you can pay in any verified-swappable token while Robyn is still reimbursed in something it can settle.

## Security model

### The signer only signs
The agent's signer is **never** used to send a transaction or spend gas. It signs an off-chain intent (an EIP-712 / Permit2 typed message). Robyn's relayer submits the on-chain transaction and fronts all native gas — on the source chain, the destination chain, and the bridge. The signer therefore needs **zero native balance** on any chain.

### Bounded authorization
- **Gasless pay** authorizes a specific `{ token, to, amount, maxFee, deadline, nonce }`. The relayer cannot exceed the signed `amount` or `maxFee`, and the intent expires at `deadline`.
- **Cross-chain** uses Permit2 `SignatureTransfer`: a single-use authorization for the relayer (the `spender`) to pull exactly `amount` of one token, bounded by `nonce` and `deadline`. It is not an open-ended allowance.

### Permit2 approval
The one-time `token.approve(PERMIT2, MaxUint256)` grants the **canonical Uniswap Permit2 contract** (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) the ability to move that token — and every subsequent move still requires a fresh, bounded, single-use signed permit. This is the standard Permit2 pattern used across the ecosystem.

### Read vs. execute
Every client can run **read-only** with no credentials:
- MCP: omit `ROBYN_SIGNER_KEY` → only `robyn_mesh` / `robyn_quote` / `robyn_route_status` are exposed.
- Adapters / SDK: omit the `signer` → quoting and tracking only; `crossChain` is unavailable.

Only add a signer when you actually want the agent to move value.

### Key handling
- `ROBYN_SIGNER_KEY` (MCP) and the SDK `signer` are **hot keys**. Fund them only with what an agent should be allowed to move.
- Treat the MCP `env` and any key material as secrets. Never commit them. This repo's `.gitignore` excludes `.env`, `*.log`, and common key files.

## What's open vs. proprietary

**Open (MIT, in this repo):** the three client packages — `@robyn/agent-kit`, `@robyn/mcp`, `@robyn/adapters` — and these docs.

**Proprietary (not in this repo, not licensed here):** the Robyn relayer service, the smart contracts, and the network. See [NOTICE](../NOTICE). Integrate with Robyn freely; don't replicate or re-host it.
