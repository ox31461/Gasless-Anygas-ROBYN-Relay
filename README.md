# Robyn — AnyGas

**A gasless intent layer for AI agents.** Sign one intent, hold no native gas anywhere, and pay or move value across **22 EVM chains + Stellar mainnet**. Robyn's relayer fronts the gas — on the source chain, the destination chain, and the bridge — and is reimbursed from the token being moved. The agent's signer needs **zero native balance**. It only signs.

[![agent-kit](https://jsr.io/badges/@robyn/agent-kit)](https://jsr.io/@robyn/agent-kit)
[![mcp](https://jsr.io/badges/@robyn/mcp)](https://jsr.io/@robyn/mcp)
[![adapters](https://jsr.io/badges/@robyn/adapters)](https://jsr.io/@robyn/adapters)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

```bash
npx jsr add @robyn/agent-kit
```

```js
import { RobynAgent } from '@robyn/agent-kit';

const agent = new RobynAgent({ signer, svc: 'https://<your-robyn-gateway>/svc' });

// Move value across chains — one signature, zero gas on either side.
const { id } = await agent.crossChain({
  fromChain: 8453,  fromToken: USDC_BASE,   // Base
  toChain:   42161, toToken:   USDC_ARB,    // Arbitrum
  amount:    25_000000n,
});
```

That's the whole thing. No faucet, no per-chain gas top-ups, no bridge picking, no native token held anywhere. The signer signs a single [Permit2](https://github.com/Uniswap/permit2) intent; Robyn does the rest and takes its fee **in the token being moved**.

---

## What Robyn does

Two capabilities, one gasless model:

- **Gasless pay** — transfer or pay in **any verified token** on any supported chain. The relayer fronts gas and is repaid from the token (fee auto-converted to a verified asset when needed). See `pay` / `payAny` / `buy`.
- **One-signature cross-chain** — move value between any two supported chains (including **to and from Stellar**) with a single Permit2 signature and zero gas on either side. See `route` (quote) / `crossChain` (execute) / `routeStatus` (track).

Live on mainnet, both directions to Stellar.

## The mesh — 22 EVM chains + Stellar

A single relayer mesh spans **22 EVM chains and Stellar mainnet**. Any node can be a source or a destination — EVM↔EVM and EVM↔Stellar both run on mainnet today. Stellar is a first-class destination: set `toChain: "stellar"`, `toToken: "USDC"`.

Query the live registry and route graph at runtime — `agent.chains()` / `agent.routeInfo()`, or the `robyn_mesh` tool.

## Proof — real mainnet transactions

Robyn is live. These are on-chain, verifiable moves — not testnet, not simulated:

| What | Transaction |
|---|---|
| EVM→EVM Permit2 delivery (Base→Arbitrum) | [`0x98a988b1…`](https://arbiscan.io/tx/0x98a988b1) |
| EVM→Stellar (source leg, Arbitrum) | [`0x22c16ca8…`](https://arbiscan.io/tx/0x22c16ca8) |
| EVM→Stellar (destination leg, Stellar) | [`63f5eb1c…`](https://stellar.expert/explorer/public/tx/63f5eb1c) |
| Gasless `pay_any` on Stellar mainnet | [`d96d7e52…`](https://stellar.expert/explorer/public/tx/d96d7e52) |

Stellar mainnet contract: [`CDDJAVK2CLA2LIYJWXH4APVFEDQBH3HT72UFAVSLNBLDTEZELJ6PEKD2`](https://stellar.expert/explorer/public/contract/CDDJAVK2CLA2LIYJWXH4APVFEDQBH3HT72UFAVSLNBLDTEZELJ6PEKD2)

## Integrate three ways

Pick the surface that fits your stack. All three are MIT client packages published on [JSR](https://jsr.io).

### 1. SDK — `@robyn/agent-kit`
The one-import way for an agent (or any automated system) to transact gaslessly.

```bash
npx jsr add @robyn/agent-kit
```
```js
import { RobynAgent } from '@robyn/agent-kit';
const agent = new RobynAgent({ signer, svc });
await agent.payAny({ token: ANY, to: merchant, amount, verifiedAsset: USDG }); // gasless pay
await agent.crossChain({ fromChain: 8453, fromToken, amount, toChain: 42161, toToken }); // cross-chain
```

### 2. MCP server — `@robyn/mcp`
Give any MCP-capable agent (Claude Desktop, Cursor, agent frameworks) Robyn's tools directly.

```bash
npx jsr add @robyn/mcp
```
```jsonc
{
  "mcpServers": {
    "robyn": {
      "command": "npx",
      "args": ["-y", "robyn-mcp"],
      "env": {
        "ROBYN_SVC": "https://<your-robyn-gateway>/svc",
        "ROBYN_SIGNER_KEY": "0x…"   // optional — omit for a safe read-only server
      }
    }
  }
}
```
Tools: `robyn_mesh`, `robyn_quote`, `robyn_route_status` (no credentials) and `robyn_cross_chain` (needs a signer key).

### 3. Framework adapters — `@robyn/adapters`
The same four tools as a drop-in for the agent framework you already use.

```bash
npx jsr add @robyn/adapters
```
```js
import { robynTools }          from '@robyn/adapters/ai-sdk';    // Vercel AI SDK
import { robynLangchainTools } from '@robyn/adapters/langchain'; // LangChain
import { robynActionProvider } from '@robyn/adapters/agentkit';  // Coinbase AgentKit
import { robynOpenAITools, robynAnthropicTools, robynDispatcher } from '@robyn/adapters/schemas'; // raw function-calling
```

## Fees

- **Gasless pay** — the actual gas cost plus a small margin of **~5% of gas**, charged **in-token**.
- **Cross-chain** — **0.25%** of the moved amount, charged **in-token**.

Always paid from the token you're already moving — the agent never needs a native balance to cover fees. Every quote returns the fee before you execute (`route` / `robyn_quote`).

## One-time setup

Cross-chain uses [Permit2](https://github.com/Uniswap/permit2) `SignatureTransfer`. Once per (token, chain), the signer approves Permit2 to spend the token — a standard, single ERC-20 approval:

```js
await token.approve('0x000000000022D473030F116dDEE9F6B43aC78BA3', ethers.MaxUint256);
```

After that, every move is a single gasless signature — no native token, ever.

## Integrate, don't replicate

These packages are **MIT** — build on Robyn, ship it, and sell your product built with it, no restrictions. The license covers **only** these client libraries. Robyn's relayer, smart contracts, and network are **proprietary** and are not licensed here; don't use these packages (or the Robyn API) to run a competing gasless-relay service or to replicate Robyn. See [NOTICE](./NOTICE).

_Build **with** Robyn: yes. Clone Robyn to cut it out: no._

## Repo layout

```
packages/agent-kit/   @robyn/agent-kit — the SDK
packages/mcp/         @robyn/mcp — the MCP server
packages/adapters/    @robyn/adapters — framework adapters
docs/                 integration guide, fee & security overview
```

## Docs

- [Integration guide](./docs/integration.md)
- [Fees & security](./docs/fees-and-security.md)

## License

[MIT](./LICENSE) for the client packages in this repo. See [NOTICE](./NOTICE) for scope.
