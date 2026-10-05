# Releasing

Releases are cut by pushing a tag. [`.github/workflows/release.yml`](.github/workflows/release.yml)
publishes **one package per tag**, after checking the version and running that package's tests.

| Tag | Package directory | Publishes to |
|---|---|---|
| `agent-kit-vX.Y.Z` | `packages/agent-kit` | JSR `@anygas/agent-kit` + npm `anygas-agent-kit` |
| `mcp-vX.Y.Z` | `packages/mcp` | JSR `@anygas/mcp` + npm `anygas-mcp` |
| `adapters-vX.Y.Z` | `packages/adapters` | JSR `@anygas/adapters` |
| `python-vX.Y.Z` | `sdk-python` | PyPI `anygas` |

The packages are versioned independently, which is why there is one tag prefix per package rather
than a single `v*` tag. Package names come from each package's `jsr.json`, `package.json` and
`pyproject.toml`. Those files are the source of truth, not this table.

> adapters goes to JSR only. To publish it to npm as `anygas-adapters` as well, set `npm=true` for
> `adapters-v*` in the workflow's `resolve` job. Earlier versions, up to 1.0.4, are on npm.

## One-time setup

### JSR (no secret, uses GitHub OIDC)

For **each** of `@anygas/agent-kit`, `@anygas/mcp` and `@anygas/adapters`:

1. Sign in at <https://jsr.io> as a member of the `@anygas` scope with admin rights.
2. Open the package, go to **Settings → GitHub Repository**, and link `ox31461/Gasless-Anygas-ROBYN-Relay`.

The workflow job has `id-token: write`, and `npx jsr publish` uses it automatically. If a package
is not linked, the publish fails with an authorization error.

### npm (`NPM_TOKEN` secret)

1. On <https://www.npmjs.com>, signed in as an account that can publish `anygas-agent-kit` and
   `anygas-mcp`, create an access token: **Access Tokens → Generate New Token → Granular Access Token**.
   Give it **Read and write** on those two packages (add `anygas-adapters` if you enable it).
   If the account enforces 2FA for publishing, allow the token to bypass 2FA, or use an Automation
   token. CI cannot answer an OTP prompt.
2. In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**, name it
   `NPM_TOKEN`, and paste the token.

npm provenance (`--provenance`) needs no further setup. It relies on the `repository` field in each
`package.json`, which already points at this repo.

### PyPI (trusted publishing, no secret)

1. In GitHub, go to **Settings → Environments → New environment**, name it **`pypi`**. Optionally add
   required reviewers so each PyPI upload waits for approval.
2. On <https://pypi.org>, signed in as an owner of `anygas`, open **Your projects → anygas → Manage →
   Publishing → Add a new publisher → GitHub**. If the project does not exist yet, use
   **Your account → Publishing → Add a pending publisher** instead. Enter exactly:

   | Field | Value |
   |---|---|
   | Owner | `ox31461` |
   | Repository name | `Gasless-Anygas-ROBYN-Relay` |
   | Workflow name | `release.yml` |
   | Environment name | `pypi` |

## Cutting a release

1. Make sure CI on `main` is green.
2. For each package you are releasing, on a branch that you then merge to `main`:
   - Bump the version. **JS:** `package.json` and `jsr.json` must match. **Python:** `version` in
     `sdk-python/pyproject.toml` and `__version__` in `sdk-python/src/anygas/__init__.py` must match.
   - In the package's `CHANGELOG.md`, rename `## Unreleased` to `## X.Y.Z - YYYY-MM-DD`.
3. Tag the merge commit on `main` and push the tag. Use one tag per package:

   ```bash
   git checkout main && git pull
   git tag agent-kit-v1.3.0
   git tag mcp-v1.3.0
   git tag adapters-v1.1.0
   git tag python-v0.2.0
   git push origin agent-kit-v1.3.0 mcp-v1.3.0 adapters-v1.1.0 python-v0.2.0
   ```

