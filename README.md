# 1Password MCP Server

This project is a community-built (not official) Model Context Protocol (MCP) server that allows MCP-compatible clients (e.g., Claude Desktop, IDE extensions, OpenAI Codex, Gemini, Claude) to interact with 1Password vaults using a 1Password Service Account. It exposes tools for listing vaults, searching items, generating passwords, and creating/reading/updating password items.

## ⚠️ Security & Privacy Warning

> - **Not an official 1Password product.**
> - **LLM privacy risk**: Any secrets retrieved/created may be sent to your LLM provider and could be retained or used for training depending on your provider/account settings.
> - **No E2E encryption in MCP context**: secrets are plaintext inside the MCP workflow and in transit to the model; they’re encrypted only once stored in 1Password.
> - **Intended use**: best for automated / disposable credentials (dev DB creds, bot/service accounts, tokens).
> - **Avoid high-stakes secrets**: do not use for banking, primary personal accounts, or other sensitive credentials—use dedicated automation vaults.

## Tools / Capabilities

- `vault_list` – list accessible vaults
- `item_lookup` – find items by title in a vault
- `password_generate` / `password_generate_memorable` – generate strong or memorable passwords
- `password_create` – create a new password item
- `password_read` – retrieve a password via secret reference (`op://vault/item/field`)
- `password_update` – rotate/update an existing password item

## Configuration

### Claude Desktop / IDEs (JSON)

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

### Codex (TOML)

**Option A (stores the token in `config.toml`):**

```toml
[mcp_servers."1password"]
command = "npx"
args = ["-y", "@takescake/1password-mcp"]

[mcp_servers."1password".env]
OP_SERVICE_ACCOUNT_TOKEN = "YOUR_SERVICE_ACCOUNT_TOKEN"
```

**Option B (recommended: does NOT store the token in Codex config):**

```toml
[mcp_servers."1password"]
command = "npx"
args = ["-y", "@takescake/1password-mcp"]
env_vars = ["OP_SERVICE_ACCOUNT_TOKEN"]
```

Then set the environment variable outside Codex (shell/session, secret manager, CI, etc.).

> **Note**: `codex mcp add ... --env OP_SERVICE_ACCOUNT_TOKEN=...` also writes the token into Codex config. Use `env_vars` if you want the config to reference only the variable name.

## Best Practices

- **Treat the Service Account Token like a master key** (rotate immediately if exposed).
- **Keep MCP config files out of version control** (`.gitignore`).
- **Prefer secret references** (`op://...`) over copying raw passwords into prompts or files.
- **Use dedicated vaults and least-privilege service accounts** for automation workflows.
