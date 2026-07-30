# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


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
