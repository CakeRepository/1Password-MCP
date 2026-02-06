/**
 * password_create — Create a new password item in a 1Password vault.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as sdk from "@1password/sdk";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";

export function registerPasswordCreate(server: McpServer): void {
  server.tool(
    "password_create",
    "Create a new password/login item in a 1Password vault with optional username, URL, tags, and notes.",
    {
      vaultId: z.string().min(1).describe("Vault ID to create the item in."),
      title: z.string().min(1).describe("Item title."),
      username: z
        .string()
        .optional()
        .describe("Username to store in the item."),
      password: z.string().min(1).describe("Password to store in the item."),
      category: z
        .enum(["Login", "Password"])
        .optional()
        .describe("Item category. Defaults to Login."),
      tags: z
        .array(z.string().min(1))
        .optional()
        .describe("Optional tags for organization."),
      notes: z.string().optional().describe("Optional notes."),
      url: z
        .string()
        .url()
        .optional()
        .describe("Optional website URL to associate."),
      returnSecret: z
        .boolean()
        .optional()
        .describe(
          "If true, include the created password in the response. Defaults to false for security.",
        ),
    },
    async ({
      vaultId,
      title,
      username,
      password,
      category,
      tags,
      notes,
      url,
      returnSecret,
    }) => {
      try {
        log("debug", "Tool call: password_create.", { vaultId, title });
        const client = await getClient();
        if (!client?.items?.create) {
          throw new Error(
            "Your @1password/sdk version does not support creating items.",
          );
        }

        const fields: Array<{
          id: string;
          title: string;
          fieldType: string;
          value: string;
        }> = [];

        if (username) {
          fields.push({
            id: "username",
            title: "username",
            fieldType: sdk.ItemFieldType.Text,
            value: username,
          });
        }

        fields.push({
          id: "password",
          title: "password",
          fieldType: sdk.ItemFieldType.Concealed,
          value: password,
        });

        const categoryEnum =
          (category ?? "Login") === "Password"
            ? sdk.ItemCategory.Password
            : sdk.ItemCategory.Login;

        const item = await client.items.create({
          title,
          category: categoryEnum,
          vaultId,
          fields,
          tags,
          notes,
          websites: url ? [{ url }] : undefined,
        } as any);

        const response: Record<string, unknown> = {
          id: item.id,
          title: item.title,
          vaultId: (item as any).vaultId ?? vaultId,
          category: item.category,
        };

        if (returnSecret) {
          response.password = password;
        }

        return jsonResult(response);
      } catch (error) {
        logError("password_create failed.", error);
        return errorResult(error);
      }
    },
  );
}
