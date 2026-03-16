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

1. Fork the repo and create a feature branch from `master`.
2. Make your changes and add/update tests.
3. Run `npm run build && npm test` to ensure everything passes.
4. Open a pull request with a clear description of your changes.

## Release Process (for Maintainers)

The project uses automated CI/CD for NPM releases.

1. Update the version in `package.json`, `server.json`, and `src/config.ts`.
2. Update `CHANGELOG.md` with the new version and changes.
3. Commit and push to the `master` branch.
4. The GitHub Action will automatically:
   - Run tests on Node.js 18, 20, and 22.
   - Build the project.
   - Publish the new version to NPM.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
