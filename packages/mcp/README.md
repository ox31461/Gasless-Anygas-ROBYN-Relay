# anygas-mcp

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
      "args": ["-y", "anygas-mcp"],
      "env": {
        "ROBYN_SVC": "https://api.anygas.xyz/svc",
        "ROBYN_SIGNER_KEY": "0x…",         // optional — omit for read-only
        "ROBYN_RELAYER": "0x…"             // required with a signer key: the Permit2 spender to accept
      }
    }
  }
}
```

## One-time setup (only for execution)

Permit2 SignatureTransfer requires a single, standard approval per (token, chain) — done once by the signer. Approve only what this agent may move: the allowance is the most a misled or leaked signer can lose.

```js
await token.approve("0x000000000022D473030F116dDEE9F6B43aC78BA3", BUDGET);
```

## Spend policy

Every signing tool checks the spend before it signs; a refusal returns `{ ok: false, errorCode: "SPEND_POLICY", reason }` and signs nothing.

- `toAddress` must be the signer itself unless it is listed in `ROBYN_ALLOWED_TO` (comma-separated addresses).
- `toToken` given as an address must be listed in `ROBYN_ALLOWED_TOKENS` (one list, for every chain, also used for the source tokens `robyn_agent_execute` may move); a symbol must be listed in `ROBYN_ALLOWED_SYMBOLS` (default `USDC,USDC.e,EURC`).
- `fromChain` and `toChain` must be EVM chain ids; Stellar destinations are refused by this local server for now.
- `ROBYN_MAX_PER_CALL` / `ROBYN_MAX_PER_DAY` cap each spend and each UTC day, in base units, per (chain, token). The cap is one number for every token, so 25000000 is 25 USDC but a tiny amount of an 18-decimal token; set caps for the tokens you list. The daily total lives in `ROBYN_SPEND_LEDGER` (default `~/.anygas-mcp/spend.json`); run one server per ledger, and keep the agent from writing to it.
- `ROBYN_RELAYER` pins the Permit2 spender every signature may name. It is required whenever `ROBYN_SIGNER_KEY` is set; the server will not start without it.
- `robyn_agent_execute` signs the payload the service plans, only after checking it is a Permit2 transfer on the source chain to the expected relayer, with a short deadline, for the token, amount and destination the submit body names and the agent asked for. The source token must be the `token` address the agent passed or be listed in `ROBYN_ALLOWED_TOKENS`, and without an exact `amount` the call needs `ROBYN_MAX_PER_CALL`. With `sandbox: true` it never signs.
- A malformed cap or list entry stops the server at start.

After that, every cross-chain move is a single gasless signature — the agent never holds native gas anywhere.

## Example

> **Agent:** *"Move 25 USDC from Base to Arbitrum."*
> Calls `robyn_cross_chain({ fromChain: 8453, fromToken: "0x833589…", amount: "25000000", toChain: 42161, toToken: "USDC" })`
> → `{ id: "rt_…", status: "BRIDGING", gasless: true }`, then `robyn_route_status` → `DONE`.

The hosted Robyn router also routes to Stellar; this local signing server refuses Stellar destinations for now (see the spend policy above).

## Security notes

- `ROBYN_SIGNER_KEY` is a hot key. Fund it only with what an agent should be able to move; treat the MCP env as a secret.
- The signer never submits a transaction or spends gas — it only signs Permit2 intents. Robyn's relayer executes and fronts gas.
- Leave `ROBYN_SIGNER_KEY` unset to run a safe, read-only quoting/tracking server.

MIT.
