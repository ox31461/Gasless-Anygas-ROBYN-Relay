"""LangChain bindings: only runs when the [langchain] extra is installed."""
import json

import pytest

pytest.importorskip("langchain_core")

from anygas import AnyGas  # noqa: E402
from anygas.langchain_tools import anygas_tools  # noqa: E402


class StubClient(AnyGas):
    def __init__(self):
        super().__init__("https://svc.test/svc")
        self.seen = []

    def chains(self):
        return [10, 8453]

    def quote(self, *a):
        self.seen.append(a)
        return {"estOut": "1"}


def test_tool_names_and_dispatch():
    client = StubClient()
    tools = {t.name: t for t in anygas_tools(client)}
    assert set(tools) == {"anygas_chains", "anygas_quote", "anygas_gasless_info", "anygas_account_spend"}
    assert json.loads(tools["anygas_chains"].invoke({})) == [10, 8453]
    out = tools["anygas_quote"].invoke({"from_chain": 8453, "to_chain": 42161, "amount": 5})
    assert json.loads(out) == {"estOut": "1"}
    assert client.seen == [(8453, 42161, 5, "USDC", "USDC")]
