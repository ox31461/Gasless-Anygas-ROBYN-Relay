"""AnyGas Python SDK — gasless cross-chain routing + yield-native gasless spending for AI agents.

Python twin of the anygas-agent-kit npm package. API surface mirrors https://anygas.xyz/openapi.json.
"""
from __future__ import annotations

import time
from typing import Any, Optional

import requests

__version__ = "0.1.0"
DEFAULT_BASE = "https://anygas.xyz/svc"

_SPEND_TYPES = {
    "Spend": [
        {"name": "agent", "type": "address"},
        {"name": "srcChain", "type": "uint256"},
        {"name": "amount", "type": "uint256"},
        {"name": "toChain", "type": "uint256"},
        {"name": "toAddress", "type": "address"},
        {"name": "nonce", "type": "uint256"},
        {"name": "deadline", "type": "uint256"},
    ]
}


class AnyGasError(RuntimeError):
    pass


class AnyGas:
    """Client for the AnyGas gasless routing + non-custodial yield-account API."""

    def __init__(self, base_url: str = DEFAULT_BASE, private_key: Optional[str] = None,
                 api_key: Optional[str] = None, timeout: float = 30.0):
        self.base = base_url.rstrip("/")
        self.timeout = timeout
        self._s = requests.Session()
        if api_key:
            self._s.headers["x-anygas-key"] = api_key
        self._acct = None
        if private_key:
            try:
                from eth_account import Account
            except ImportError as e:  # pragma: no cover
                raise AnyGasError("pip install anygas[signing] for spend-intent signing") from e
            self._acct = Account.from_key(private_key)

    # ---------- HTTP ----------
    def _get(self, path: str, **params: Any) -> Any:
        r = self._s.get(self.base + path, params=params or None, timeout=self.timeout)
        return self._out(r)

    def _post(self, path: str, body: dict) -> Any:
        r = self._s.post(self.base + path, json=body, timeout=self.timeout)
        return self._out(r)

    @staticmethod
    def _out(r: requests.Response) -> Any:
        if r.status_code == 429:
            raise AnyGasError(f"rate limited; retry after {r.headers.get('retry-after', '30')}s")
        try:
            j = r.json()
        except ValueError as e:
            raise AnyGasError(f"non-JSON response ({r.status_code})") from e
        if r.status_code >= 400:
            raise AnyGasError(str(j.get("error") or j))
        return j

    # ---------- discovery / status ----------
    def status(self) -> dict:
        return self._get("/api/status")

    def gasless_info(self) -> dict:
        """Router + paymaster addresses and the full gasless chain map."""
        return self._get("/api/gasless/info")

    def chains(self) -> list[int]:
        return sorted(int(c) for c in self.gasless_info().get("gaslessChains", {}))

    def x402_info(self) -> dict:
        """Per-call payment support (x402 / HTTP 402, USDC on Base)."""
        return self._get("/api/x402/info")

    # ---------- routing ----------
    def route_chains(self) -> dict:
        return self._get("/api/route/chains")

    def quote(self, from_chain: int, to_chain: int, amount: float,
              from_token: str = "USDC", to_token: str = "USDC", **kw: Any) -> dict:
        """Best cross-chain gasless route (best-of-4 bridge aggregators)."""
        return self._post("/api/route/quote", {"fromChain": from_chain, "toChain": to_chain,
                                               "fromToken": from_token, "toToken": to_token,
                                               "amount": amount, **kw})

    # ---------- non-custodial yield account ----------
    def account(self, address: Optional[str] = None) -> dict:
        addr = address or (self._acct.address if self._acct else None)
        if not addr:
            raise AnyGasError("pass address= or construct AnyGas(private_key=...)")
        return self._get(f"/api/ncaccount/{addr}")

    def account_quote(self, src_chain: int, amount_usd: float) -> dict:
        return self._post("/api/ncaccount/quote", {"srcChain": src_chain, "amountUsd": amount_usd})

    def sign_spend(self, src_chain: int, amount_usd: float, to_chain: int, to_address: str,
                   deadline_s: int = 3600) -> dict:
        """Sign an EIP-712 spend intent with the agent's own key (funds stay non-custodial)."""
        if not self._acct:
            raise AnyGasError("construct AnyGas(private_key=...) to sign spend intents")
        from eth_account.messages import encode_typed_data

        intent = {
            "agent": self._acct.address,
            "srcChain": src_chain,
            "amount": str(int(round(amount_usd * 1e6))),
            "toChain": to_chain,
            "toAddress": to_address,
            "nonce": str(int(time.time() * 1000)),
            "deadline": str(int(time.time()) + deadline_s),
        }
        typed = {
            "types": {"EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
            ], **_SPEND_TYPES},
            "primaryType": "Spend",
            "domain": {"name": "RobynNCAccount", "version": "1", "chainId": src_chain},
            "message": {**intent, "srcChain": int(src_chain), "amount": int(intent["amount"]),
                        "toChain": int(to_chain), "nonce": int(intent["nonce"]),
                        "deadline": int(intent["deadline"])},
        }
        signed = self._acct.sign_message(encode_typed_data(full_message=typed))
        return {"intent": intent, "signature": "0x" + signed.signature.hex().removeprefix("0x")}

    def spend(self, signed_intent: dict, live: bool = False) -> dict:
        """Submit a signed spend intent. live=False returns a DRY preview."""
        return self._post("/api/ncaccount/spend", {**signed_intent, "live": live})
