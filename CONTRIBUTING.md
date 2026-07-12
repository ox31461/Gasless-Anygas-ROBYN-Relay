# Contributing

Thanks for your interest in Robyn. This repo hosts the **open (MIT) client packages** — `@robyn/agent-kit`, `@robyn/mcp`, and `@robyn/adapters` — plus docs. Contributions that make integrating Robyn easier are very welcome.

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

## Reporting issues

Open an issue with a minimal repro: the package + version, the call you made, what you expected, and what happened. For anything security-sensitive, please disclose privately rather than in a public issue.
