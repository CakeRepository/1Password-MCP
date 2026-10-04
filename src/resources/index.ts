/**
 * MCP Resources — browsable data exposed by the 1Password MCP server.
 *
 * URIs use the `onepassword:` scheme. The SDK parses every `resources/read`
 * URI with WHATWG `new URL()` before dispatching, and a scheme must start with
 * a letter (RFC 3986 §3.1), so a `1password:` URI could never be read.
 */
import {
  ResourceTemplate,
  type McpServer,
  type Variables,
} from "@modelcontextprotocol/server";
import { getClient } from "../client.js";
import { getConfig, SERVER_NAME, SERVER_VERSION } from "../config.js";
import { log, logError } from "../logger.js";
import { assertVaultIdAllowed, filterAllowedVaults } from "../vault-access.js";

/**
 * Read the `vaultId` template variable. The SDK hands over the matched URI
 * segment still percent-encoded, while RFC 6570 expansion (including the
 * SDK's own `UriTemplate.expand`) percent-encodes the value, so decode it.
 */
function readVaultId(variables: Variables): string {
  const raw = variables.vaultId;
  if (typeof raw !== "string") {
    throw new Error("Invalid resource URI: could not extract vaultId.");
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new Error("Invalid resource URI: vaultId is not valid percent-encoding.");
  }
}

/** Register all MCP resources on the server. */
export function registerAllResources(server: McpServer): void {
  // ─── onepassword://config ─────────────────────────────────────────

  server.registerResource(
    "server-config",
    "onepassword://config",
    {
      description:
        "Current 1Password MCP server configuration (non-secret values only).",
      mimeType: "application/json",
    },
    async (uri) => {
      const config = getConfig();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                serverName: SERVER_NAME,
                serverVersion: SERVER_VERSION,
                logLevel: config.logLevel,
                integrationName: config.integrationName,
                integrationVersion: config.integrationVersion,
                tokenSource: config.tokenSource,
                nodeVersion: process.version,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ─── onepassword://vaults ─────────────────────────────────────────

  server.registerResource(
    "vault-list",
    "onepassword://vaults",
    {
      description:
        "List of the 1Password vaults accessible to the service account (limited to the allow-listed vaults when OP_MCP_ALLOWED_VAULTS / --allowed-vaults is configured).",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const client = await getClient();
        const listFn =
          client?.vaults?.list ?? (client?.vaults as any)?.listAll;
        if (!listFn) {
          throw new Error("Cannot list vaults with this SDK version.");
        }
        const vaults: any[] = (await listFn.call(client.vaults)) ?? [];
        const visibleVaults = filterAllowedVaults(vaults);
        const summary = visibleVaults.map((vault: any) => ({
          id: vault.id,
          name: vault.name ?? vault.title,
          description: vault.description,
          type: vault.type,
        }));
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ vaults: summary }, null, 2),
            },
          ],
        };
      } catch (error) {
        logError("Resource onepassword://vaults failed.", error);
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    },
  );

  // ─── onepassword://vaults/{vaultId}/items ─────────────────────────

  server.registerResource(
    "vault-items",
    new ResourceTemplate("onepassword://vaults/{vaultId}/items", {
      // No per-vault entries in resources/list: that would call the
      // 1Password API on every listing. Clients discover the template via
      // resources/templates/list.
      list: undefined,
    }),
    {
      description:
        "List of items within a specific 1Password vault (metadata only, no secrets).",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      try {
        const vaultId = readVaultId(variables);

        log("debug", "Resource: vault-items.", { vaultId });
        const client = await getClient();
        await assertVaultIdAllowed(client, vaultId);
        const listFn =
          client?.items?.list ?? (client?.items as any)?.listAll;
        if (!listFn) {
          throw new Error("Cannot list items with this SDK version.");
        }
        const items: any[] = await listFn.call(client.items, vaultId);
        const summary = (items ?? []).map((item: any) => ({
          id: item.id,
          title: item.title,
          category: item.category,
          vaultId: item.vaultId ?? vaultId,
        }));

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                { vaultId, items: summary, count: summary.length },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        logError("Resource vault-items failed.", error);
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    },
  );
}
