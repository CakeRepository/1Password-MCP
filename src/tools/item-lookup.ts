/**
 * item_lookup — Search for items in a 1Password vault.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";
import type { ItemSummary } from "../types.js";

export function registerItemLookup(server: McpServer): void {
  server.tool(
    "item_lookup",
    "Search for items within a 1Password vault by title substring. Returns item IDs, titles, categories, and vault IDs.",
    {
      vaultId: z.string().min(1).describe("Vault ID to search within."),
      query: z
        .string()
        .optional()
        .describe("Optional substring to filter item titles (case-insensitive)."),
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .optional()
        .describe("Maximum number of items to return (default: all)."),
    },
    async ({ vaultId, query, limit }) => {
      try {
        log("debug", "Tool call: item_lookup.", {
          vaultId,
          hasQuery: Boolean(query),
          limit,
        });
        const client = await getClient();
        const listFn =
          client?.items?.list ?? (client?.items as any)?.listAll;
        if (!listFn) {
          throw new Error(
            "Your @1password/sdk version does not support listing items.",
          );
        }
        const items: any[] = await listFn.call(client.items, vaultId);
        const normalizedQuery = query?.toLowerCase();
        const filtered = normalizedQuery
          ? (items ?? []).filter((item: any) =>
              item.title?.toLowerCase().includes(normalizedQuery),
            )
          : items ?? [];
        const sliced =
          typeof limit === "number" ? filtered.slice(0, limit) : filtered;
        const summary: ItemSummary[] = sliced.map((item: any) => ({
          id: item.id,
          title: item.title,
          category: item.category,
          vaultId: item.vaultId ?? vaultId,
        }));
        return jsonResult({ items: summary, count: summary.length });
      } catch (error) {
        logError("item_lookup failed.", error);
        return errorResult(error);
      }
    },
  );
}
