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
2. `server.json`
3. `src/config.ts` (`SERVER_VERSION`)
4. `CHANGELOG.md`

The publish workflow fails if those three version strings disagree, or if a GitHub Release tag is not `v` + package version.

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
3. `publish.yml` builds, validates versions, and publishes (trusted publishing / `NPM_TOKEN` as configured).

### Manual

```bash
npm login
npm publish --access public
```

`prepublishOnly` runs `clean`, `build`, and `test` before upload.

## Configuration variables

| Variable | Notes |
|----------|--------|
| `OP_SERVICE_ACCOUNT_TOKEN` | Primary auth. Required unless macOS Keychain fallback is used. |
| `OP_KEYCHAIN_SERVICE` | macOS only: Keychain service name for the token. |
| `OP_KEYCHAIN_ACCOUNT` | macOS only: optional account for Keychain lookup. |
| `OP_MCP_ALLOWED_VAULTS` | Optional comma-separated vault names/IDs for `op_run` / `op_check_ref`. |
| `OP_INTEGRATION_NAME` | Optional; default `1password-mcp`. |
| `OP_INTEGRATION_VERSION` | Optional; default `SERVER_VERSION`. |
| `MCP_LOG_LEVEL` | Optional: `debug`, `info`, `warn`, `error` (default `info`). |
| `MCP_DEBUG` | Optional; if set, forces debug logging. |

CLI equivalents: `--service-account-token` / `--token`, `--log-level`, `--integration-name`, `--integration-version`, `--allowed-vaults`.

## Public surface (keep docs in sync)

When tools, prompts, or resources change, update **README.md** (npm’s face), **CHANGELOG.md**, and this file’s mental model:

- **15 tools:** `vault_list`, `item_lookup`, `item_list`, `item_get`, `item_edit`, `item_delete`, `item_archive`, `note_create`, `password_create`, `password_read`, `password_update`, `password_generate`, `password_generate_memorable`, `op_run`, `op_check_ref`
- **4 prompts:** `generate-secure-password`, `credential-rotation`, `vault-audit`, `secret-reference-helper`
- **3 resources:** `1password://config`, `1password://vaults`, `1password://vaults/{vaultId}/items`
- **Protocol:** MCP SDK v2, stdio negotiation for **2026-07-28** + legacy clients

## Agent security conventions

- Prefer `op_run` + `op://` over `reveal: true`.
- Prefer `op_check_ref` over revealing just to validate a path.
- Default create/update responses should not echo secrets (`returnSecret` / `reveal` opt-in).
- Never commit tokens or MCP configs containing secrets.

## CI/CD

- `ci.yml` — build/test on push and PRs to `master`.
- `publish.yml` — npm publish on GitHub Release / manual dispatch.
- Registry package name: `io.github.CakeRepository/1password` (`mcpName` / `server.json`).
