/**
 * Server configuration: CLI arguments, environment variables, constants.
 */

import { execFileSync } from "node:child_process";
import { LOG_LEVEL_VALUES, type LogLevel } from "./types.js";

export const SERVER_NAME = "1password-mcp";
export const SERVER_VERSION = "4.0.4";

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
  tokenSource: "args" | "env" | "keychain" | "missing";
  /**
   * Vault names/IDs (case-insensitive) the server may read from or write to.
   * Enforced server-wide: by every tool and resource that touches a vault (see
   * `vault-access.ts`) and, for `op://` references, by `secret-ref.ts`. An
   * empty list means no restriction (any accessible vault is allowed).
   */
  allowedVaults: string[];
}

/**
 * Parse a comma-separated vault allow-list. An unset/blank value yields an
 * empty list, which the vault guards treat as "no restriction".
 */
export function parseAllowedVaults(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

let _config: ServerConfig | undefined;

/**
 * macOS `security` CLI, invoked by absolute path rather than resolved through
 * `PATH`: a binary planted earlier on `PATH` could otherwise hand the server an
 * attacker-chosen service-account token and silently redirect secrets into the
 * attacker's 1Password account.
 */
const MACOS_SECURITY_BINARY = "/usr/bin/security";

interface MacOsKeychainLookupOptions {
  service?: string;
  account?: string;
  platform?: NodeJS.Platform;
  execFileSyncImpl?: typeof execFileSync;
}

export function readMacOsKeychainToken({
  service,
  account,
  platform = process.platform,
  execFileSyncImpl = execFileSync,
}: MacOsKeychainLookupOptions): string | undefined {
  if (!service || platform !== "darwin") return undefined;

  const args = ["find-generic-password"];
  if (account) args.push("-a", account);
  args.push("-s", service, "-w");

  try {
    const token = execFileSyncImpl(MACOS_SECURITY_BINARY, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

export function resolveServiceAccountToken({
  tokenFromArgs,
  env = process.env,
  readKeychainToken = readMacOsKeychainToken,
}: {
  tokenFromArgs?: string;
  env?: NodeJS.ProcessEnv;
  readKeychainToken?: (options: {
    service?: string;
    account?: string;
  }) => string | undefined;
} = {}): Pick<ServerConfig, "serviceAccountToken" | "tokenSource"> {
  const tokenFromEnv = env.OP_SERVICE_ACCOUNT_TOKEN;
  let tokenFromKeychain: string | undefined;
  if (!tokenFromArgs && !tokenFromEnv) {
    tokenFromKeychain = readKeychainToken({
      service: env.OP_KEYCHAIN_SERVICE,
      account: env.OP_KEYCHAIN_ACCOUNT,
    });
  }

  const serviceAccountToken = tokenFromArgs ?? tokenFromEnv ?? tokenFromKeychain;

  const tokenSource: ServerConfig["tokenSource"] = tokenFromArgs
    ? "args"
    : tokenFromEnv
      ? "env"
      : tokenFromKeychain
        ? "keychain"
        : "missing";

  return { serviceAccountToken, tokenSource };
}

/**
 * Startup warning for a weak token source, or `undefined` when none applies.
 * Takes only the source (never the token) so the message cannot leak the secret.
 */
export function getTokenSourceWarning(
  tokenSource: ServerConfig["tokenSource"],
): string | undefined {
  if (tokenSource !== "args") return undefined;
  return (
    "Service account token was passed on the command line " +
    "(--service-account-token / --token). Command-line arguments are visible " +
    "to other local processes (process listings, /proc/<pid>/cmdline), " +
    "including commands run via op_run. Prefer the OP_SERVICE_ACCOUNT_TOKEN " +
    "environment variable or, on macOS, the Keychain (OP_KEYCHAIN_SERVICE)."
  );
}

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

  const { serviceAccountToken, tokenSource } =
    resolveServiceAccountToken({ tokenFromArgs });

  const allowedVaults = parseAllowedVaults(
    getArgValue("allowed-vaults") ?? process.env.OP_MCP_ALLOWED_VAULTS,
  );

  _config = {
    logLevel: logLevelRaw,
    logLevelValue,
    integrationName,
    integrationVersion,
    serviceAccountToken,
    tokenSource,
    allowedVaults,
  };

  return _config;
}

/** Reset cached config (useful for testing). */
export function resetConfig(): void {
  _config = undefined;
}
