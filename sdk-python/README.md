# anygas — Python SDK

Gasless cross-chain routing + yield-native gasless spending for AI agents across 26 networks.
Python twin of the `anygas-agent-kit` npm package, built for LangChain / CrewAI / custom agents.

```python
from anygas import AnyGas

ag = AnyGas()                       # public API, no key needed to quote
print(ag.chains())                  # supported gasless chains
q = ag.quote(src_chain=8453, dst_chain=42161, amount_usd=5)
print(q)

# Non-custodial yield account: hold mUSDC/aUSDC, spend as any gas token.
# Requires: pip install anygas[signing]
ag = AnyGas(private_key="0x...")    # the AGENT's own key (never leaves the process)
intent = ag.sign_spend(src_chain=8453, amount_usd=1.0, to_chain=8453,
                       to_address="0x...")
print(ag.spend(intent, live=False))  # DRY first; live=True to execute
```

LangChain integration (`pip install anygas[langchain]`):

```python
from anygas.langchain_tools import anygas_tools
tools = anygas_tools()  # -> list of LangChain tools: chains, quote, gasless_info, account_spend
```

- Docs: https://anygas.xyz/llms.txt · OpenAPI: https://anygas.xyz/openapi.json
- MCP (hosted): https://anygas.xyz/mcp · npm: `anygas-mcp`, `anygas-agent-kit`
- x402: agents can also pay per-call — `GET /svc/api/x402/info`
