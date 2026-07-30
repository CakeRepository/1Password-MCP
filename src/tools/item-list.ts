/**
 * item_list — List all items in a 1Password vault (metadata only, no secrets).
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ItemOverview } from "@1password/sdk";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";

export function registerItemList(server: McpServer): void {
  server.registerTool("item_list", { description: "List all items in a 1Password vault, returning id, title, category, tags, and updatedAt for each. Never returns secret values.", inputSchema: z.object({
              vaultId: z.string().min(1).describe("Vault ID to list items from."),
            }) }, async ({ vaultId }) => {
              try {
                log("debug", "Tool call: item_list.", { vaultId });
                const client = await getClient();
                if (!client?.items?.list) {
                  throw new Error(
                    "Your @1password/sdk version does not support listing items.",
                  );
                }

                const items: ItemOverview[] = await client.items.list(vaultId);
                const summary = (items ?? []).map((item) => ({
                  id: item.id,
                  title: item.title,
                  category: item.category,
                  tags: item.tags ?? [],
                  updatedAt: item.updatedAt,
                }));

                return jsonResult({ items: summary, count: summary.length });
              } catch (error) {
                logError("item_list failed.", error);
                return errorResult(error);
              }
            });
}
