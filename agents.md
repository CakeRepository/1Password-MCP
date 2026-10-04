# Publishing Guide for Agents

Steps for building, versioning, and publishing `@takescake/1password-mcp`.

## Versioning

Follow [Semantic Versioning](https://semver.org/).

| Bump | When |
|------|------|
| **Patch** (`4.0.x`) | Bug fixes, docs, minor security hardening |
| **Minor** (`4.x.0`) | New tools, prompts, resources, or non-breaking features |
| **Major** (`x.0.0`) | Breaking MCP tool schemas, required Node upgrades, or core architecture changes |

Update the version in **all** of:

1. `package.json`
2. `package-lock.json` (root `version` and `packages[""].version`)
3. `server.json` (top-level `version` and `packages[0].version`)
4. `src/config.ts` (`SERVER_VERSION`)
5. `CHANGELOG.md`

The publish workflow fails if the `package.json`, `server.json`, and `src/config.ts` versions disagree (it does not check the lockfile or changelog), or if a GitHub Release tag is not `v` + package version.

## Build and validation

Always run the full suite before publishing:

```bash
npm run clean
npm ci
npm run build
npm run lint
npm test
```

Runtime requirement: **Node.js ≥ 20**.

## Publishing to npm

### Automated (recommended)

1. Merge version + changelog to `master`.
2. Create a GitHub Release on `master` with tag `vX.Y.Z`.
3. `publish.yml` runs two jobs (see CI/CD): `build` installs, validates versions and the tag, builds, tests, and packs the tarball with no OIDC access; `publish` then publishes that tarball via npm trusted publishing (OIDC, no `NPM_TOKEN`).

### Manual

```bash
npm login
npm publish --access public
```

`prepublishOnly` runs `clean`, `build`, and `test` before a manual `npm publish`. The automated workflow publishes a prebuilt tarball (`npm publish ./package.tgz --ignore-scripts`), which skips lifecycle scripts, so its `build` job runs build and test instead.

## Configuration variables

| Variable | Notes |
|----------|--------|
| `OP_SERVICE_ACCOUNT_TOKEN` | Primary auth. Required unless macOS Keychain fallback is used. |
| `OP_KEYCHAIN_SERVICE` | macOS only: Keychain service name for the token. |
| `OP_KEYCHAIN_ACCOUNT` | macOS only: optional account for Keychain lookup. |
| `OP_MCP_ALLOWED_VAULTS` | Optional comma-separated vault names/IDs (case-insensitive). Enforced server-wide by every tool and resource that touches a vault; tools that take a `vaultId` need an ID. |
| `OP_INTEGRATION_NAME` | Optional; default `1password-mcp`. |
| `OP_INTEGRATION_VERSION` | Optional; default `SERVER_VERSION`. |
| `MCP_LOG_LEVEL` | Optional: `debug`, `info`, `warn`, `error` (default `info`). |
| `MCP_DEBUG` | Optional; if set, forces debug logging. |

CLI equivalents: `--service-account-token` / `--token`, `--log-level`, `--integration-name`, `--integration-version`, `--allowed-vaults`. Avoid the token flags: argv is visible to other local processes, and the server logs a warning at startup.

## Public surface (keep docs in sync)

When tools, prompts, or resources change, update **README.md** (npm’s face), **CHANGELOG.md**, and this file’s mental model:

- **15 tools:** `vault_list`, `item_lookup`, `item_list`, `item_get`, `item_edit`, `item_delete`, `item_archive`, `note_create`, `password_create`, `password_read`, `password_update`, `password_generate`, `password_generate_memorable`, `op_run`, `op_check_ref`
- **4 prompts:** `generate-secure-password`, `credential-rotation`, `vault-audit`, `secret-reference-helper`
- **3 resources:** `onepassword://config`, `onepassword://vaults`, and the `ResourceTemplate` `onepassword://vaults/{vaultId}/items`. The SDK parses every read URI with `new URL()`, so a scheme must start with a letter (never `1password://`), and parameterized URIs must be registered as a `ResourceTemplate`. `tests/resources.e2e.test.ts` reads every advertised resource through a real client to catch both mistakes.
- **Protocol:** MCP SDK v2, stdio negotiation for **2026-07-28** + legacy clients

## Agent security conventions

- Prefer `op_run` + `op://` over `reveal: true`.
- Prefer `op_check_ref` over revealing just to validate a path.
- Default create/update responses should not echo secrets (`returnSecret` / `reveal` opt-in).
- The vault allow-list is server-wide: any new tool or resource that touches a vault must go through `src/vault-access.ts` (`assertVaultIdAllowed` / `filterAllowedVaults`).
- `op_run` redaction is best effort, not a sandbox: don't run untrusted commands with injected secrets.
- `item_get` returns notes as-is, so don't store secrets in notes.
- Never commit tokens or MCP configs containing secrets.

## CI/CD

- `ci.yml` — build/test on push and PRs to `master`.
- `publish.yml` — npm publish on GitHub Release / manual dispatch, as two jobs:
  - `build` (`contents: read`, no OIDC): `npm ci --ignore-scripts` (no dependency install scripts), version and tag validation, build, test, then `npm pack --ignore-scripts` into `package.tgz`, uploaded as the `npm-package` artifact.
  - `publish` (`needs: build`): the only job with `id-token: write`. It never checks out the repo or installs dependencies; it downloads the tarball and runs `npm publish ./package.tgz --access public --ignore-scripts` (skipped if that version is already on npm).
  - Keep it that way: dependency code must never run in a job that holds `id-token: write`. npm's trusted-publisher config is bound to the file name `publish.yml`, so don't rename it.
- Workflow hygiene: pass `${{ ... }}` values to scripts through `env:` instead of interpolating them into `run:`, check out with `persist-credentials: false`, and don't add `issue_comment`-triggered or write-scoped one-off runner workflows (the leftover `mcp-v2-migration.yml` was removed in 5.0.0 for that reason).
- Registry package name: `io.github.CakeRepository/1password` (`mcpName` / `server.json`).
