# Contributing

Thanks for your interest in Robyn. This repo hosts the **open (MIT) client packages** — `@anygas/agent-kit`, `@anygas/mcp`, and `@anygas/adapters` on JSR (`anygas-*` on npm), plus the `anygas` Python SDK — and docs. Contributions that make integrating Robyn easier are very welcome.

`@robyn/*` is the legacy JSR scope (stopped at 1.0.x). New docs and examples should use `@anygas/*`; a test in `packages/agent-kit/test/docs-scope.test.mjs` fails if a stale scope name creeps back into the Markdown.

## Good contributions

- Bug fixes and clarity improvements in the client packages.
- New framework adapters (built on `packages/adapters/core.mjs`).
- Docs, examples, and integration guides.
- Better types, error messages, and DX.

## Scope

These packages are **clients** for the hosted Robyn service. The relayer, smart contracts, and network are proprietary and out of scope for this repo — see [NOTICE](./NOTICE). Please don't send changes that assume, replicate, or reverse-engineer the server side.

## Before you open a PR

- Keep changes focused and small where possible.
- Match the existing style — these are dependency-light ESM modules (ethers v6, zod).
- Never commit secrets. No keys, `.env` files, or tokens. The signer only ever signs; nothing in this repo should contain private key material.
- Note which package(s) you touched and how you tested.

## Running the tests

The suites are fully offline (HTTP is mocked; signatures use throwaway random wallets). CI runs them on
every push and pull request.

```bash
# JS packages (Node >= 18): agent-kit, mcp, adapters
cd packages/agent-kit && npm install && npm test   # agent-kit also runs the docs scope check

# Python SDK
cd sdk-python && pip install -e ".[test]" && pytest
```

## Reporting issues

Open an issue with a minimal repro: the package + version, the call you made, what you expected, and what happened. For anything security-sensitive, please disclose privately rather than in a public issue.

## Releases

Maintainers: see [RELEASING.md](./RELEASING.md). Releases are tag-triggered (`agent-kit-v*`, `mcp-v*`,
`adapters-v*`, `python-v*`).
