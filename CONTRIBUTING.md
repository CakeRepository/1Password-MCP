# Contributing to 1Password MCP Server

Thanks for helping make `@takescake/1password-mcp` better. This guide covers local setup, structure, and how we ship changes.

## Development setup

1. **Clone**

   ```bash
   git clone https://github.com/CakeRepository/1Password-MCP.git
   cd 1Password-MCP
   ```

2. **Requirements** — Node.js **≥ 20**, npm.

3. **Install & verify**

   ```bash
   npm ci
   npm run build
   npm test
   npm run lint
   ```

4. **Watch mode** (optional)

   ```bash
   npm run dev
   ```

You do not need a live service account token for unit tests. For manual MCP smoke tests, set `OP_SERVICE_ACCOUNT_TOKEN` (or macOS Keychain vars) against a dedicated automation vault.

## Project structure

```
src/
├── index.ts              # Server entrypoint (stdio + MCP negotiation)
├── types.ts              # Shared types
├── logger.ts             # Structured logging to stderr
├── config.ts             # CLI args, env vars, Keychain, allow-list
├── client.ts             # 1Password SDK client singleton
├── secret-ref.ts         # op:// parsing and vault allow-list
├── utils.ts              # Result helpers, password generation
├── tools/                # MCP tool handlers (15)
│   ├── index.ts
│   ├── vault-list.ts
│   ├── item-lookup.ts
│   ├── item-list.ts
│   ├── item-get.ts
│   ├── item-edit.ts
│   ├── item-delete.ts
│   ├── item-archive.ts
│   ├── note-create.ts
│   ├── password-create.ts
│   ├── password-read.ts
│   ├── password-update.ts
│   ├── password-generate.ts
│   ├── password-generate-memorable.ts
│   ├── op-run.ts
│   └── op-check-ref.ts
├── prompts/              # MCP prompt definitions
│   └── index.ts
└── resources/            # MCP resource definitions
    └── index.ts
tests/
├── utils.test.ts
├── config.test.ts
├── tools.test.ts
├── prompts.test.ts
├── secret-ref.test.ts
├── op-run.test.ts
└── op-check-ref.test.ts
```

Version must stay aligned across `package.json`, `server.json`, and `SERVER_VERSION` in `src/config.ts`. See [AGENTS.md](AGENTS.md).

## Guidelines

- **TypeScript** — Strict mode; avoid `any` (prefer `unknown` + narrowing).
- **Errors** — Use `errorResult()` from `utils.ts` for tool failures; set protocol-friendly error responses.
- **Logging** — Use `log()` / `logError()` from `logger.ts`. Never write to `stdout` (reserved for MCP).
- **Secrets** — Default to metadata-only responses. New tools that can expose plaintext must opt in explicitly (e.g. `reveal` / `returnSecret`). Prefer documenting `op_run` for “use without reveal.”
- **Schemas** — Tool/prompt inputs use Zod 4 and the MCP v2 registration APIs.
- **Tests** — Add or update Vitest coverage for new tools, prompts, and utilities.
- **Commits** — [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat: add item_archive tool`, `docs: refresh README for MCP 2026-07-28`).

## Pull request process

1. Fork and branch from `master`.
2. Make changes; update tests and docs when behavior or public surface changes.
3. Run `npm run build && npm test && npm run lint`.
4. Open a PR with a clear summary and test notes.

## Release process (maintainers)

Automated publish runs from GitHub Releases via `publish.yml` (trusted publishing). Manual steps:

1. Bump version in `package.json`, `server.json`, and `src/config.ts` (`SERVER_VERSION`).
2. Update `CHANGELOG.md`.
3. Merge to `master`, then create a GitHub Release tagged `vX.Y.Z` matching the package version.
4. Confirm the publish workflow succeeds on npm.

CI (`ci.yml`) builds and tests on push/PR to `master`. The published package requires **Node ≥ 20**.

For agent-oriented publish checklists, see [AGENTS.md](AGENTS.md).

## License

By contributing, you agree your contributions are licensed under the [Apache License 2.0](LICENSE).
