/**
 * Server configuration: CLI arguments, environment variables, constants.
 */

import { LOG_LEVEL_VALUES, type LogLevel } from "./types.js";

export const SERVER_NAME = "1password-mcp";
export const SERVER_VERSION = "2.0.0";

/** Parse a `--flag value` or `--flag=value` argument from process.argv. */
function getArgValue(name: string): string | undefined {
  const flag = `--${name}`;
  const prefix = `${flag}=`;
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === flag && process.argv[i + 1]) return process.argv[i + 1];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

export interface ServerConfig {
  /** Resolved log level string. */
  logLevel: LogLevel;
  /** Numeric log level for fast comparison. */
  logLevelValue: number;
  /** Integration name reported to 1Password SDK. */
  integrationName: string;
  /** Integration version reported to 1Password SDK. */
  integrationVersion: string;
  /** Service account token (may be undefined until first use). */
  serviceAccountToken: string | undefined;
  /** Where the token came from. */
  tokenSource: "args" | "env" | "missing";
}

let _config: ServerConfig | undefined;

/** Build and cache the server configuration. */
export function getConfig(): ServerConfig {
  if (_config) return _config;

  const logLevelRaw = (
    getArgValue("log-level") ??
    process.env.MCP_LOG_LEVEL ??
    (process.env.MCP_DEBUG ? "debug" : "info")
  ).toLowerCase() as LogLevel;

  const logLevelValue = LOG_LEVEL_VALUES[logLevelRaw] ?? LOG_LEVEL_VALUES.info;

  const integrationName =
    getArgValue("integration-name") ??
    process.env.OP_INTEGRATION_NAME ??
    SERVER_NAME;

  const integrationVersion =
    getArgValue("integration-version") ??
    process.env.OP_INTEGRATION_VERSION ??
    SERVER_VERSION;

  const tokenFromArgs =
    getArgValue("service-account-token") ?? getArgValue("token");

  const serviceAccountToken =
    tokenFromArgs ?? process.env.OP_SERVICE_ACCOUNT_TOKEN;

  const tokenSource: ServerConfig["tokenSource"] = tokenFromArgs
    ? "args"
    : process.env.OP_SERVICE_ACCOUNT_TOKEN
      ? "env"
      : "missing";

  _config = {
    logLevel: logLevelRaw,
    logLevelValue,
    integrationName,
    integrationVersion,
    serviceAccountToken,
    tokenSource,
  };

  return _config;
}

/** Reset cached config (useful for testing). */
export function resetConfig(): void {
  _config = undefined;
}
