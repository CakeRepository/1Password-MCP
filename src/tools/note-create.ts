/**
 * note_create — Create a new Secure Note item in a 1Password vault.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as sdk from "@1password/sdk";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";

const fieldSchema = z.object({
  idOrTitle: z.string().min(1).describe("Field id or title."),
  type: z.enum(["text", "concealed"]).describe("Field type."),
  value: z.string().describe("Field value."),
  section: z.string().min(1).optional().describe("Optional section id to place the field in."),
});

export function registerNoteCreate(server: McpServer): void {
  server.tool(
    "note_create",
    "Create a new Secure Note item in a 1Password vault with optional tags and custom fields.",
    {
      vaultId: z.string().min(1).describe("Vault ID to create the note in."),
      title: z.string().min(1).describe("Note title."),
      notes: z.string().optional().describe("Note body text."),
      tags: z
        .array(z.string().min(1))
        .optional()
        .describe("Optional tags for organization."),
      fields: z
        .array(fieldSchema)
        .optional()
        .describe("Optional custom fields to add to the note."),
    },
    async ({ vaultId, title, notes, tags, fields }) => {
      try {
        log("debug", "Tool call: note_create.", { vaultId, title });
        const client = await getClient();
        if (!client?.items?.create) {
          throw new Error(
            "Your @1password/sdk version does not support creating items.",
          );
        }

        const itemFields: sdk.ItemField[] = (fields ?? []).map((f) => ({
          id: f.idOrTitle,
          title: f.idOrTitle,
          fieldType:
            f.type === "concealed"
              ? sdk.ItemFieldType.Concealed
              : sdk.ItemFieldType.Text,
          value: f.value,
          ...(f.section !== undefined ? { sectionId: f.section } : {}),
        }));

        const item = await client.items.create({
          title,
          category: sdk.ItemCategory.SecureNote,
          vaultId,
          fields: itemFields,
          tags,
          notes,
        });

        return jsonResult({
          id: item.id,
          title: item.title,
          vaultId: (item as { vaultId?: string }).vaultId ?? vaultId,
          category: item.category,
        });
      } catch (error) {
        logError("note_create failed.", error);
        return errorResult(error);
      }
    },
  );
}
