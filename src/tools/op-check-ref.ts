/**
 * op_check_ref — Validate an op://vault/item/field secret reference and
 * return metadata about it (vault, item, field label/type) WITHOUT ever
 * returning the secret value. Use this to sanity-check a reference before
 * passing it to op_run.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";
import { parseSecretRef, assertVaultAllowed } from "../secret-ref.js";

export function registerOpCheckRef(server: McpServer): void {
  server.tool(
    "op_check_ref",
    "Validate an op://vault/item/field secret reference and return only non-secret metadata (vault name, item title, field label, field type) confirming it resolves — the field VALUE is never returned. Use this to check a reference is correct before using it with op_run; do not use password_read/item_get with reveal just to check a reference exists.",
    {
      secretReference: z
        .string()
        .min(1)
        .describe("Secret reference to validate, in op://vault/item/field format."),
    },
    async ({ secretReference }) => {
      try {
        log("debug", "Tool call: op_check_ref.", { secretReference: true });

        const ref = parseSecretRef(secretReference);
        assertVaultAllowed(ref.vault);

        const client = await getClient();
        if (!client?.secrets?.resolveAll || !client?.items?.get) {
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

        const { vaultId, itemId } = response.content;
        const item: any = await client.items.get(vaultId, itemId);

        const desiredField = ref.field.toLowerCase();
        const fields: any[] = item.fields ?? [];
        const match = fields.find((candidate: any) => {
          const idMatch = candidate.id?.toLowerCase() === desiredField;
          const titleMatch = candidate.title?.toLowerCase() === desiredField;
          const labelMatch = candidate.label?.toLowerCase() === desiredField;
          return idMatch || titleMatch || labelMatch;
        });

        if (!match) {
          throw new Error(
            `Field '${ref.field}' not found on item '${item.title}'.`,
          );
        }

        // Deliberately omit match.value — this tool never returns secret plaintext.
        return jsonResult({
          resolved: true,
          vault: { id: vaultId, name: ref.vault },
          item: { id: item.id, title: item.title, category: item.category },
          field: {
            id: match.id,
            title: match.title,
            type: match.fieldType ?? match.type,
            section: match.sectionId,
          },
        });
      } catch (error) {
        logError("op_check_ref failed.", error);
        return errorResult(error);
      }
    },
  );
}