4. Watch **Actions → Release**. Each tag gets its own run.
   - JS jobs run in this order: version guard → `npm install` → `npm test` → `npm pack --dry-run`,
     `jsr publish --dry-run`, `npm publish --dry-run` → `jsr publish` → `npm publish`.
   - Python runs version guard → `pytest` → `python -m build` → `twine check`. A separate job then
     uploads to PyPI from the `pypi` environment.

If the guard fails, the tag does not match the version files. Delete the tag
(`git push --delete origin <tag>; git tag -d <tag>`), fix the files, and tag again. Registries do not
accept the same version twice. If a publish step fails after another registry already accepted the
version, re-run only the failed job, or publish the missing registry by hand.
`packages/PUBLISH.sh` is the manual npm fallback.

## Verification checklist

After the runs are green:

- [ ] JSR: `https://jsr.io/@anygas/<pkg>` shows the new version, the **provenance** badge, and a
      full score, including "has types". Check `npx jsr add @anygas/<pkg>` in a scratch project.
- [ ] npm: `npm view anygas-agent-kit version` and `npm view anygas-mcp version` print the new
      versions. The npmjs.com package page shows **Provenance**, and `dist-tags.latest` is the
      new version (`npm view <pkg> dist-tags`).
- [ ] `npx -y anygas-mcp` starts and logs `robyn-mcp connected ... (read-only)` (the log line keeps the legacy name).
- [ ] PyPI: `https://pypi.org/project/anygas/` shows the new version. Run
      `pip install anygas==X.Y.Z` in a fresh venv, then
      `python -c "import anygas; print(anygas.__version__)"`.
- [ ] The sdist and wheel both contain `LICENSE` and `NOTICE`.
- [ ] Optionally, create a GitHub Release for each tag and paste the changelog section into it.

## Before the first release from this workflow, check

- **Registry versions already ahead of this repo.** npm and JSR already have `anygas-mcp` /
  `@anygas/mcp` **1.6.0**, and PyPI already has `anygas` **1.0.0**. Publishing a lower version is
  allowed, but JSR and pip still resolve to the higher one. npm moves `latest` to whatever was
  published last. Either choose versions above those, or publish with an explicit dist-tag.
- **JSR scope in the docs.** `jsr.json` publishes under `@anygas/*`; README.md, `docs/` and
  CONTRIBUTING.md now say `@anygas/*` too. `@robyn/*` is the legacy scope (stopped at 1.0.1) and
  `packages/agent-kit/test/docs-scope.test.mjs` fails if it comes back outside a "legacy" note.
- **sdk-python README** says this SDK is not on PyPI yet and that the `anygas` name there is an older,
  different client. Update it once a release of *this* SDK is live on PyPI.

## Downgrade guard, and two packages whose published source lives elsewhere

Every publish job first runs `.github/scripts/no-downgrade.mjs`. It refuses any version that isn't strictly
newer than what JSR, npm or PyPI already serve, so a stale tag can never move `latest` backwards.

As of 2026-10-04 the guard blocks two packages, and that's deliberate:

| Package | Already published | Where that published code lives |
|---|---|---|
| `anygas-mcp` / `@anygas/mcp` | **1.6.0** (87 hosted tools) | `ox31461/nullchat` `master`: `packages/anygas-mcp/`, registry `_box/mcp-tools.mjs` |
| `anygas` (PyPI) | **1.0.0** (`Robyn` client, `client.py`) | not in this repo; `sdk-python/` here is a different, smaller API |

Don't release `packages/mcp` or `sdk-python` from this repo until whoever owns the code decides between two options:

1. Make the code here the real source of truth: port the published code in, then version above the registry.
2. Retire these copies: point users at the published packages instead.

`agent-kit` (npm 1.1.0, JSR 1.0.4) and `adapters` (JSR 1.0.4) are behind this repo, so they're safe to release.
