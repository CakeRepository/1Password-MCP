# Contributing to 1Password MCP Server

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/CakeRepository/1Password-MCP.git
   cd 1Password-MCP
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Build**

   ```bash
   npm run build
   ```

4. **Run tests**

   ```bash
   npm test
   ```

## Project Structure

```
src/
├── index.ts              # Server entrypoint
├── types.ts              # Shared type definitions
├── logger.ts             # Structured logging to stderr
├── config.ts             # CLI args, env vars, constants
├── client.ts             # 1Password SDK client singleton
├── utils.ts              # Result helpers, password generation
├── tools/                # MCP tool handlers
│   ├── index.ts          # Tool registration barrel
│   ├── vault-list.ts
│   ├── item-lookup.ts
│   ├── item-delete.ts
│   ├── password-create.ts
│   ├── password-read.ts
│   ├── password-update.ts
│   ├── password-generate.ts
│   └── password-generate-memorable.ts
├── prompts/              # MCP prompt definitions
│   └── index.ts
└── resources/            # MCP resource definitions
    └── index.ts
tests/
├── utils.test.ts
├── config.test.ts
├── tools.test.ts
└── prompts.test.ts
```

## Guidelines

- **TypeScript** — All code must be written in TypeScript with strict mode.
- **No `any`** — Avoid `any` types. Use `unknown` and narrow with type guards.
- **Error handling** — Always use `errorResult()` from `utils.ts` for tool error responses.
- **Logging** — Use the `log()` and `logError()` functions from `logger.ts`. Never write to `stdout` (reserved for MCP protocol).
- **Tests** — Add tests for any new tool, prompt, or utility function.
- **Commit messages** — Use [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat: add item_delete tool`, `fix: modulo bias in password_generate`).

## Pull Request Process

1. Fork the repo and create a feature branch from `main`.
2. Make your changes and add/update tests.
3. Run `npm run build && npm test` to ensure everything passes.
4. Open a pull request with a clear description of your changes.

## Reporting Issues

Please use [GitHub Issues](https://github.com/CakeRepository/1Password-MCP/issues) to report bugs or request features. Include:

- Node.js version (`node -v`)
- 1Password SDK version
- Steps to reproduce
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
