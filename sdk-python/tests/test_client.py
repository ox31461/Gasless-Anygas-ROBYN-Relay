"""Offline tests for the AnyGas client. HTTP is intercepted at requests.Session.send."""
from __future__ import annotations

import json
import time
from urllib.parse import parse_qs, urlsplit

import pytest
import requests

import anygas
from anygas import AnyGas, AnyGasError

BASE = "https://svc.test/svc"
RECIPIENT = "0x5555555555555555555555555555555555555555"


class FakeHTTP:
    """Records PreparedRequests and answers from a queue of (status, body, headers)."""

    def __init__(self):
        self.calls: list[requests.PreparedRequest] = []
        self.replies: list[tuple] = []

    def reply(self, body, status=200, headers=None):
        self.replies.append((status, body, headers or {}))
        return self

    def send(self, session, request, **kwargs):
        self.calls.append(request)
        status, body, headers = self.replies.pop(0) if self.replies else (200, {}, {})
        r = requests.Response()
        r.status_code = status
        r.headers.update(headers)
        r._content = body.encode() if isinstance(body, str) else json.dumps(body).encode()
        r.request = request
        r.url = request.url
        return r

    # helpers
    def body(self, i=-1):
        return json.loads(self.calls[i].body)

    def path(self, i=-1):
        return urlsplit(self.calls[i].url).path

    def query(self, i=-1):
        return parse_qs(urlsplit(self.calls[i].url).query)


@pytest.fixture(autouse=True)
def http(monkeypatch):
    """Autouse so no test in this module can reach the network."""
    fake = FakeHTTP()
    monkeypatch.setattr(requests.Session, "send", lambda self, req, **kw: fake.send(self, req, **kw))
    return fake


def test_defaults_and_base_normalisation():
    assert AnyGas().base == anygas.DEFAULT_BASE
    assert AnyGas(BASE + "/").base == BASE


def test_default_base_matches_js_clients():
    # Same gateway as anygas-agent-kit, anygas-mcp and anygas-adapters: one URL across every SDK.
    assert anygas.DEFAULT_BASE == "https://api.anygas.xyz/svc"
    assert AnyGas().base == "https://api.anygas.xyz/svc"


def test_default_base_is_used_for_requests(http):
    AnyGas().status()
    assert http.calls[0].url == "https://api.anygas.xyz/svc/api/status"


def test_api_key_header_sent(http):
    AnyGas(BASE, api_key="k-123").status()
    req = http.calls[0]
    assert req.headers["x-anygas-key"] == "k-123"
    assert req.method == "GET"
    assert req.url == BASE + "/api/status"


def test_no_api_key_header_by_default(http):
    AnyGas(BASE).status()
    assert "x-anygas-key" not in http.calls[0].headers


def test_chains_sorted_ints(http):
    http.reply({"gaslessChains": {"8453": {}, "10": {}, "42161": {}}})
    assert AnyGas(BASE).chains() == [10, 8453, 42161]
    assert http.path() == "/svc/api/gasless/info"


@pytest.mark.parametrize("method,path", [
    ("gasless_info", "/api/gasless/info"),
    ("x402_info", "/api/x402/info"),
    ("route_chains", "/api/route/chains"),
    ("errors", "/api/errors"),
])
def test_simple_gets(http, method, path):
    http.reply({"ok": True})
    assert getattr(AnyGas(BASE), method)() == {"ok": True}
    assert http.calls[0].method == "GET"
    assert http.path() == "/svc" + path


def test_quote_uses_fromChain_toChain_amount(http):
    http.reply({"estOut": "1"})
    AnyGas(BASE).quote(from_chain=8453, to_chain=42161, amount=5, slippage=0.01)
    req = http.calls[0]
    assert req.method == "POST"
    assert req.headers["Content-Type"] == "application/json"
    assert http.path() == "/svc/api/route/quote"
    assert http.body() == {"fromChain": 8453, "toChain": 42161, "fromToken": "USDC",
                           "toToken": "USDC", "amount": "5000000", "slippage": 0.01}


@pytest.mark.parametrize("amount,decimals,base", [
    (5, 6, "5000000"),             # the README example: 5 USDC, not 5 micro-USDC
    (1.5, 6, "1500000"),           # fractions are scaled, not rejected by the API
    ("0.1", 6, "100000"),
    (0.000001, 6, "1"),
    (2, 18, "2000000000000000000"),
    (0.3, 18, "300000000000000000"),  # exact: no float drift
])
def test_quote_converts_human_amount_to_base_units(http, amount, decimals, base):
    AnyGas(BASE).quote(8453, 42161, amount, decimals=decimals)
    assert http.body()["amount"] == base


@pytest.mark.parametrize("bad", [0, -1, 0.0000001])
def test_quote_rejects_non_positive_amounts(http, bad):
    with pytest.raises(AnyGasError):
        AnyGas(BASE).quote(8453, 42161, bad)
    assert http.calls == []


