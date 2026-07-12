# robyn-mcp

> **Integrate, don't replicate.** This package is MIT — integrate Robyn into your app, agent, or product freely, no restrictions. The license covers **only** this client library; Robyn's relayer, smart contracts, and network are **proprietary** and are not licensed here. Don't use it (or the Robyn API) to run a competing gasless-relay service or to replicate Robyn. See [NOTICE](./NOTICE). _Build with Robyn: yes. Clone Robyn to cut it out: no._

**Gasless cross-chain for AI agents, as an MCP server.**

Give any MCP-capable agent (Claude Desktop, Cursor, agent frameworks) the ability to move value across **22 EVM chains + Stellar** with **one signature and zero gas management** — no native token, no per-chain balances, no bridge picking. Robyn's relayer fronts all gas on both chains and is reimbursed from the token being moved.

## Tools

| Tool | Needs key | What it does |
|---|---|---|
| `robyn_mesh` | no | List the gasless chains + cross-chain route graph (22 EVM nodes + Stellar). |
| `robyn_quote` | no | Best gasless route for a move — estimated output, bridge, duration, fee. Read-only. |
| `robyn_route_status` | no | Track an in-flight route (`BRIDGING → DONE`) with the destination tx. |
| `robyn_cross_chain` | **yes** | Execute a gasless cross-chain move. Signs one Permit2 intent; the agent pays no gas. |

Read tools work with **no credentials**. `robyn_cross_chain` only activates when `ROBYN_SIGNER_KEY` is set — otherwise the server is safely read-only.

## Configure (Claude Desktop)

```jsonc
{
  "mcpServers": {
    "robyn": {
      "command": "npx",
      "args": ["-y", "robyn-mcp"],
      "env": {
        "ROBYN_SVC": "https://<your-robyn-gateway>/svc",
        "ROBYN_SIGNER_KEY": "0x…"          // optional — omit for read-only
      }
    }
  }
}
```

## One-time setup (only for execution)

Permit2 SignatureTransfer requires a single, standard approval per (token, chain) — done once by the signer:

```js
await token.approve("0x000000000022D473030F116dDEE9F6B43aC78BA3", ethers.MaxUint256);
```

After that, every cross-chain move is a single gasless signature — the agent never holds native gas anywhere.

## Example

> **Agent:** *"Move 25 USDC from Base to Arbitrum."*
> Calls `robyn_cross_chain({ fromChain: 8453, fromToken: "0x833589…", amount: "25000000", toChain: 42161, toToken: "0xaf88…" })`
> → `{ id: "rt_…", status: "BRIDGING", gasless: true }`, then `robyn_route_status` → `DONE`.

Stellar is a first-class destination too — set `toChain: "stellar"` and `toToken: "USDC"`.

## Security notes

- `ROBYN_SIGNER_KEY` is a hot key. Fund it only with what an agent should be able to move; treat the MCP env as a secret.
- The signer never submits a transaction or spends gas — it only signs Permit2 intents. Robyn's relayer executes and fronts gas.
- Leave `ROBYN_SIGNER_KEY` unset to run a safe, read-only quoting/tracking server.

MIT.
