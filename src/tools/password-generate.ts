/**
 * password_generate — Generate a cryptographically secure random password.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { log, logError } from "../logger.js";
import {
  jsonResult,
  errorResult,
  generatePassword,
  buildCharset,
} from "../utils.js";

export function registerPasswordGenerate(server: McpServer): void {
  server.tool(
    "password_generate",
    "Generate a cryptographically secure random password with configurable length and character types. Uses rejection sampling for unbiased randomness.",
    {
      length: z
        .number()
        .int()
        .min(8)
        .max(128)
        .optional()
        .describe("Length of the password. Defaults to 20."),
      includeSymbols: z
        .boolean()
        .optional()
        .describe("Include symbols (!@#$%^&*…). Defaults to true."),
      includeNumbers: z
        .boolean()
        .optional()
        .describe("Include digits (0-9). Defaults to true."),
      includeUppercase: z
        .boolean()
        .optional()
        .describe("Include uppercase letters. Defaults to true."),
    },
    async ({
      length = 20,
      includeSymbols = true,
      includeNumbers = true,
      includeUppercase = true,
    }) => {
      try {
        log("debug", "Tool call: password_generate.", {
          length,
          includeSymbols,
          includeNumbers,
          includeUppercase,
        });

        const charset = buildCharset({
          includeUppercase,
          includeNumbers,
          includeSymbols,
        });
        const password = generatePassword(length, charset);

        return jsonResult({ password });
      } catch (error) {
        logError("password_generate failed.", error);
        return errorResult(error);
      }
    },
  );
}
