# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
