/**
 * item_edit — Edit an existing 1Password item: title, notes, tags, url, and fields.
 *
 * The item is fetched, changes are applied immutably, and the result is written
 * back via items.put. Unreferenced fields are preserved untouched. Field values
 * are never logged.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ItemFieldType,
  AutofillBehavior,
  type Item,
  type ItemField,
  type Website,
} from "@1password/sdk";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";

/** A field upsert request from the caller. */
const fieldInput = z.object({
  idOrTitle: z
    .string()
    .min(1)
    .describe("Field id or title to match (case-insensitive). Created if absent."),
  type: z
    .enum(["text", "concealed"])
    .describe("Field type: 'text' for plain values, 'concealed' for secrets."),
  value: z.string().describe("New value for the field."),
  section: z
    .string()
    .optional()
    .describe("Optional section id to associate the field with."),
});

/** Does a field match the caller-supplied id-or-title? */
function fieldMatches(field: ItemField, idOrTitle: string): boolean {
  const target = idOrTitle.toLowerCase();
  return (
    field.id?.toLowerCase() === target ||
    field.title?.toLowerCase() === target
  );
}

export function registerItemEdit(server: McpServer): void {
  server.tool(
    "item_edit",
    "Edit an existing 1Password item. Update the title, notes (pass an empty string to clear notes), tags, website URL, upsert fields, or remove fields. Only referenced fields are changed; all others are preserved.",
    {
      vaultId: z.string().min(1).describe("Vault ID containing the item."),
      itemId: z.string().min(1).describe("Item ID to edit."),
      title: z.string().min(1).optional().describe("New item title."),
      notes: z
        .string()
        .optional()
        .describe(
          "Full replacement of the item's notes. Pass an empty string to clear notes.",
        ),
      tags: z
        .array(z.string().min(1))
        .optional()
        .describe("Replacement set of tags (replaces all existing tags)."),
      url: z
        .string()
        .url()
        .optional()
        .describe("Replacement primary website URL for the item."),
      fields: z
        .array(fieldInput)
        .optional()
        .describe("Fields to upsert (create or update) by id or title."),
      removeFields: z
        .array(z.string().min(1))
        .optional()
        .describe("Field ids or titles to remove from the item."),
    },
    async ({ vaultId, itemId, title, notes, tags, url, fields, removeFields }) => {
      try {
        // NOTE: field values are intentionally excluded from logs.
        log("debug", "Tool call: item_edit.", {
          vaultId,
          itemId,
          changeTitle: title !== undefined,
          changeNotes: notes !== undefined,
          changeTags: tags !== undefined,
          changeUrl: url !== undefined,
          upsertCount: fields?.length ?? 0,
          removeCount: removeFields?.length ?? 0,
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

        const existing: Item = await client.items.get(vaultId, itemId);

        // Build the next field list immutably, preserving unreferenced fields.
        const removeSet = new Set(
          (removeFields ?? []).map((value) => value.toLowerCase()),
        );

        let nextFields: ItemField[] = (existing.fields ?? []).filter(
          (field) =>
            !removeSet.has(field.id?.toLowerCase()) &&
            !removeSet.has(field.title?.toLowerCase()),
        );

        for (const upsert of fields ?? []) {
          const fieldType =
            upsert.type === "concealed"
              ? ItemFieldType.Concealed
              : ItemFieldType.Text;
          const index = nextFields.findIndex((field) =>
            fieldMatches(field, upsert.idOrTitle),
          );

          if (index >= 0) {
            const current = nextFields[index];
            const replacement: ItemField = {
              ...current,
              fieldType,
              value: upsert.value,
              sectionId: upsert.section ?? current.sectionId,
            };
            nextFields = nextFields.map((field, i) =>
              i === index ? replacement : field,
            );
          } else {
            nextFields = [
              ...nextFields,
              {
                id: upsert.idOrTitle,
                title: upsert.idOrTitle,
                fieldType,
                value: upsert.value,
                sectionId: upsert.section,
              },
            ];
          }
        }

        let nextWebsites: Website[] | undefined = existing.websites;
        if (url !== undefined) {
          nextWebsites = [
            {
              url,
              label: "website",
              autofillBehavior: AutofillBehavior.AnywhereOnWebsite,
            },
          ];
        }

        const updated: Item = {
          ...existing,
          title: title ?? existing.title,
          notes: notes ?? existing.notes,
          tags: tags ?? existing.tags,
          websites: nextWebsites,
          fields: nextFields,
        };

        const result: Item = await client.items.put(updated);

        return jsonResult({
          id: result.id,
          title: result.title,
          vaultId: result.vaultId,
          category: result.category,
          tags: result.tags ?? [],
          fieldCount: result.fields?.length ?? 0,
          updatedAt: result.updatedAt,
        });
      } catch (error) {
        logError("item_edit failed.", error);
        return errorResult(error);
      }
    },
  );
}
