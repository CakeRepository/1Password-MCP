# 1Password MCP Server

[![CI](https://github.com/CakeRepository/1Password-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/CakeRepository/1Password-MCP/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@takescake/1password-mcp)](https://www.npmjs.com/package/@takescake/1password-mcp)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![MCP Badge](https://lobehub.com/badge/mcp/cakerepository-1password-mcp)](https://lobehub.com/mcp/cakerepository-1password-mcp)

A community-built [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that connects MCP-compatible AI clients (Claude Desktop, VS Code Copilot, OpenAI Codex, Gemini, etc.) to **1Password** vaults via a [Service Account](https://developer.1password.com/docs/service-accounts/).

> **Not an official 1Password product.** This is a community project.

---

## Features

### Tools (8)

| Tool | Description |
|------|-------------|
| `vault_list` | List all accessible vaults |
| `item_lookup` | Search items by title in a vault |
| `item_delete` | Delete an item from a vault |
| `password_create` | Create a new password/login item |
| `password_read` | Retrieve a password via secret reference (`op://vault/item/field`) or vault/item ID |
| `password_update` | Rotate/update an existing password |
| `password_generate` | Generate a cryptographically secure random password |
| `password_generate_memorable` | Generate a memorable passphrase from ~500 dictionary words |

### Prompts (4)

| Prompt | Description |
|--------|-------------|
| `generate-secure-password` | Guided workflow to generate and store a secure password |
| `credential-rotation` | Step-by-step credential rotation: read, generate, update, verify |
| `vault-audit` | Audit vault contents: list items, categorize, flag concerns |
| `secret-reference-helper` | Construct `op://vault/item/field` references interactively |

### Resources (3)

| Resource URI | Description |
|-------------|-------------|
| `1password://config` | Current server configuration (non-secret) |
| `1password://vaults` | Browsable list of all accessible vaults |
| `1password://vaults/{vaultId}/items` | Browsable list of items in a vault |

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- A [1Password Service Account token](https://developer.1password.com/docs/service-accounts/)

### Claude Desktop / VS Code / IDEs (JSON)

```json
{
  "mcpServers": {
    "1password": {
      "command": "npx",
      "args": ["-y", "@takescake/1password-mcp"],
      "env": {
        "OP_SERVICE_ACCOUNT_TOKEN": "YOUR_SERVICE_ACCOUNT_TOKEN"
      }
    }
  }
}
```

### OpenAI Codex (TOML)

**Option A** (stores the token in config):

```toml
[mcp_servers."1password"]
command = "npx"
args = ["-y", "@takescake/1password-mcp"]

[mcp_servers."1password".env]
OP_SERVICE_ACCOUNT_TOKEN = "YOUR_SERVICE_ACCOUNT_TOKEN"
```

**Option B** *(recommended: does NOT store the token in Codex config)*:

```toml
[mcp_servers."1password"]
command = "npx"
args = ["-y", "@takescake/1password-mcp"]
env_vars = ["OP_SERVICE_ACCOUNT_TOKEN"]
```

Then set `OP_SERVICE_ACCOUNT_TOKEN` in your shell/session/CI environment.

> **Note:** `codex mcp add ... --env OP_SERVICE_ACCOUNT_TOKEN=...` writes the token into Codex config. Use `env_vars` if you want the config to reference only the variable name.

### CLI Options

```
--service-account-token <token>   1Password service account token
--log-level <level>               Log level: error, warn, info, debug (default: info)
--integration-name <name>         Custom integration name for 1Password SDK
--integration-version <version>   Custom integration version
```

---

## Security & Privacy

> **Read this before using.**

- **LLM privacy risk** -- Secrets retrieved/created may be sent to your LLM provider and could be retained depending on your provider/account settings.
- **No E2E encryption in MCP** -- Secrets are plaintext inside the MCP workflow and in transit to the model. They are encrypted only once stored in 1Password.
- **Intended use** -- Best for automated/disposable credentials (dev DB creds, bot/service accounts, CI tokens).
- **Avoid high-stakes secrets** -- Do not use for banking, primary personal accounts, or other sensitive credentials. Use dedicated automation vaults.
- **Token security** -- Treat the Service Account Token like a master key. Rotate immediately if exposed.
- **Config files** -- Keep MCP config files out of version control (add to `.gitignore`).
- **Secret references** -- Prefer `op://...` references over copying raw passwords into prompts or files.
- **Least privilege** -- Use dedicated vaults and limited-scope service accounts for automation workflows.

---

## Development

```bash
# Clone and install
git clone https://github.com/CakeRepository/1Password-MCP.git
cd 1Password-MCP
npm install

# Build
npm run build

# Run tests
npm test

# Type-check
npm run lint

# Watch mode (dev)
npm run dev
```

### Project Structure

```
src/
  index.ts              # Server entrypoint
  types.ts              # Shared type definitions
  logger.ts             # Structured logging (stderr)
  config.ts             # CLI args, env vars, constants
  client.ts             # 1Password SDK client singleton
  utils.ts              # Result helpers, password generation
  tools/                # MCP tool handlers
    index.ts
    vault-list.ts
    item-lookup.ts
    item-delete.ts
    password-create.ts
    password-read.ts
    password-update.ts
    password-generate.ts
    password-generate-memorable.ts
  prompts/              # MCP prompt definitions
    index.ts
  resources/            # MCP resource definitions
    index.ts
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

---

## License

[Apache License 2.0](LICENSE)
