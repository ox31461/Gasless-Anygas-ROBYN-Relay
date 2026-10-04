# Changelog

## 1.1.0 - 2026-10-04
- Non-JSON service responses (proxy error pages, outages) raise
  `Robyn service returned non-JSON (HTTP <status>): ...` instead of a bare `SyntaxError`. JSON error
  bodies (`errorCode` / `error`) are still returned as data so callers can branch on `errorCode`.
- JSR: each entry point now points at its `.d.ts` via `@ts-self-types`, so JSR serves the shipped
  declarations instead of inferring types from JavaScript.
- Add an offline test suite (`npm test`).

## 1.0.4
- Last release before this changelog was started.
