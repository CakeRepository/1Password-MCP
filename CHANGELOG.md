# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.4] - 2026-10-04

### Security

- **`item_get` no longer returns secrets held in non-`Concealed` fields** — Only `Concealed` fields were masked, so SSH private keys, one-time-password (TOTP) seeds, and card numbers came back in plaintext without `reveal: true`. Masking is now deny-by-default: only known non-secret field types (text, URL, email, phone, date, month/year, menu, card type, address, reference) are shown, and every other type, including any added by future SDK versions, needs `reveal: true`. Notes are still returned as-is, matching `op item get`; don't keep secrets in the notes of vaults an agent can read.
- **Vault allow-list is now enforced server-wide** — `OP_MCP_ALLOWED_VAULTS` / `--allowed-vaults` only covered `op_run` and `op_check_ref`, and only compared the vault segment as written in an `op://` reference. It now applies to every tool and resource that touches a vault: `vault_list` and `1password://vaults` are filtered, and vault IDs are checked before anything is returned or modified. `op://` references are checked both as written and by the vault they actually resolve to. It fails closed if vaults can't be listed.
- **`op_run` redaction no longer leaks the remainder of overlapping secrets** — Redaction now masks every occurrence of every secret in a single pass over the original output, so overlapping or nested secrets can't leak: a username that is a prefix of a credential string is no longer replaced first, leaving the password visible. It also masks common encodings of each secret: base64 (including inside a larger base64 payload such as an HTTP Basic auth header), JSON-escaped and URL-encoded forms, and multi-line secrets line by line and with CRLF line endings.
- **`op_run` output cap no longer exhausts memory** — The 5 MiB per-stream cap is now applied while the command runs. Excess output is discarded instead of buffered, which fixes a memory-exhaustion crash, and a secret cut off at the cap never survives as a partial prefix.
- **`op_run` timeouts kill the whole process tree** — On timeout the process group (POSIX) or process tree via `taskkill /T` (Windows) is killed, and `op_run` always returns shortly afterwards, even if a background process holds the output pipes. Previously it could hang forever and leave processes running with injected secrets.
- **Case-insensitive credential scrub in `op_run`** — The server's own credential variables (`OP_SERVICE_ACCOUNT_TOKEN`, `OP_KEYCHAIN_SERVICE`, `OP_KEYCHAIN_ACCOUNT`) are now stripped from the child environment regardless of letter case.
- **Removed a leftover CI workflow and hardened publishing** — The one-time `mcp-v2-migration.yml` is deleted: any GitHub user could trigger it with a PR comment, and it ran `npm install` with a write-scoped token. `publish.yml` no longer interpolates the release tag into shell, checkouts no longer persist credentials, and publishing is split into two jobs: build, test, and pack run without OIDC access (and without dependency install scripts), and a separate job that alone has `id-token: write` publishes the prebuilt tarball with `--ignore-scripts`.
- **macOS Keychain lookup uses an absolute path** — The token lookup runs `/usr/bin/security` instead of resolving `security` through `PATH`, so a binary planted earlier on `PATH` can't hand the server an attacker-chosen service account token.
- **Warning when the token is passed on the command line** — `--service-account-token` / `--token` put the token in the process arguments, which other local processes (including commands run through `op_run`) can read. The server now logs a startup warning; prefer `OP_SERVICE_ACCOUNT_TOKEN` or, on macOS, the Keychain.
- All of the above came out of an internal security review.

### Changed

