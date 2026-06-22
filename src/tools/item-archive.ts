/**
 * item_archive — Archive an item in a 1Password vault (instead of hard-deleting).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";

export function registerItemArchive(server: McpServer): void {
  server.tool(
    "item_archive",
    "Archive an item in a 1Password vault. The item is moved to the archive and hidden from regular views, rather than being permanently deleted.",
    {
      vaultId: z.string().min(1).describe("Vault ID containing the item."),
      itemId: z.string().min(1).describe("Item ID to archive."),
    },
    async ({ vaultId, itemId }) => {
      try {
        log("debug", "Tool call: item_archive.", { vaultId, itemId });
        const client = await getClient();
        if (!client?.items?.archive) {
          throw new Error(
            "Your @1password/sdk version does not support archiving items.",
          );
        }
        await client.items.archive(vaultId, itemId);
        return jsonResult({ archived: true, vaultId, itemId });
      } catch (error) {
        logError("item_archive failed.", error);
        return errorResult(error);
      }
    },
  );
}
