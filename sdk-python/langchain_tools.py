"""LangChain tool bindings for AnyGas. Requires: pip install anygas[langchain]"""
from __future__ import annotations

import json
from typing import Optional

from . import AnyGas


def anygas_tools(client: Optional[AnyGas] = None):
    """Return LangChain Tools for the AnyGas API (chains, quote, gasless_info, account_spend)."""
    from langchain_core.tools import tool

    ag = client or AnyGas()

    @tool
    def anygas_chains() -> str:
        """List the chain IDs where AnyGas provides gasless transactions and just-in-time gas."""
        return json.dumps(ag.chains())

    @tool
    def anygas_quote(from_chain: int, to_chain: int, amount: float,
                     from_token: str = "USDC", to_token: str = "USDC") -> str:
        """Quote a gasless cross-chain route: bridging `amount` of from_token on from_chain to
        to_token on to_chain. Returns the best-of-4 aggregator route with fees."""
        return json.dumps(ag.quote(from_chain, to_chain, amount, from_token, to_token))

    @tool
    def anygas_gasless_info() -> str:
        """AnyGas router/paymaster contract addresses and per-chain gasless configuration."""
        return json.dumps(ag.gasless_info())

    @tool
    def anygas_account_spend(src_chain: int, amount_usd: float, to_chain: int,
                             to_address: str, live: bool = False) -> str:
        """Spend from the agent's non-custodial yield account (aUSDC/mUSDC) as gas/tokens on any
        chain. live=False previews; live=True executes. Client must be built with private_key."""
        signed = ag.sign_spend(src_chain, amount_usd, to_chain, to_address)
        return json.dumps(ag.spend(signed, live=live))

    return [anygas_chains, anygas_quote, anygas_gasless_info, anygas_account_spend]