- **Behavior change: the vault allow-list is server-wide** — If you set `OP_MCP_ALLOWED_VAULTS` / `--allowed-vaults` expecting it to affect only `op_run` and `op_check_ref`, it now restricts every tool and resource. Tools that take a `vaultId` need the vault's ID, not its name. With an allow-list set, each guarded call makes one extra `vaults.list` read (mind service account rate limits). It is defense in depth; scope the service account's own vault access in 1Password first.
- **`item_get` hides more by default** — SSH private keys, OTP seeds, and card numbers now show `[concealed]` unless you pass `reveal: true`.
- **Stricter `op://` validation** — Malformed references passed to `item_get` and `password_read` are now rejected locally with a clear error.
- **More candid `op_run` description** — The tool description no longer claims plaintext is "NEVER" returned. Redaction is best effort and protects against accidental disclosure; it is not a sandbox, because a command can deliberately transform or transmit a secret it was given.
- **Publishing** — `prepublishOnly` now only matters for manual `npm publish`; the automated workflow publishes a prebuilt tarball.
- **Documentation** — README, CONTRIBUTING, and agents.md cover the server-wide allow-list, best-effort redaction, unconcealed notes, and the two-job publish workflow.

## [4.0.3] - 2026-10-04

### Security

- **Dev dependency updates** — Upgraded `vitest` to `^4.1.11`, which pulls in patched `@vitest/mocker`, `vite`, `postcss`, `nanoid`, and `picomatch` and drops `rollup`. Resolves all open Dependabot alerts. Dev-only; runtime dependencies are unchanged.

### Added

- **`SECURITY.md`** — Vulnerabilities are reported publicly through GitHub issues so anyone can review and help fix them. Covers what to include, redacting real tokens, and how fixes are released and credited.

### Changed

- **CI matrix** — Test on Node 20, 22, and 24 (dropped Node 18, which `engines` already excludes).

## [4.0.2] - 2026-08-31

### Security

- **Fixed service account token leak in `op_run`** — `op_run` now strips the MCP server's credentials (`OP_SERVICE_ACCOUNT_TOKEN`, `OP_KEYCHAIN_SERVICE`, `OP_KEYCHAIN_ACCOUNT`) from the child process environment before execution, preventing ambient token leakage to subprocesses.
- **Defense-in-depth output redaction** — Added the server's master service account token to the output redaction targets so any ambient or direct echoing in stdout, stderr, spawn errors, or thrown exceptions is masked with `«REDACTED:OP_SERVICE_ACCOUNT_TOKEN»`.
- **Boundary-safe secret redaction** — Full redaction is now applied prior to output truncation, preventing secret values that straddle the 5 MiB stream cap from surviving as partial unredacted substrings.
- Thanks to independent security researcher **Syed Anas Mohiuddin** for responsibly discovering, analyzing, and reporting this vulnerability.

## [4.0.1] - 2026-07-29

### Changed

- **Documentation** — Rewrote README, CONTRIBUTING, and AGENTS for v4: all 15 tools, prompts, resources, `op_run` / reveal guidance, MCP **2026-07-28**, Node ≥ 20, and clearer setup for humans and agents.
- **Package metadata** — Clearer npm/registry description, keywords, and `server.json` environment variable docs (`OP_MCP_ALLOWED_VAULTS`, `MCP_LOG_LEVEL`).

## [4.0.0] - 2026-07-29

### Changed

- Migrated to the stable MCP TypeScript SDK v2 package family.
- Added stdio negotiation for MCP 2026-07-28 while retaining legacy client compatibility.
- Raised the minimum supported Node.js version from 18 to 20.
- Migrated tools, prompts, and resources to the v2 registration APIs and Zod 4 schemas.

## [3.0.0] - 2026-07-29

### Added

- **`op_run` tool** — Run local commands with `op://` secret references injected into child-process environment variables without returning plaintext secret values to the model. Resolved values are redacted from command output and errors.
- **`op_check_ref` tool** — Validate a 1Password secret reference and return only non-secret metadata.
- **Optional vault allow-list** — Restrict `op_run` and `op_check_ref` to configured vault names or IDs with `OP_MCP_ALLOWED_VAULTS` or `--allowed-vaults`.

### Changed

- **Breaking: `password_read` is metadata-only by default** — Callers must now pass `reveal: true` to receive a plaintext secret value.
- Updated `password_read` and `item_get` tool guidance to prefer `op_run` when a secret needs to be used rather than revealed.
- `op_run` resolves multiple secret environment references in one bulk SDK request.

