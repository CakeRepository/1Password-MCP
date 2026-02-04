# 1Password MCP Server

> [!CAUTION]
> **⚠️ IMPORTANT SECURITY & PRIVACY WARNING**
>
> - **NOT OFFICIAL**: This is **NOT** an official 1Password product. It is a community-developed tool.
> - **AI TRAINING RISK**: Depending on your LLM provider (e.g., Google, OpenAI, Anthropic), the data sent to the model—including passwords retrieved or created—**may be used for model training** unless you have explicitly opted out or are using an Enterprise/API tier with privacy guarantees.
> - **NO END-TO-END ENCRYPTION (Local)**: Passwords handled by this server are in **plaintext** within the MCP context and during transmission to the LLM. They are only encrypted once they are safely stored inside your 1Password vault.
> - **INTENDED USE**: This tool is designed for **"Automated Created Passwords"** (e.g., development database credentials, disposable service accounts, bot tokens) so they don't get lost.
> - **DO NOT USE FOR SENSITIVE DATA**: Do **NOT** use this tool to manage "Banking Passwords," primary personal accounts, or any high-stakes credentials. Only use it with dedicated vaults intended for automated workflows.

A Model Context Protocol (MCP) server that enables LLMs like **Google Gemini**, **OpenAI Codex**, and **Anthropic Claude** to securely interact with your 1Password vaults. Using a 1Password Service Account, this server provides a standardized interface for AI models to list vaults, search for items, and manage passwords.

## Features

- **Secure Access**: Utilizes 1Password Service Accounts for controlled, programmatic access.
- **Cross-Model Compatibility**: Works with any MCP-compatible client or platform (e.g., Claude Desktop, IDE extensions).
- **Comprehensive Toolset**: Empower your AI assistant to create, read, and update vault items with precision.

## Capabilities

The following tools are exposed to the AI model:

- `vault_list`: List all vaults accessible to the service account.
- `item_lookup`: Search for items within a specific vault by title.
- `password_generate`: Generate a strong, secure password with customizable criteria.
- `password_generate_memorable`: Create easy-to-remember passwords using words (nouns, colors, etc.), numbers, and symbols.
- `password_create`: Create a new password item with specific details (username, URL, tags, etc.).
- `password_read`: Retrieve a password using a 1Password secret reference (`op://vault/item/field`).
- `password_update`: Rotate or update an existing item's password.

## Configuration for AI Clients

To use this server with your preferred AI environment, add it to your MCP configuration file.

### Claude Desktop / IDEs (JSON)
```json
{
  "mcpServers": {
    "1password": {
      "command": "npx",
      "args": [
        "-y",
        "@takescake/1password-mcp",
        "--service-account-token",
        "YOUR_SERVICE_ACCOUNT_TOKEN"
      ]
    }
  }
}
```

### Environment Variables
Alternatively, you can provide the token via the `OP_SERVICE_ACCOUNT_TOKEN` environment variable.

## Usage in Prompting

Once configured, you can ask your AI model tasks like:
- "Find my login for 'GitHub' in the Engineering vault."
- "Create a new password for 'Staging DB' with the username 'admin'."
- "Update the password for my 'Cloud Console' entry."

## Security Best Practices

- **Avoid Plaintext Storage**: Never store generated passwords or tokens in plaintext files (e.g., `.codex`, `.env`, or conversation logs). These files are not encrypted and can be accessed by other users or processes.
- **Version Control Risks**: Ensure that any files containing configuration or session history are added to your `.gitignore`. Accidental commits of these files can expose your credentials in repository history.
- **Use Secret References**: Instead of storing actual passwords, use 1Password **Secret References** (e.g., `op://Vault/Item/password`). The AI can use the `password_read` tool to retrieve values dynamically when needed.
- **Service Account Safety**: Treat your Service Account Token as a master key. Rotate it immediately if you suspect it has been exposed.

## Requirements

- **1Password Service Account**: A valid token with appropriate vault permissions.
- **Node.js**: Version 18 or higher.

## Security Note
Always treat your Service Account Token as a sensitive secret. Ensure your MCP configuration files are stored securely and never committed to public repositories.