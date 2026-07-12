# Integration guide

Robyn gives an AI agent (or any automated system) the ability to **pay** and **move value across chains** with **no native gas anywhere**. The agent holds a token and signs intents; Robyn's relayer fronts gas on both chains and the bridge, reimbursed from the token.

There are three client surfaces — pick one. All are MIT and published on [JSR](https://jsr.io).

| Package | Use it when |
|---|---|
| [`@robyn/agent-kit`](../packages/agent-kit) | You want a direct SDK in your own code. |
| [`@robyn/mcp`](../packages/mcp) | You want to expose Robyn as tools to an MCP agent (Claude Desktop, Cursor, …). |
| [`@robyn/adapters`](../packages/adapters) | You want Robyn as a tool inside Vercel AI SDK, LangChain, Coinbase AgentKit, or raw OpenAI/Anthropic function-calling. |

## Prerequisites

- Node.js **>= 18**.
- An **ethers v6** `Signer` / `Wallet`. It only ever **signs** — it never sends a transaction or spends gas, so it needs **no native balance**.
- Your Robyn service base URL (`svc`), e.g. `https://<your-robyn-gateway>/svc`.

## The service URL (`svc`)

Every client takes a `svc` base URL and talks to these endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/gasless/info` | Chain registry, router addresses, chain id. |
| `POST /api/gasless/quote` | Suggested max fee for a gasless pay/call. |
| `POST /api/gasless/submit` | Submit a signed gasless intent (`pay` / `payAny` / `call`). |
| `GET /api/route/chains` | Cross-chain route graph + the relayer/Permit2 spender. |
| `POST /api/route/quote` | Quote a cross-chain route (read-only). |
| `POST /api/route/execute` | Execute a cross-chain move from a signed Permit2 intent. |
| `GET /api/route/status?id=…` | Track an in-flight route to `DONE`. |

## Quick start (SDK)

```bash
npx jsr add @robyn/agent-kit
```

```js
import { RobynAgent } from '@robyn/agent-kit';
import { ethers } from 'ethers';

const signer = new ethers.Wallet(PRIVATE_KEY, provider); // needs NO native balance
const agent  = new RobynAgent({ signer, svc: 'https://<your-robyn-gateway>/svc' });

// Read the live mesh
const mesh = await agent.routeInfo();

// Gasless payment in any verified token
await agent.payAny({ token: ANY, to: merchant, amount, verifiedAsset: USDG });

// One-signature cross-chain move
const { id } = await agent.crossChain({
  fromChain: 8453,  fromToken: USDC_BASE,
  toChain:   42161, toToken:   USDC_ARB,
  amount:    25_000000n,
});

// Track to completion
let s; do { s = await agent.routeStatus(id); } while (s.status !== 'DONE');
```

### SDK methods

| Method | What it does |
|---|---|
| `pay` / `payAny` / `buy` | Gasless transfer / pay-in-any-token / purchase via an allowlisted venue. |
| `route` | Quote a cross-chain route (read-only). |
| `crossChain` | Move value across chains, gasless, one Permit2 signature. |
| `routeStatus` / `routeInfo` | Track a route / read the mesh. |
| `chains` / `info` | The gasless chain registry. |

## MCP server

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
        "ROBYN_SIGNER_KEY": "0x…"   // OPTIONAL — omit for a read-only server
      }
    }
  }
}
```

Tools: `robyn_mesh`, `robyn_quote`, `robyn_route_status` (no credentials), and `robyn_cross_chain` (only active when `ROBYN_SIGNER_KEY` is set). With no key, the server is safely read-only.

## Framework adapters

```bash
npx jsr add @robyn/adapters
```

Same four tools everywhere — `robyn_mesh`, `robyn_quote`, `robyn_route_status`, `robyn_cross_chain`. Read tools need no signer; `robyn_cross_chain` is added only when you pass a `signer`.

```js
// Vercel AI SDK
import { robynTools } from '@robyn/adapters/ai-sdk';
const tools = await robynTools({ svc, signer });
await generateText({ model, tools, prompt: 'move 25 USDC from Base to Arbitrum' });

// LangChain
import { robynLangchainTools } from '@robyn/adapters/langchain';
const tools = await robynLangchainTools({ svc, signer });

// Coinbase AgentKit
import { robynActionProvider } from '@robyn/adapters/agentkit';
const provider = await robynActionProvider({ svc, signer });

// Raw OpenAI / Anthropic function-calling
import { robynOpenAITools, robynAnthropicTools, robynDispatcher } from '@robyn/adapters/schemas';
const tools = robynOpenAITools();            // or robynAnthropicTools()
const run   = robynDispatcher({ svc, signer }); // run(name, args) per tool call
```

## One-time Permit2 approval

Cross-chain uses Permit2 `SignatureTransfer`. Once per (token, chain), approve Permit2 to spend the token — a standard single ERC-20 approval:

```js
await token.approve('0x000000000022D473030F116dDEE9F6B43aC78BA3', ethers.MaxUint256);
```

After that, every cross-chain move is a single gasless signature.

## Stellar

Stellar mainnet is a first-class destination and source. Set `toChain: "stellar"` and `toToken: "USDC"` in a quote or `crossChain` call. Both EVM→Stellar and Stellar→EVM run on mainnet — see the [Proof section in the README](../README.md#proof--real-mainnet-transactions).
