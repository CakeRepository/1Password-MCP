/**
 * password_generate_memorable — Generate a memorable passphrase from random words.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { log, logError } from "../logger.js";
import {
  jsonResult,
  errorResult,
  generateMemorablePassword,
} from "../utils.js";

export function registerPasswordGenerateMemorable(server: McpServer): void {
  server.tool(
    "password_generate_memorable",
    "Generate a memorable passphrase from random dictionary words with optional number and symbol suffixes. Uses a ~500-word curated list for good entropy.",
    {
      wordCount: z
        .number()
        .int()
        .min(2)
        .max(10)
        .optional()
        .describe("Number of words to include. Defaults to 3."),
      separator: z
        .string()
        .max(5)
        .optional()
        .describe("Separator between words. Defaults to '-'."),
      includeNumber: z
        .boolean()
        .optional()
        .describe("Append a random number (0-99) at the end. Defaults to true."),
      includeSymbol: z
        .boolean()
        .optional()
        .describe("Append a random symbol at the end. Defaults to true."),
      capitalize: z
        .boolean()
        .optional()
        .describe("Capitalize each word. Defaults to true."),
    },
    async ({
      wordCount = 3,
      separator = "-",
      includeNumber = true,
      includeSymbol = true,
      capitalize = true,
    }) => {
      try {
        log("debug", "Tool call: password_generate_memorable.", {
          wordCount,
          separator,
          includeNumber,
          includeSymbol,
          capitalize,
        });

        const password = generateMemorablePassword({
          wordCount,
          separator,
          includeNumber,
          includeSymbol,
          capitalize,
        });

        return jsonResult({ password });
      } catch (error) {
        logError("password_generate_memorable failed.", error);
        return errorResult(error);
      }
    },
  );
}
