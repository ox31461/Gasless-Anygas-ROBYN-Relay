# Changelog

## 0.2.0 - 2026-10-04
- **Breaking:** `quote()` now takes `amount` in human units of `from_token` (`5` = 5 USDC) and scales it
  by `decimals` (default 6; pass 18 for most other ERC-20s). The API reads base units, so previously
  `quote(amount=5)` priced 0.000005 USDC and fractional amounts failed.
- `account_quote()` sends the same request as the JS SDK and MCP server (`agent`, `srcChain`, `amount`
  in USDC base units, `toChain`, `toAddress`). `agent` defaults to the `private_key` address; pass
  `address=` for read-only use. New optional `to_chain` / `to_address`.
- `account_quote()` and `sign_spend()` convert amounts with exact `Decimal` arithmetic (no float drift).
- Error responses whose JSON body is not an object raise `AnyGasError` instead of `AttributeError`.
- Add an offline pytest suite and a `[test]` extra.

## 0.1.0
- First release from this repository.
