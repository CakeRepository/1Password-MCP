/**
 * MCP Resources — browsable data exposed by the 1Password MCP server.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import { getConfig, SERVER_NAME, SERVER_VERSION } from "../config.js";
import { log, logError } from "../logger.js";

/** Register all MCP resources on the server. */
export function registerAllResources(server: McpServer): void {
  // ─── 1password://config ───────────────────────────────────────────

  server.resource(
    "server-config",
    "1password://config",
    {
      description:
        "Current 1Password MCP server configuration (non-secret values only).",
      mimeType: "application/json",
    },
    async () => {
      const config = getConfig();
      return {
        contents: [
          {
            uri: "1password://config",
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

  // ─── 1password://vaults ───────────────────────────────────────────

  server.resource(
    "vault-list",
    "1password://vaults",
    {
      description:
        "List of all 1Password vaults accessible to the service account.",
      mimeType: "application/json",
    },
    async () => {
      try {
        const client = await getClient();
        const listFn =
          client?.vaults?.list ?? (client?.vaults as any)?.listAll;
        if (!listFn) {
          throw new Error("Cannot list vaults with this SDK version.");
        }
        const vaults = await listFn.call(client.vaults);
        const summary = (vaults ?? []).map((vault: any) => ({
          id: vault.id,
          name: vault.name ?? vault.title,
          description: vault.description,
          type: vault.type,
        }));
        return {
          contents: [
            {
              uri: "1password://vaults",
              mimeType: "application/json",
              text: JSON.stringify({ vaults: summary }, null, 2),
            },
          ],
        };
      } catch (error) {
        logError("Resource 1password://vaults failed.", error);
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: "1password://vaults",
              mimeType: "application/json",
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    },
  );

  // ─── 1password://vaults/{vaultId}/items ───────────────────────────

  server.resource(
    "vault-items",
    "1password://vaults/{vaultId}/items",
    {
      description:
        "List of items within a specific 1Password vault (metadata only, no secrets).",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        // Extract vaultId from the URI
        const uriStr = typeof uri === "string" ? uri : uri.href;
        const match = uriStr.match(
          /1password:\/\/vaults\/([^/]+)\/items/,
        );
        const vaultId = match?.[1];
        if (!vaultId) {
          throw new Error(
            "Invalid resource URI: could not extract vaultId.",
          );
        }

        log("debug", "Resource: vault-items.", { vaultId });
        const client = await getClient();
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
              uri: uriStr,
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
        const uriStr = typeof uri === "string" ? uri : uri.href;
        return {
          contents: [
            {
              uri: uriStr,
              mimeType: "application/json",
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    },
  );
}
