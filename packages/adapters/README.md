# anygas-adapters

> **Integrate, don't replicate.** This package is MIT — integrate Robyn into your app, agent, or product freely, no restrictions. The license covers **only** this client library; Robyn's relayer, smart contracts, and network are **proprietary** and are not licensed here. Don't use it (or the Robyn API) to run a competing gasless-relay service or to replicate Robyn. See [NOTICE](./NOTICE). _Build with Robyn: yes. Clone Robyn to cut it out: no._

**Gasless cross-chain, as a tool in the agent framework you already use.**

Drop-in adapters that give any agent Robyn's gasless cross-chain capability across **22 EVM chains + Stellar** — one signature, no native gas on any chain. Read tools (`mesh` / `quote` / `route_status`) need no credentials; `cross_chain` activates when you pass a signer.

Same four tools everywhere: `robyn_mesh`, `robyn_quote`, `robyn_route_status`, `robyn_cross_chain`.

```bash
npm i anygas-adapters
# + your framework: `ai`, or `@langchain/core`, or `@coinbase/agentkit` (only what you use)
```

Import subpath per framework:

### Vercel AI SDK
```js
import { robynTools } from 'anygas-adapters/ai-sdk';
const tools = await robynTools({ svc: 'https://<gateway>/svc', signer });   // signer optional
await generateText({ model, tools, prompt: 'move 25 USDC from Base to Arbitrum' });
```

### LangChain
```js
import { robynLangchainTools } from 'anygas-adapters/langchain';
const tools = await robynLangchainTools({ svc: 'https://<gateway>/svc', signer });
const agent = createReactAgent({ llm, tools });
```

### Coinbase AgentKit
```js
import { robynActionProvider } from 'anygas-adapters/agentkit';
const agentkit = await AgentKit.from({ walletProvider,
  actionProviders: [ await robynActionProvider({ svc: 'https://<gateway>/svc', signer }) ] });
```

### OpenAI / Anthropic (framework-free)
```js
import { robynOpenAITools, robynAnthropicTools, robynDispatcher } from 'anygas-adapters/schemas';

const tools = robynOpenAITools();                 // or robynAnthropicTools()
const run   = robynDispatcher({ svc, signer });   // run(name, args) for each tool call the model emits
// …in your loop: const result = await run(call.function.name, JSON.parse(call.function.arguments));
```

### Core (any runtime)
```js
import { robyn } from 'anygas-adapters/core';
const r = robyn({ svc, signer });
await r.quote({ fromChain: 8453, fromToken: USDC_BASE, toChain: 42161, toToken: USDC_ARB, amount: '25000000' });
const { id } = await r.crossChain({ fromChain: 8453, fromToken: USDC_BASE, amount: '25000000', toChain: 42161, toToken: USDC_ARB });
```

## The signer

`signer` is an **ethers v6 Signer/Wallet**. It only ever **signs** a Permit2 intent — it never sends a transaction or spends gas; Robyn's relayer submits and fronts gas on both chains. One-time per (token, chain), the signer must approve Permit2:

```js
await token.approve('0x000000000022D473030F116dDEE9F6B43aC78BA3', ethers.MaxUint256);
```

Omit `signer` for a safe, read-only (quote/track) integration. Stellar is a first-class destination — `toChain: "stellar"`, `toToken: "USDC"`.

MIT.
