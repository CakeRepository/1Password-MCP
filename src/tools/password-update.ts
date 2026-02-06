/**
 * password_update — Update a password field on an existing 1Password item.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as sdk from "@1password/sdk";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";

export function registerPasswordUpdate(server: McpServer): void {
  server.tool(
    "password_update",
    "Update (rotate) a password or concealed field on an existing 1Password item. If the target field does not exist, it will be created.",
    {
      vaultId: z.string().min(1).describe("Vault ID containing the item."),
      itemId: z.string().min(1).describe("Item ID to update."),
      newPassword: z.string().min(1).describe("New password value."),
      field: z
        .string()
        .optional()
        .describe(
          "Field id or title to update. Defaults to 'password'.",
        ),
      returnSecret: z
        .boolean()
        .optional()
        .describe(
          "If true, include the updated password in the response. Defaults to false for security.",
        ),
    },
    async ({ vaultId, itemId, newPassword, field, returnSecret }) => {
      try {
        log("debug", "Tool call: password_update.", {
          vaultId,
          itemId,
          field,
        });
        const client = await getClient();
        if (!client?.items?.get) {
          throw new Error(
            "Your @1password/sdk version does not support getting items.",
          );
        }
        if (!client?.items?.put) {
          throw new Error(
            "Your @1password/sdk version does not support updating items.",
          );
        }

        const item = await client.items.get(vaultId, itemId);
        const desiredField = (field ?? "password").toLowerCase();
        const fields: any[] = Array.isArray((item as any).fields)
          ? [...(item as any).fields]
          : [];
        let updated = false;

        for (const candidate of fields) {
          const idMatch = candidate.id?.toLowerCase() === desiredField;
          const titleMatch =
            candidate.title?.toLowerCase() === desiredField;
          const labelMatch =
            candidate.label?.toLowerCase() === desiredField;
          if (idMatch || titleMatch || labelMatch) {
            candidate.value = newPassword;
            updated = true;
            break;
          }
        }

        if (!updated) {
          fields.push({
            id: desiredField,
            title: desiredField,
            fieldType: sdk.ItemFieldType.Concealed,
            value: newPassword,
          });
        }

        (item as any).fields = fields;
        const updatedItem = await client.items.put(item);

        const response: Record<string, unknown> = {
          id: updatedItem.id,
          title: updatedItem.title,
          vaultId: (updatedItem as any).vaultId ?? vaultId,
        };

        if (returnSecret) {
          response.password = newPassword;
        }

        return jsonResult(response);
      } catch (error) {
        logError("password_update failed.", error);
        return errorResult(error);
      }
    },
  );
}