### Security

- Reduced accidental secret exposure in model context and conversation transcripts by making explicit plaintext reveal opt-in.

## [2.5.0] - 2026-07-04

### Added

- **`item_get` tool** — Retrieve detailed information for a 1Password item, including tags, fields, website URLs, and notes. Concealed field values are hidden unless explicitly revealed. Supports secret references (`op://vault/item/field`) or vault and item IDs.
- **`item_edit` tool** — Edit an existing 1Password item, updating titles, notes, tags, website URL, and upserting or removing fields.
- **`item_list` tool** — List all items in a 1Password vault (returns metadata like ID, title, category, tags, and updatedAt).
- **`item_archive` tool** — Move a 1Password item to the archive instead of permanently deleting it.
- **`note_create` tool** — Create a Secure Note item with optional custom fields and tags.

### Fixed

- **Tool Schema Documentation Alignment** — Updated parameter and tool descriptions for `item_get` and `note_create` to ensure the correct formats (e.g. `op://vault/item/field` for secret reference) and parameter descriptions (`id or title` for custom fields) are properly surfaced in MCP.

## [2.4.2] - 2026-04-25

### Fixed

- **`password_update` field matching** — The `password_update` tool now correctly finds the field to update by matching against the field's `id`, `title`, or `label`. Previously, it only matched against `id` and `title`.

### Changed

- **Publish workflow hardening** — Publish now runs on releases/manual dispatch, validates cross-file version alignment, validates release tag/version match, and skips if the npm version already exists.

## [2.4.1] - 2026-03-15

### Changed

- **CI/CD Automation** — Enabled automated NPM publishing on push to `master` branch.

## [2.4.0] - 2026-03-15

### Fixed

- **Server version alignment** — Fixed a mismatch where the runtime MCP server reported a different version than `package.json`.
- **Security: SDK upgrade** — Upgraded `@modelcontextprotocol/sdk` to v1.26.0 to address GHSA-345p-7cg4-v4c7.

### Added

- **Agents guide** — Created `agents.md` with instructions for publishing and managing the server.

### Changed

- **CI/CD Pipeline** — Updated GitHub Actions to correctly target the `master` branch.

## [2.0.0] - 2026-02-06

### Added

- **TypeScript** — Full conversion from JavaScript to strict TypeScript with declarations.
- **Modular architecture** — Split single-file server into logical modules (`logger`, `config`, `client`, `tools/`, `prompts/`, `resources/`).
- **MCP Prompts** — Added 4 interactive prompts: `generate-secure-password`, `credential-rotation`, `vault-audit`, `secret-reference-helper`.
- **MCP Resources** — Added browsable resources: `1password://vaults`, `1password://vaults/{vaultId}/items`, `1password://config`.
- **Tool descriptions** — All tools now include human-readable descriptions for better LLM tool selection.
- **`item_delete` tool** — Complete CRUD: create, read, update, and delete items.
- **`isError` flag** — All error responses now set the MCP `isError: true` flag for protocol compliance.
- **Expanded word list** — `password_generate_memorable` uses ~500 words (EFF-inspired) for better entropy.
- **Rejection sampling** — `password_generate` uses unbiased random character selection.
- **Unit tests** — Comprehensive test suite with Vitest.
- **CI/CD** — GitHub Actions workflows for build, test, and npm publish.
- **Apache 2.0 License**.
- **CONTRIBUTING.md** guide.

### Fixed

- Version mismatch between `package.json` and reported MCP server version.
- Modulo bias in `password_generate` random character selection.
- Duplicate "brazil" entry in memorable password word list.

### Changed

- Minimum Node.js version remains >=18.
- Package entrypoint now points to compiled `dist/` output.

## [1.0.5] - 2025-01-01

### Added

- Initial release with 7 tools: `vault_list`, `item_lookup`, `password_create`, `password_read`, `password_update`, `password_generate`, `password_generate_memorable`.
