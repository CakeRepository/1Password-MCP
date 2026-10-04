/**
 * vault_list — List all accessible 1Password vaults.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";
import { filterAllowedVaults } from "../vault-access.js";
import type { VaultSummary } from "../types.js";
import { z } from "zod";

export function registerVaultList(server: McpServer): void {
  server.registerTool("vault_list", { description: "List the 1Password vaults accessible to the service account (limited to the allow-listed vaults when OP_MCP_ALLOWED_VAULTS / --allowed-vaults is configured). Returns vault IDs, names, descriptions, and types.", inputSchema: z.object({}) }, async () => {
              try {
                log("debug", "Tool call: vault_list.");
                const client = await getClient();
                const listFn = client?.vaults?.list ?? (client?.vaults as any)?.listAll;
                if (!listFn) {
                  throw new Error(
                    "Your @1password/sdk version does not support listing vaults.",
                  );
                }
                const vaults: any[] = (await listFn.call(client.vaults)) ?? [];
                const visibleVaults = filterAllowedVaults(vaults);
                const summary: VaultSummary[] = visibleVaults.map(
                  (vault: any) => ({
                    id: vault.id,
                    name: vault.name ?? vault.title,
                    description: vault.description,
                    type: vault.type,
                  }),
                );
                return jsonResult({ vaults: summary });
              } catch (error) {
                logError("vault_list failed.", error);
                return errorResult(error);
              }
            });
}
