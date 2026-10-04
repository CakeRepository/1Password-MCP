/**
 * item_get — Retrieve a full 1Password item, with secret-bearing values hidden by default.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ItemFieldType, type Item, type ItemField } from "@1password/sdk";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";
import { parseSecretRef, assertVaultAllowed } from "../secret-ref.js";
import { assertVaultIdAllowed } from "../vault-access.js";

/** Placeholder returned in place of a secret-bearing value when reveal is false. */
const CONCEALED_PLACEHOLDER = "[concealed]";

/**
 * Field types whose values are known to be non-secret and are shown without
 * `reveal`. Deny-by-default: every other type is treated as secret-bearing,
 * including Concealed, SshKey (the value is the private key), Totp (the value
 * is the one-time-password seed), CreditCardNumber, Unsupported, and any type
 * a future SDK adds.
 */
const NON_SECRET_FIELD_TYPES: ReadonlySet<string> = new Set<string>([
  ItemFieldType.Text,
  ItemFieldType.Url,
  ItemFieldType.Email,
  ItemFieldType.Phone,
  ItemFieldType.Date,
  ItemFieldType.MonthYear,
  ItemFieldType.Menu,
  ItemFieldType.CreditCardType,
  ItemFieldType.Address,
  ItemFieldType.Reference,
]);

/**
 * Shape a single field for output. The value of any field whose type is not in
 * the non-secret allow-list is replaced with a placeholder unless the caller
 * explicitly asks to reveal it. `field.details` (computed OTP codes, SSH key
 * attributes, ...) is never included.
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
  const secretBearing = !NON_SECRET_FIELD_TYPES.has(field.fieldType);
  const value = secretBearing && !reveal ? CONCEALED_PLACEHOLDER : field.value;
  return {
    id: field.id,
    title: field.title,
    type: field.fieldType,
    section: field.sectionId,
    value,
  };
}

export function registerItemGet(server: McpServer): void {
  server.registerTool("item_get", { description: "Retrieve a full 1Password item — title, category, tags, notes, and all fields (id, title, type, section). Secret-bearing field values (passwords and other concealed fields, SSH private keys, one-time-password seeds, card numbers) are hidden unless reveal is true; only known non-secret types (text, URL, email, phone, date, menu, card type, address, reference) are shown by default. Accepts a secret reference (op://vault/item/field) or vault ID + item ID. Revealing a secret puts it in the model context/transcript — to USE a secret in a command or API call, prefer op_run with op:// references instead.", inputSchema: z.object({
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
                  "If true, include secret-bearing field values (passwords, SSH private keys, one-time-password seeds, card numbers) in plaintext — this puts the secret in the model context/transcript. Defaults to false; prefer op_run to use a secret without revealing it.",
                ),
            }) }, async ({ secretReference, vaultId, itemId, reveal }) => {
              try {
                log("debug", "Tool call: item_get.", {
                  secretReference: Boolean(secretReference),
                  vaultId,
                  itemId,
                  reveal,
                });
                if (secretReference) {
                  // Pre-check the vault segment as written; the vault the
                  // reference actually resolves to is verified below.
                  assertVaultAllowed(parseSecretRef(secretReference).vault);
                }

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

                await assertVaultIdAllowed(client, resolvedVaultId);

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
            });
}
