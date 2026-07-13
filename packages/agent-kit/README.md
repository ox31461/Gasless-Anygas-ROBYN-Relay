# robyn-agent-kit

> **Integrate, don't replicate.** This package is MIT — integrate Robyn into your app, agent, or product freely, no restrictions. The license covers **only** this client library; Robyn's relayer, smart contracts, and network are **proprietary** and are not licensed here. Don't use it (or the Robyn API) to run a competing gasless-relay service or to replicate Robyn. See [NOTICE](./NOTICE). _Build with Robyn: yes. Clone Robyn to cut it out: no._

**Gasless payments and one-signature cross-chain for AI agents.** No native gas, no per-chain balances, no refills — across **22 EVM chains + Stellar**. The agent holds a token and signs intents; Robyn's relayer fronts gas and is repaid from the token.

```bash
npm i robyn-agent-kit ethers
```

```js
import { RobynAgent } from 'robyn-agent-kit';

const agent = new RobynAgent({ signer, svc: 'https://api.anygas.xyz/svc' });

// gasless payment in any verified token
await agent.payAny({ token: ANY, to: merchant, amount, verifiedAsset: USDG });

// move value across chains — one signature, zero gas on either side
const { id } = await agent.crossChain({
  fromChain: 8453, fromToken: USDC_BASE,
  toChain: 42161, toToken: USDC_ARB, amount: 25_000000n,
});
let s; do { s = await agent.routeStatus(id); } while (s.status !== 'DONE');
```

## Methods

| Method | What it does |
|---|---|
| `pay` / `payAny` / `buy` | Gasless transfer / pay-in-any-token / purchase on a chain |
| `route` | Quote a cross-chain route (read-only) |
| `crossChain` | Move value across chains, gasless, one Permit2 signature |
| `routeStatus` / `routeInfo` | Track a route / read the mesh |
| `chains` / `info` | The gasless chain registry |

The signer needs **no native balance** — it only signs. For `crossChain`, do the one-time Permit2 approval once per token:

```js
await token.approve(agent.permit2, ethers.MaxUint256);
```

Stellar is a first-class destination: `toChain: "stellar"`, `toToken: "USDC"`.

MIT.
