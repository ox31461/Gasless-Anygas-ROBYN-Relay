# Integration guide

Robyn gives an AI agent (or any automated system) the ability to **pay** and **move value across chains** with **no native gas anywhere**. The agent holds a token and signs intents; Robyn's relayer fronts gas on both chains and the bridge, reimbursed from the token.

There are four client surfaces — pick one. All are MIT. The JS packages are published on [JSR](https://jsr.io) under `@anygas/*` (and on npm as `anygas-*`); `@robyn/*` is the legacy scope and is no longer updated.

| Package | Use it when |
|---|---|
| [`@anygas/agent-kit`](../packages/agent-kit) | You want a direct SDK in your own code. |
| [`@anygas/mcp`](../packages/mcp) | You want to expose Robyn as tools to an MCP agent (Claude Desktop, Cursor, …). |
| [`@anygas/adapters`](../packages/adapters) | You want Robyn as a tool inside Vercel AI SDK, LangChain, Coinbase AgentKit, or raw OpenAI/Anthropic function-calling. |
| [`anygas` (Python)](../sdk-python) | You are in Python (LangChain, CrewAI, custom agents). |

## Prerequisites

- Node.js **>= 18**.
- An **ethers v6** `Signer` / `Wallet`. It only ever **signs** — it never sends a transaction or spends gas, so it needs **no native balance**.
- Your Robyn service base URL (`svc`), e.g. `https://api.anygas.xyz/svc`.

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
| `POST /api/agent/do` | One intent in, a quoted plan plus the exact payload to sign out (`sandbox: true` rehearses). |
| `GET /api/errors` | The error contract: every `errorCode`, whether it is retryable, and the suggested action. |

The same API is also reachable at `https://anygas.xyz/svc`; every client in this repo defaults to `https://api.anygas.xyz/svc`.

## Quick start (SDK)

```bash
npx jsr add @anygas/agent-kit
```

```js
import { RobynAgent } from '@anygas/agent-kit';
import { ethers } from 'ethers';

const signer = new ethers.Wallet(PRIVATE_KEY, provider); // needs NO native balance
const agent  = new RobynAgent({ signer, svc: 'https://api.anygas.xyz/svc' });

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
npx jsr add @anygas/mcp
```

```jsonc
{
  "mcpServers": {
    "robyn": {
      "command": "npx",
      "args": ["-y", "anygas-mcp"],
      "env": {
        "ROBYN_SVC": "https://api.anygas.xyz/svc",
        "ROBYN_SIGNER_KEY": "0x…"   // OPTIONAL — omit for a read-only server
      }
    }
  }
}
```

Read tools (no credentials): `robyn_mesh`, `robyn_quote`, `robyn_route_status`, `robyn_agent_do`, `robyn_errors`, `robyn_yield_account`, `robyn_yield_quote`. Execute tools (`robyn_cross_chain`, `robyn_agent_execute`, `robyn_yield_spend`) are only registered when `ROBYN_SIGNER_KEY` is set. With no key, the server is safely read-only. The npm bin is `anygas-mcp` (`robyn-mcp` is the legacy name).

## Framework adapters

```bash
npx jsr add @anygas/adapters
```

Same four tools everywhere — `robyn_mesh`, `robyn_quote`, `robyn_route_status`, `robyn_cross_chain`. Read tools need no signer; `robyn_cross_chain` is added only when you pass a `signer`.

```js
// Vercel AI SDK
import { robynTools } from '@anygas/adapters/ai-sdk';
const tools = await robynTools({ svc, signer });
await generateText({ model, tools, prompt: 'move 25 USDC from Base to Arbitrum' });

// LangChain
import { robynLangchainTools } from '@anygas/adapters/langchain';
const tools = await robynLangchainTools({ svc, signer });

// Coinbase AgentKit
import { robynActionProvider } from '@anygas/adapters/agentkit';
const provider = await robynActionProvider({ svc, signer });

// Raw OpenAI / Anthropic function-calling
import { robynOpenAITools, robynAnthropicTools, robynDispatcher } from '@anygas/adapters/schemas';
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
