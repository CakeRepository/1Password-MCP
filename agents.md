# Publishing Guide for Agents

This document outlines the steps for building, versioning, and publishing the `@takescake/1password-mcp` server.

## Versioning

We adhere to [Semantic Versioning](https://semver.org/).
- **Patch** (2.4.x): Bug fixes and minor security updates.
- **Minor** (2.x.0): New tools, prompts, or non-breaking features.
- **Major** (x.0.0): Breaking changes to the MCP tool schemas or core architecture.

When bumping the version, ensure it is updated in the following locations:
1. `package.json`
2. `server.json`
3. `src/config.ts` (the `SERVER_VERSION` constant)
4. `CHANGELOG.md`

## Build and Validation

Before publishing, always run the full validation suite:

```bash
# Clean previous builds
npm run clean

# Install fresh dependencies
npm ci

# Type-check, build, and run tests
npm run build
npm run lint
npm test
```

## Publishing to npm

### Automated (Recommended)

1. Create a new GitHub Release on the `master` branch.
2. The `publish.yml` workflow will automatically trigger, build, test, and publish to npm.
3. Ensure the `NPM_TOKEN` is configured in GitHub Secrets.

### Manual

If manual publishing is required:

```bash
npm login
npm publish --access public
```

*Note: The `prepublishOnly` script in `package.json` will automatically run `clean`, `build`, and `test` before the package is uploaded.*

## Configuration Variables

- `OP_SERVICE_ACCOUNT_TOKEN`: **Required.** The service account token for 1Password.
- `OP_INTEGRATION_NAME`: (Optional) Defaults to `1password-mcp`.
- `OP_INTEGRATION_VERSION`: (Optional) Defaults to the current `SERVER_VERSION`.
- `MCP_LOG_LEVEL`: (Optional) `debug`, `info`, `warn`, `error`. Defaults to `info`.

## CI/CD Pipeline

The CI pipeline (`ci.yml`) runs on every push and pull request to the `master` branch. It validates the build across Node.js 18, 20, and 22.
