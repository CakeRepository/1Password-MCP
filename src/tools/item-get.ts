/**
 * item_get — Retrieve a full 1Password item, with concealed values hidden by default.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ItemFieldType, type Item, type ItemField } from "@1password/sdk";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";

/** Placeholder returned in place of a concealed value when reveal is false. */
const CONCEALED_PLACEHOLDER = "[concealed]";

/**
 * Shape a single field for output. Concealed field values are replaced with a
 * placeholder unless the caller explicitly asks to reveal them.
 */
function summarizeField(
  field: ItemField,
  reveal: boolean,
): {
  id: string;
  title: string;
  type: ItemFieldType;
  section?: string;
  value: string;
} {
  const concealed = field.fieldType === ItemFieldType.Concealed;
  const value = concealed && !reveal ? CONCEALED_PLACEHOLDER : field.value;
  return {
    id: field.id,
    title: field.title,
    type: field.fieldType,
    section: field.sectionId,
    value,
  };
}

export function registerItemGet(server: McpServer): void {
  server.tool(
    "item_get",
    "Retrieve a full 1Password item — title, category, tags, notes, and all fields (id, title, type, section). Concealed field values are hidden unless reveal is true. Accepts a secret reference (op://vault/item/field) or vault ID + item ID.",
    {
      secretReference: z
        .string()
        .optional()
        .describe(
          "Secret reference in op://vault/item/field format. If provided, vaultId and itemId are ignored.",
        ),
      vaultId: z
        .string()
        .optional()
        .describe("Vault ID containing the item (required if secretReference is not provided)."),
      itemId: z
        .string()
        .optional()
        .describe("Item ID to retrieve (required if secretReference is not provided)."),
      reveal: z
        .boolean()
        .optional()
        .describe(
          "If true, include concealed field values in plaintext. Defaults to false for security.",
        ),
    },
    async ({ secretReference, vaultId, itemId, reveal }) => {
      try {
        log("debug", "Tool call: item_get.", {
          secretReference: Boolean(secretReference),
          vaultId,
          itemId,
          reveal,
        });
        const client = await getClient();
        if (!client?.items?.get) {
          throw new Error(
            "Your @1password/sdk version does not support getting items.",
          );
        }

        let resolvedVaultId = vaultId;
        let resolvedItemId = itemId;

        if (secretReference) {
          if (!client?.secrets?.resolveAll) {
            throw new Error(
              "Your @1password/sdk version does not support resolving secret references.",
            );
          }
          const resolved = await client.secrets.resolveAll([secretReference]);
          const response = resolved.individualResponses[secretReference];
          if (!response?.content) {
            const reason = response?.error?.type ?? "unknown";
            throw new Error(
              `Could not resolve secret reference '${secretReference}' (${reason}).`,
            );
          }
          resolvedVaultId = response.content.vaultId;
          resolvedItemId = response.content.itemId;
        }

        if (!resolvedVaultId || !resolvedItemId) {
          throw new Error(
            "Provide secretReference or both vaultId and itemId.",
          );
        }

        const item: Item = await client.items.get(resolvedVaultId, resolvedItemId);
        const shouldReveal = reveal === true;

        return jsonResult({
          id: item.id,
          title: item.title,
          category: item.category,
          vaultId: item.vaultId,
          tags: item.tags ?? [],
          notes: item.notes ?? "",
          sections: (item.sections ?? []).map((section) => ({
            id: section.id,
            title: section.title,
          })),
          fields: (item.fields ?? []).map((field) =>
            summarizeField(field, shouldReveal),
          ),
          websites: (item.websites ?? []).map((site) => site.url),
          updatedAt: item.updatedAt,
        });
      } catch (error) {
        logError("item_get failed.", error);
        return errorResult(error);
      }
    },
  );
}
