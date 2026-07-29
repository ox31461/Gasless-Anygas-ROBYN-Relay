# anygas — Python SDK

Gasless cross-chain routing + yield-native gasless spending for AI agents across 26 networks.
Python twin of the `anygas-agent-kit` npm package, built for LangChain / CrewAI / custom agents.

## Install

Not on PyPI yet, so install straight from the repo (works today):

```bash
pip install "anygas @ git+https://github.com/ox31461/Gasless-Anygas-ROBYN-Relay#subdirectory=sdk-python"

# with local intent signing (adds eth-account):
pip install "anygas[signing] @ git+https://github.com/ox31461/Gasless-Anygas-ROBYN-Relay#subdirectory=sdk-python"

# with LangChain tools:
pip install "anygas[langchain] @ git+https://github.com/ox31461/Gasless-Anygas-ROBYN-Relay#subdirectory=sdk-python"
```

> `pip install anygas` will work once the package is published to PyPI. Until then use the commands
> above - the extras resolve correctly through the direct reference.

## Quickstart - one call

`agent_do` is the recommended entry point: send a plain-language or structured intent, get back a
quoted plan plus the exact payload to sign.

```python
from anygas import AnyGas

ag = AnyGas()   # defaults to the public gateway; no key required

plan = ag.agent_do("send 25 USDC to 0xRecipient on arbitrum", from_chain=8453)
print(plan["status"])        # "sign" | "quoted" | "done" | "blocked"
print(plan["rail"])          # winning rail, e.g. robyn-floatlane
print(plan["signRequest"])   # eip712 payload + submitBody + submitTo

# prove the whole flow first with no funds and nothing broadcast:
print(ag.agent_do("send 25 USDC to 0xRecipient on arbitrum", from_chain=8453, sandbox=True))

# the error contract - branch on errorCode, never on message text:
print(ag.errors()["codes"].keys())
```

```python
from anygas import AnyGas

ag = AnyGas()                       # public API, no key needed to quote
print(ag.chains())                  # supported gasless chains
q = ag.quote(from_chain=8453, to_chain=42161, amount=5)
print(q)

# Non-custodial yield account: hold mUSDC/aUSDC, spend as any gas token.
# Requires the [signing] extra (see Install above)
ag = AnyGas(private_key="0x...")    # the AGENT's own key (never leaves the process)
intent = ag.sign_spend(src_chain=8453, amount_usd=1.0, to_chain=8453,
                       to_address="0x...")
print(ag.spend(intent, live=False))  # DRY first; live=True to execute
```

LangChain integration (install the `[langchain]` extra, see Install above):

```python
from anygas.langchain_tools import anygas_tools
tools = anygas_tools()  # -> list of LangChain tools: chains, quote, gasless_info, account_spend
```

- Docs: https://anygas.xyz/llms.txt · OpenAPI: https://anygas.xyz/openapi.json
- MCP (hosted): https://anygas.xyz/mcp · npm: `anygas-mcp`, `anygas-agent-kit`
- x402: agents can also pay per-call — `GET /svc/api/x402/info`
