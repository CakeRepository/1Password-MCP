/**
 * Structured logger that writes to stderr (stdout is reserved for MCP protocol).
 */

import { LOG_LEVEL_VALUES, type LogLevel, type LogMeta } from "./types.js";
import { getConfig } from "./config.js";

function formatMeta(meta?: LogMeta): string {
  if (!meta) return "";
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return " [meta unavailable]";
  }
}

/**
 * Write a structured log line to stderr.
 * Only emits if `level` meets the configured threshold.
 */
export function log(level: LogLevel, message: string, meta?: LogMeta): void {
  const levelValue = LOG_LEVEL_VALUES[level];
  const config = getConfig();
  if (levelValue > config.logLevelValue) return;

  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}${formatMeta(meta)}\n`;
  process.stderr.write(line);
}

/** Convenience: log an error with optional stack trace. */
export function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  log("error", context, stack ? { error: message, stack } : { error: message });
}
