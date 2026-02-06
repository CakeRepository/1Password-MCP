/**
 * Shared type definitions for the 1Password MCP server.
 */

/** Log severity levels. */
export type LogLevel = "error" | "warn" | "info" | "debug";

/** Numeric weight for each log level (lower = more severe). */
export const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/** Summary of a 1Password vault returned by vault_list. */
export interface VaultSummary {
  id: string;
  name: string;
  description?: string;
  type?: string;
}

/** Summary of a 1Password item returned by item_lookup. */
export interface ItemSummary {
  id: string;
  title: string;
  category?: string;
  vaultId: string;
}

/** MCP tool result content block. */
export interface TextContent {
  type: "text";
  text: string;
}

/** Standard MCP tool response. */
export interface ToolResult {
  [key: string]: unknown;
  content: TextContent[];
  isError?: boolean;
}

/** Structured metadata attached to log entries. */
export interface LogMeta {
  [key: string]: unknown;
}
