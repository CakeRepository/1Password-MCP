# 1Password MCP Server

[![CI](https://github.com/CakeRepository/1Password-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/CakeRepository/1Password-MCP/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@takescake/1password-mcp?color=cb3837)](https://www.npmjs.com/package/@takescake/1password-mcp)
[![Node](https://img.shields.io/node/v/@takescake/1password-mcp)](https://www.npmjs.com/package/@takescake/1password-mcp)
[![MCP](https://img.shields.io/badge/MCP-2026--07--28-0ea5e9)](https://modelcontextprotocol.io/specification/2026-07-28)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**Give your AI assistant a locked door to 1Password — not a pile of passwords in the chat.**

`@takescake/1password-mcp` is a community [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server. It lets Claude, Cursor, VS Code Copilot, OpenAI Codex, Gemini, and other MCP clients manage vaults and credentials through a [1Password Service Account](https://developer.1password.com/docs/service-accounts/).

Built on the **MCP TypeScript SDK v2** with protocol negotiation for **[2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)** (and legacy clients). Secrets stay in 1Password; agents prefer `op://` references and `op_run` so plaintext never has to land in the model transcript.

> **Not an official 1Password product.** Community-built, Apache 2.0 licensed.

---

## Who this is for

| You are… | You get… |
|----------|----------|
| **Not deeply technical** | A one-time setup: create a service account, paste the token into your AI app’s MCP settings, then ask in plain English (“list my automation vault”, “rotate the staging DB password”). |
| **An agent / LLM** | Fifteen typed tools, four workflow prompts, three browsable resources, and clear rules: **prefer `op_run` + `op://` over revealing secrets**. |
| **A developer / SRE** | Full item CRUD, secure notes, password generation, vault allow-lists, Keychain token loading on macOS, and CI-friendly env config. |

---

## Why teams pick this server

- **Security-first defaults** — `password_read` and `item_get` return metadata unless you opt in with `reveal: true`.
- **`op_run` (the MCP equivalent of `op run`)** — inject `op://vault/item/field` into a local command’s environment; plaintext is redacted from stdout/stderr and never logged back to the model.
- **Full vault toolkit** — list, search, get, edit, create logins & notes, rotate passwords, archive, or delete.
- **Guided prompts** — password generation, credential rotation, vault audit, and secret-reference helpers.
- **Browsable resources** — vault and item catalogs over `1password://…` URIs (no secrets in resource payloads).
- **Modern MCP** — stdio transport, Zod 4 schemas, MCP 2026-07-28 negotiation with legacy client compatibility.

---

## What you get

### Tools (15)

Grouped the way agents and humans actually use them.

#### Discover

| Tool | What it does |
|------|----------------|
| `vault_list` | List vaults the service account can access (id, name, description, type). |
| `item_lookup` | Search a vault by title substring; optional `limit` (max 200). |
| `item_list` | List every item in a vault (id, title, category, tags, `updatedAt`) — never secrets. |

#### Read (safe by default)

| Tool | What it does |
|------|----------------|
| `item_get` | Full item: title, category, tags, notes, fields. Concealed values stay hidden unless `reveal: true`. Accepts `op://…` **or** `vaultId` + `itemId`. |
| `password_read` | Read one field (default `password`) via `op://…` or ids. **Metadata-only unless `reveal: true`.** Prefer `op_run` to *use* a secret. |
| `op_check_ref` | Validate `op://vault/item/field` and return non-secret metadata only (vault, item, field). Never the value. |

#### Create & update

| Tool | What it does |
|------|----------------|
| `password_create` | Create a Login or Password item (username, URL, tags, notes). `returnSecret` defaults to `false`. |
| `note_create` | Create a Secure Note with optional tags and custom fields. |
| `password_update` | Rotate a password / concealed field (creates the field if missing). |
| `item_edit` | Update title, notes (empty string clears), tags, URL; upsert or remove fields. Unreferenced fields stay untouched. |
| `password_generate` | Cryptographically secure random password (length 8–128; symbols/numbers/uppercase toggles). |
| `password_generate_memorable` | Memorable passphrase from a ~500-word list (word count, separator, number/symbol suffixes). |

#### Use secrets without revealing them

| Tool | What it does |
|------|----------------|
| `op_run` | Run a local command (`command` **or** `argv`) with env vars. Values matching `op://…` are resolved into the **child process only**; resolved secrets are redacted from returned output. Optional `cwd`, `shell`, `timeout_ms`, `stdin`. |

#### Soft-delete & destroy

| Tool | What it does |
|------|----------------|
| `item_archive` | Move an item to the archive (hidden from normal views). |
| `item_delete` | Permanently delete an item — **cannot be undone**. |

### Prompts (4)

| Prompt | When to use it |
|--------|----------------|
| `generate-secure-password` | Generate (random or memorable) and optionally store — without dumping the password into chat. |
| `credential-rotation` | Find → verify access → generate → update → confirm `op://` reference. |
| `vault-audit` | Inventory a vault by category; flag duplicates / oddities — never reveal secrets. |
| `secret-reference-helper` | Build a paste-ready `op://vault/item/field` from names. |

### Resources (3)

| URI | Contents |
|-----|----------|
| `1password://config` | Non-secret server config (name, version, log level, token source, Node version). |
| `1password://vaults` | JSON list of accessible vaults. |
| `1password://vaults/{vaultId}/items` | JSON item metadata for one vault (no secret values). |

---

## Before you start

You need two things:

1. **Node.js 20 or newer**
2. A **1Password Service Account** with access to the vault(s) you want the AI to use

### Create a service account (plain English)

1. Sign in to your 1Password account on the web.
2. Open **Developer** → **Service Accounts** (or follow [1Password’s guide](https://developer.1password.com/docs/service-accounts/)).
3. Create a service account and grant it **only** the vaults you want automation to touch (for example an `Automation` or `CI` vault — not your personal banking vault).
4. Copy the token once. Treat it like a master key.

---

## Quick start

### Claude Desktop / Cursor / VS Code / most IDEs

Add this to your MCP config (exact file depends on the app):

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

Restart the app, then try: *“List my 1Password vaults.”*

### macOS Keychain (no token in the config file)

Store the token in Keychain, then point the server at it:

```json
{
  "mcpServers": {
    "1password": {
      "command": "npx",
      "args": ["-y", "@takescake/1password-mcp"],
      "env": {
        "OP_KEYCHAIN_SERVICE": "op-service-account-claude-automation",
        "OP_KEYCHAIN_ACCOUNT": "your-macos-username"
      }
    }
  }
}
```

**Token resolution order:** CLI (`--service-account-token` / `--token`) → `OP_SERVICE_ACCOUNT_TOKEN` → macOS Keychain. `OP_KEYCHAIN_ACCOUNT` is optional when the service name alone is unique.

### OpenAI Codex (TOML)

**Option A** — token in config:

```toml
[mcp_servers."1password"]
command = "npx"
args = ["-y", "@takescake/1password-mcp"]

[mcp_servers."1password".env]
OP_SERVICE_ACCOUNT_TOKEN = "YOUR_SERVICE_ACCOUNT_TOKEN"
```

**Option B** *(recommended)* — config only names the env var:

```toml
[mcp_servers."1password"]
command = "npx"
args = ["-y", "@takescake/1password-mcp"]
env_vars = ["OP_SERVICE_ACCOUNT_TOKEN"]
```

Set `OP_SERVICE_ACCOUNT_TOKEN` in your shell or CI. Note: `codex mcp add ... --env OP_SERVICE_ACCOUNT_TOKEN=...` writes the secret into Codex config; prefer `env_vars` when you can.

On macOS you can omit the token env and use `OP_KEYCHAIN_SERVICE` (+ optional `OP_KEYCHAIN_ACCOUNT`) instead.

### Optional: lock `op_run` / `op_check_ref` to certain vaults

By default those tools may resolve `op://` references from any vault the service account can see. To allow-list vaults:

```json
{
  "env": {
    "OP_SERVICE_ACCOUNT_TOKEN": "YOUR_SERVICE_ACCOUNT_TOKEN",
    "OP_MCP_ALLOWED_VAULTS": "Automation, CI"
  }
}
```

Names or IDs work. References outside the list are rejected before resolution. Same setting via `--allowed-vaults`.

---

## For agents: how to handle secrets

Follow this order every time:

1. **Discover** with `vault_list` → `item_lookup` / `item_list` (metadata only).
2. **Confirm a reference** with `op_check_ref` — never `reveal` just to see if a path exists.
3. **Use** a secret in a command or API call with **`op_run`** and `op://vault/item/field` in `env`.
4. **Reveal** with `password_read` / `item_get` + `reveal: true` only when the human explicitly needs the value in chat.
5. **Rotate** with `password_generate` → `password_update` (keep `returnSecret: false` unless asked).
6. Prefer **`item_archive`** over **`item_delete`** unless permanent removal is required.

### `op_run` sketch

```json
{
  "argv": ["curl", "-sS", "https://api.example.com/health"],
  "env": {
    "API_TOKEN": "op://Automation/Example API/credential"
  },
  "timeout_ms": 60000
}
```

Prefer `argv` over a shell `command` string when you can — fewer quoting surprises.

---

## Configuration reference

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OP_SERVICE_ACCOUNT_TOKEN` | Usually yes | Service account token. Not required on macOS if Keychain vars are set. |
| `OP_KEYCHAIN_SERVICE` | No | macOS: Keychain service name for the token. |
| `OP_KEYCHAIN_ACCOUNT` | No | macOS: optional account to narrow the Keychain lookup. |
| `OP_MCP_ALLOWED_VAULTS` | No | Comma-separated vault names/IDs allowed for `op_run` / `op_check_ref`. Empty = unrestricted. |
| `OP_INTEGRATION_NAME` | No | Name reported to the 1Password SDK (default: `1password-mcp`). |
| `OP_INTEGRATION_VERSION` | No | Version reported to the SDK (default: package version). |
| `MCP_LOG_LEVEL` | No | `debug` \| `info` \| `warn` \| `error` (default: `info`). |
| `MCP_DEBUG` | No | If set, forces debug logging. |

### CLI flags

```
--service-account-token <token>   1Password service account token
--token <token>                   Alias for --service-account-token
--log-level <level>               error | warn | info | debug (default: info)
--integration-name <name>         Custom integration name for the 1Password SDK
--integration-version <version>   Custom integration version
--allowed-vaults <list>           Comma-separated allow-list for op_run / op_check_ref
```

---

## Security & privacy

> **Read this before pointing the server at a vault you care about.**

- **LLM privacy** — Anything revealed to the model may be sent to your AI provider and retained under their policies.
- **MCP is not end-to-end encrypted for secrets in flight** — Values are plaintext inside the MCP workflow and toward the model. They are encrypted at rest in 1Password once stored.
- **Best fit** — Automation credentials: CI tokens, bot accounts, disposable env secrets.
- **Avoid** — Banking, primary personal logins, recovery codes, or anything you cannot afford to expose to a model provider.
- **Token = master key** — Scope the service account tightly; rotate immediately if leaked; never commit tokens or MCP configs with secrets.
- **Prefer references** — `op://…` + `op_run` beat pasting passwords into prompts or files.
- **Least privilege** — Dedicated automation vaults beat sharing your whole account.

---

## Protocol & compatibility

| Piece | Detail |
|-------|--------|
| Package | `@takescake/1password-mcp` |
| Runtime | Node.js **≥ 20** |
| Transport | **stdio** |
| MCP SDK | `@modelcontextprotocol/server` v2 |
| Protocol | Negotiates **2026-07-28**; keeps legacy client compatibility |
| Registry name | `io.github.CakeRepository/1password` |

---

## Development

```bash
git clone https://github.com/CakeRepository/1Password-MCP.git
cd 1Password-MCP
npm ci
npm run build
npm test
npm run lint
```

Watch mode: `npm run dev`.

### Project layout

```
src/
  index.ts                 # Entrypoint — MCP stdio + protocol negotiation
  config.ts                # CLI / env / Keychain / allow-list
  client.ts                # 1Password SDK client
  logger.ts                # Structured logs on stderr (stdout is protocol)
  secret-ref.ts            # op:// parsing & allow-list checks
  utils.ts                 # Result helpers, password generation
  tools/                   # All 15 MCP tools
  prompts/                 # Interactive workflow prompts
  resources/               # 1password:// resources
tests/
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Maintainers / agents: [AGENTS.md](AGENTS.md).

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history, including the **4.0.0** MCP v2 / 2026-07-28 migration and the **3.0.0** `op_run` / reveal-opt-in security changes.

---

## License

[Apache License 2.0](LICENSE)