def test_agent_do_only_sends_given_fields(http):
    ag = AnyGas(BASE)
    ag.agent_do("send 25 USDC to 0xabc on arbitrum", from_chain=8453)
    ag.agent_do(token="USDC", amount_human=25, to_chain=42161, to_address=RECIPIENT,
                amount="25000000", sandbox=True)
    ag.agent_do()
    assert http.body(0) == {"intent": "send 25 USDC to 0xabc on arbitrum", "fromChain": 8453}
    assert http.body(1) == {"token": "USDC", "amountHuman": 25, "toChain": 42161,
                            "toAddress": RECIPIENT, "amount": "25000000", "sandbox": True}
    assert http.body(2) == {}
    assert all(urlsplit(c.url).path == "/svc/api/agent/do" for c in http.calls)


def test_account_requires_address():
    with pytest.raises(AnyGasError, match="address="):
        AnyGas(BASE).account()


def test_account_by_address(http):
    AnyGas(BASE).account(RECIPIENT)
    assert http.path() == "/svc/api/ncaccount/" + RECIPIENT


def test_account_quote_matches_js_sdk_shape(http):
    AnyGas(BASE).account_quote(8453, 5.0, address=RECIPIENT)
    assert http.path() == "/svc/api/ncaccount/quote"
    assert http.body() == {"agent": RECIPIENT, "srcChain": 8453, "amount": "5000000",
                           "toChain": 8453, "toAddress": RECIPIENT}


def test_account_quote_requires_agent(http):
    with pytest.raises(AnyGasError, match="address="):
        AnyGas(BASE).account_quote(8453, 1.0)


# ---------- error handling ----------

def test_rate_limit_uses_retry_after(http):
    http.reply({"errorCode": "RATE_LIMITED"}, status=429, headers={"retry-after": "12"})
    with pytest.raises(AnyGasError, match="retry after 12s"):
        AnyGas(BASE).status()


def test_http_error_uses_error_field(http):
    http.reply({"errorCode": "NO_ROUTE", "error": "no route found"}, status=422)
    with pytest.raises(AnyGasError, match="no route found"):
        AnyGas(BASE).quote(1, 2, 1)


def test_http_error_with_non_object_body(http):
    http.reply(["bad", "request"], status=400)
    with pytest.raises(AnyGasError, match="bad"):
        AnyGas(BASE).status()


def test_non_json_response(http):
    http.reply("<html>502 Bad Gateway</html>", status=502)
    with pytest.raises(AnyGasError, match=r"non-JSON response \(502\)"):
        AnyGas(BASE).status()


# ---------- signing ----------

eth_account = pytest.importorskip("eth_account")


def test_sign_spend_requires_key():
    with pytest.raises(AnyGasError, match="private_key"):
        AnyGas(BASE).sign_spend(8453, 1.0, 8453, RECIPIENT)


def test_sign_spend_recovers_to_signer():
    from eth_account import Account
    from eth_account.messages import encode_typed_data

    acct = Account.create()
    ag = AnyGas(BASE, private_key=acct.key.hex())
    signed = ag.sign_spend(8453, 1.25, 42161, RECIPIENT)
    intent = signed["intent"]
    assert intent["agent"] == acct.address
    assert intent["amount"] == "1250000"
    assert intent["srcChain"] == 8453 and intent["toChain"] == 42161
    assert int(intent["deadline"]) > time.time()
    assert signed["signature"].startswith("0x") and len(signed["signature"]) == 132

    typed = {
        "types": {"EIP712Domain": [
            {"name": "name", "type": "string"}, {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"}], **anygas._SPEND_TYPES},
        "primaryType": "Spend",
        "domain": {"name": "RobynNCAccount", "version": "1", "chainId": 8453},
        "message": {**intent, "amount": int(intent["amount"]), "nonce": int(intent["nonce"]),
                    "deadline": int(intent["deadline"])},
    }
    recovered = Account.recover_message(encode_typed_data(full_message=typed), signature=signed["signature"])
    assert recovered == acct.address


def test_account_defaults_to_signer_address(http):
    from eth_account import Account

    acct = Account.create()
    ag = AnyGas(BASE, private_key=acct.key.hex())
    ag.account()
    ag.account_quote(10, 2.0, to_chain=8453)
    assert http.path(0) == "/svc/api/ncaccount/" + acct.address
    assert http.body(1) == {"agent": acct.address, "srcChain": 10, "amount": "2000000",
                            "toChain": 8453, "toAddress": acct.address}


def test_spend_posts_signed_intent(http):
    from eth_account import Account

    ag = AnyGas(BASE, private_key=Account.create().key.hex())
    signed = ag.sign_spend(8453, 1.0, 8453, RECIPIENT)
    ag.spend(signed)
    ag.spend(signed, live=True)
    assert http.path(0) == "/svc/api/ncaccount/spend"
    assert http.body(0) == {**signed, "live": False}
    assert http.body(1)["live"] is True
