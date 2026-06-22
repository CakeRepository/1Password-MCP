/**
 * note_create — Create a Secure Note item in a 1Password vault.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ItemCategory,
  ItemFieldType,
  type ItemCreateParams,
  type ItemField,
} from "@1password/sdk";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";

/** An optional custom field to attach to the note. */
const fieldInput = z.object({
  idOrTitle: z
    .string()
    .min(1)
    .describe("Field id and title to create."),
  type: z
    .enum(["text", "concealed"])
    .describe("Field type: 'text' for plain values, 'concealed' for secrets."),
  value: z.string().describe("Field value."),
  section: z
    .string()
    .optional()
    .describe("Optional section id to associate the field with."),
});

export function registerNoteCreate(server: McpServer): void {
  server.tool(
    "note_create",
    "Create a Secure Note item in a 1Password vault, with optional tags and custom fields.",
    {
      vaultId: z.string().min(1).describe("Vault ID to create the note in."),
      title: z.string().min(1).describe("Note title."),
      notes: z
        .string()
        .describe("Note body text. Pass an empty string for an empty note."),
      tags: z
        .array(z.string().min(1))
        .optional()
        .describe("Optional tags for organization."),
      fields: z
        .array(fieldInput)
        .optional()
        .describe("Optional custom fields to attach to the note."),
    },
    async ({ vaultId, title, notes, tags, fields }) => {
      try {
        // NOTE: field values are intentionally excluded from logs.
        log("debug", "Tool call: note_create.", {
          vaultId,
          title,
          fieldCount: fields?.length ?? 0,
        });
        const client = await getClient();
        if (!client?.items?.create) {
          throw new Error(
            "Your @1password/sdk version does not support creating items.",
          );
        }

        const itemFields: ItemField[] = (fields ?? []).map((field) => ({
          id: field.idOrTitle,
          title: field.idOrTitle,
          fieldType:
            field.type === "concealed"
              ? ItemFieldType.Concealed
              : ItemFieldType.Text,
          value: field.value,
          sectionId: field.section,
        }));

        const params: ItemCreateParams = {
          category: ItemCategory.SecureNote,
          vaultId,
          title,
          notes,
          tags,
          fields: itemFields.length > 0 ? itemFields : undefined,
        };

        const item = await client.items.create(params);

        return jsonResult({
          id: item.id,
          title: item.title,
          vaultId: item.vaultId,
          category: item.category,
          tags: item.tags ?? [],
          fieldCount: item.fields?.length ?? 0,
        });
      } catch (error) {
        logError("note_create failed.", error);
        return errorResult(error);
      }
    },
  );
}
