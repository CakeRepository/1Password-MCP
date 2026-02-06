/**
 * MCP Prompts — interactive prompt templates for 1Password workflows.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Register all MCP prompts on the server. */
export function registerAllPrompts(server: McpServer): void {
  // ─── generate-secure-password ─────────────────────────────────────

  server.prompt(
    "generate-secure-password",
    "Guide through generating a secure password with specific requirements",
    {
      purpose: z
        .string()
        .optional()
        .describe("What the password is for (e.g., 'database', 'API key', 'user account')."),
      style: z
        .enum(["random", "memorable"])
        .optional()
        .describe("Password style: 'random' for maximum entropy or 'memorable' for a passphrase. Defaults to 'random'."),
    },
    async ({ purpose, style }) => {
      const passwordStyle = style ?? "random";
      const purposeText = purpose ? ` for "${purpose}"` : "";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `I need to generate a secure password${purposeText}.`,
                ``,
                `Please help me create a ${passwordStyle === "memorable" ? "memorable passphrase" : "strong random password"} with these steps:`,
                ``,
                `1. Use the \`password_generate${passwordStyle === "memorable" ? "_memorable" : ""}\` tool to create the password.`,
                passwordStyle === "random"
                  ? `   - Use at least 20 characters with uppercase, numbers, and symbols.`
                  : `   - Use at least 4 words for good entropy.`,
                `2. If I want to store it, use \`vault_list\` to show available vaults.`,
                `3. Then use \`password_create\` to save it securely in 1Password.`,
                `4. Provide the \`op://\` secret reference so I can use it in my configuration.`,
                ``,
                `Important: Do NOT display the raw password in your response unless I explicitly ask. Instead, confirm it was generated and stored, and provide the secret reference.`,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  // ─── credential-rotation ──────────────────────────────────────────

  server.prompt(
    "credential-rotation",
    "Step-by-step workflow for rotating a credential stored in 1Password",
    {
      vaultId: z.string().optional().describe("Vault ID containing the credential to rotate."),
      itemId: z.string().optional().describe("Item ID of the credential to rotate."),
    },
    async ({ vaultId, itemId }) => {
      const hasTarget = vaultId && itemId;

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `I need to rotate a credential in 1Password.`,
                ``,
                hasTarget
                  ? `Target: vault \`${vaultId}\`, item \`${itemId}\`.`
                  : `I haven't specified which credential yet. Please help me find it.`,
                ``,
                `Follow this rotation workflow:`,
                ``,
                !hasTarget
                  ? `1. Use \`vault_list\` to show my vaults, then \`item_lookup\` to find the item.\n`
                  : "",
                `${hasTarget ? "1" : "2"}. Use \`password_read\` to verify access to the current credential (with \`reveal: false\` for safety).`,
                `${hasTarget ? "2" : "3"}. Use \`password_generate\` to create a new strong password.`,
                `${hasTarget ? "3" : "4"}. Use \`password_update\` to save the new password to 1Password.`,
                `${hasTarget ? "4" : "5"}. Confirm the rotation was successful and provide the updated \`op://\` reference.`,
                ``,
                `Important: After rotation, remind me to update the password wherever it's used (services, configs, etc.).`,
              ]
                .filter(Boolean)
                .join("\n"),
            },
          },
        ],
      };
    },
  );

  // ─── vault-audit ──────────────────────────────────────────────────

  server.prompt(
    "vault-audit",
    "Audit the contents of a 1Password vault — list all items with categories and metadata",
    {
      vaultId: z.string().optional().describe("Vault ID to audit. If omitted, all vaults will be listed first."),
    },
    async ({ vaultId }) => {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `I want to audit my 1Password vault${vaultId ? ` (vault ID: \`${vaultId}\`)` : ""}.`,
                ``,
                `Please perform the following:`,
                ``,
                !vaultId
                  ? `1. Use \`vault_list\` to show all accessible vaults and ask which one to audit.\n`
                  : "",
                `${!vaultId ? "2" : "1"}. Use \`item_lookup\` to list all items in the vault (no query filter, high limit).`,
                `${!vaultId ? "3" : "2"}. Summarize the findings:`,
                `   - Total number of items`,
                `   - Breakdown by category (Login, Password, etc.)`,
                `   - List of all item titles (but NOT passwords)`,
                `${!vaultId ? "4" : "3"}. Flag any concerns:`,
                `   - Items without a category`,
                `   - Duplicate-looking titles`,
                `   - Any items that look like they could be consolidated`,
                ``,
                `Do NOT reveal any secret values during the audit.`,
              ]
                .filter(Boolean)
                .join("\n"),
            },
          },
        ],
      };
    },
  );

  // ─── secret-reference-helper ──────────────────────────────────────

  server.prompt(
    "secret-reference-helper",
    "Help construct an op://vault/item/field secret reference from vault and item names",
    {
      vaultName: z
        .string()
        .optional()
        .describe("Name of the vault (partial match is OK)."),
      itemName: z
        .string()
        .optional()
        .describe("Name of the item to reference (partial match is OK)."),
    },
    async ({ vaultName, itemName }) => {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `I need to construct a 1Password secret reference (\`op://vault/item/field\`).`,
                ``,
                vaultName
                  ? `Vault name: "${vaultName}"`
                  : `I'm not sure which vault to use.`,
                itemName
                  ? `Item name: "${itemName}"`
                  : `I'm not sure which item to reference.`,
                ``,
                `Steps:`,
                `1. Use \`vault_list\` to find the vault${vaultName ? ` matching "${vaultName}"` : ""}.`,
                `2. Use \`item_lookup\` with the vault ID${itemName ? ` and query "${itemName}"` : ""} to find the item.`,
                `3. Use \`password_read\` with \`reveal: false\` to inspect available fields.`,
                `4. Construct the \`op://vault-name/item-name/field\` reference and present it.`,
                ``,
                `The final reference should be ready to paste into my configuration files.`,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
