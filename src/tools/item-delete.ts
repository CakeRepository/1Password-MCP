/**
 * item_delete — Delete an item from a 1Password vault.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";

export function registerItemDelete(server: McpServer): void {
  server.registerTool("item_delete", { description: "Permanently delete an item from a 1Password vault. This action cannot be undone.", inputSchema: z.object({
              vaultId: z.string().min(1).describe("Vault ID containing the item."),
              itemId: z.string().min(1).describe("Item ID to delete."),
            }) }, async ({ vaultId, itemId }) => {
              try {
                log("debug", "Tool call: item_delete.", { vaultId, itemId });
                const client = await getClient();
                if (!(client?.items as any)?.delete) {
                  throw new Error(
                    "Your @1password/sdk version does not support deleting items.",
                  );
                }
                await (client.items as any).delete(vaultId, itemId);
                return jsonResult({
                  deleted: true,
                  vaultId,
                  itemId,
                });
              } catch (error) {
                logError("item_delete failed.", error);
                return errorResult(error);
              }
            });
}
