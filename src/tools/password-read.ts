/**
 * password_read — Retrieve a password or field from a 1Password item.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";

export function registerPasswordRead(server: McpServer): void {
  server.tool(
    "password_read",
    "Retrieve a secret from 1Password using either a secret reference (op://vault/item/field) or vault ID + item ID. Supports field selection and optional value reveal.",
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
        .describe("Vault ID for item lookup (required if secretReference is not provided)."),
      itemId: z
        .string()
        .optional()
        .describe("Item ID for item lookup (required if secretReference is not provided)."),
      field: z
        .string()
        .optional()
        .describe("Field id or title to read. Defaults to 'password'."),
      reveal: z
        .boolean()
        .optional()
        .describe(
          "If false, return metadata only without the secret value. Defaults to true.",
        ),
    },
    async ({ secretReference, vaultId, itemId, field, reveal }) => {
      try {
        log("debug", "Tool call: password_read.", {
          secretReference: Boolean(secretReference),
          vaultId,
          itemId,
          field,
          reveal,
        });
        const client = await getClient();

        if (secretReference) {
          if (!client?.secrets?.resolve) {
            throw new Error(
              "Your @1password/sdk version does not support resolving secrets.",
            );
          }
          const value = await client.secrets.resolve(secretReference);
          if (reveal === false) {
            return jsonResult({ resolved: true });
          }
          return jsonResult({ value });
        }

        if (!vaultId || !itemId) {
          throw new Error(
            "Provide secretReference or both vaultId and itemId.",
          );
        }

        if (!client?.items?.get) {
          throw new Error(
            "Your @1password/sdk version does not support getting items.",
          );
        }

        const item = await client.items.get(vaultId, itemId);
        const desiredField = (field ?? "password").toLowerCase();
        const fields: any[] = (item as any).fields ?? [];
        const match = fields.find((candidate: any) => {
          const idMatch = candidate.id?.toLowerCase() === desiredField;
          const titleMatch = candidate.title?.toLowerCase() === desiredField;
          const labelMatch = candidate.label?.toLowerCase() === desiredField;
          return idMatch || titleMatch || labelMatch;
        });

        if (!match) {
          throw new Error(`Field '${desiredField}' not found on item.`);
        }

        if (reveal === false) {
          return jsonResult({
            id: item.id,
            title: item.title,
            field: match.id ?? match.title,
            fieldType: match.fieldType ?? match.type,
          });
        }

        const value = match.value;
        if (typeof value !== "string") {
          throw new Error(
            "Field value is not a string and cannot be returned.",
          );
        }
        return jsonResult({ value });
      } catch (error) {
        logError("password_read failed.", error);
        return errorResult(error);
      }
    },
  );
}
