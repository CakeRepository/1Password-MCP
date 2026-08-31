/**
 * op_run — Execute a local command with 1Password secrets injected as
 * environment variables, without ever returning secret plaintext to the
 * caller. This is the MCP equivalent of `op run -- <command>`.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { spawn } from "node:child_process";
import { z } from "zod";
import { getClient } from "../client.js";
import { getConfig } from "../config.js";
import { log, logError } from "../logger.js";
import { jsonResult, errorResult } from "../utils.js";
import { isSecretRef, parseSecretRef, assertVaultAllowed } from "../secret-ref.js";

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MiB safety cap per stream
const DEFAULT_TIMEOUT_MS = 120_000;

const SENSITIVE_SERVER_ENV_VARS = [
  "OP_SERVICE_ACCOUNT_TOKEN",
  "OP_KEYCHAIN_SERVICE",
  "OP_KEYCHAIN_ACCOUNT",
] as const;

interface ResolvedEnvEntry {
  name: string;
  value: string;
  /** True if this env var came from an op:// reference and must be redacted from output. */
  secret: boolean;
}

interface RedactionTarget {
  name: string;
  value: string;
}

/** Resolve every secret reference needed by one command in one bulk SDK request. */
async function resolveEnvEntries(
  env: Record<string, string> | undefined,
): Promise<ResolvedEnvEntry[]> {
  if (!env) return [];
  const envEntries = Object.entries(env);
  const references = envEntries.map(([, value]) => value).filter(isSecretRef);
  const entries: ResolvedEnvEntry[] = [];

  if (references.length === 0) {
    return envEntries.map(([name, value]) => ({ name, value, secret: false }));
  }

  for (const reference of references) {
    assertVaultAllowed(parseSecretRef(reference).vault);
  }

  const client = await getClient();
  if (!client?.secrets?.resolveAll) {
    throw new Error(
      "Your @1password/sdk version does not support resolving secrets.",
    );
  }
  const resolved = await client.secrets.resolveAll(references);

  for (const [name, rawValue] of envEntries) {
    if (isSecretRef(rawValue)) {
      const response = resolved.individualResponses[rawValue];
      if (!response?.content) {
        const reason = response?.error?.type ?? "unknown";
        throw new Error(`Could not resolve secret reference '${rawValue}' (${reason}).`);
      }
      entries.push({ name, value: response.content.secret, secret: true });
    } else {
      entries.push({ name, value: rawValue, secret: false });
    }
  }
  return entries;
}

/** Collect every secret string that must be redacted from outputs/errors. */
function getRedactionTargets(
  resolvedEnv: ResolvedEnvEntry[],
): RedactionTarget[] {
  const targets: RedactionTarget[] = [];
  const seen = new Set<string>();

  // 1. Secrets resolved from op:// references
  for (const entry of resolvedEnv) {
    if (entry.secret && entry.value.length > 0 && !seen.has(entry.value)) {
      targets.push({ name: entry.name, value: entry.value });
      seen.add(entry.value);
    }
  }

  // 2. Defense-in-depth: Server's own service account token (from config or process.env)
  try {
    const configToken = getConfig().serviceAccountToken;
    if (configToken && configToken.length > 0 && !seen.has(configToken)) {
      targets.push({ name: "OP_SERVICE_ACCOUNT_TOKEN", value: configToken });
      seen.add(configToken);
    }
  } catch {
    // Ignore config lookup error
  }

  const envToken = process.env.OP_SERVICE_ACCOUNT_TOKEN;
  if (envToken && envToken.length > 0 && !seen.has(envToken)) {
    targets.push({ name: "OP_SERVICE_ACCOUNT_TOKEN", value: envToken });
    seen.add(envToken);
  }

  return targets;
}

/** Replace every occurrence of every secret value with a redaction marker. */
function redact(text: string, targets: RedactionTarget[]): string {
  let redacted = text;
  for (const target of targets) {
    if (target.value.length === 0) continue;
    // split/join instead of a RegExp so secret values with special
    // characters ($, *, (, etc.) are matched literally.
    redacted = redacted.split(target.value).join(`«REDACTED:${target.name}»`);
  }
  return redacted;
}

function truncateAndRedact(
  buffer: Buffer,
  targets: RedactionTarget[],
): { text: string; truncated: boolean } {
  // Redact the full text first so secret values spanning the truncation
  // boundary are matched and masked completely before slicing.
  const rawText = buffer.toString("utf8");
  const redactedText = redact(rawText, targets);
  const redactedBuffer = Buffer.from(redactedText, "utf8");

  if (redactedBuffer.length <= MAX_OUTPUT_BYTES) {
    return { text: redactedText, truncated: false };
  }

  return {
    text: redactedBuffer.subarray(0, MAX_OUTPUT_BYTES).toString("utf8"),
    truncated: true,
  };
}

export function registerOpRun(server: McpServer): void {
  server.registerTool("op_run", { description: "Run a local shell command with 1Password secrets injected as environment variables — plaintext secret values are NEVER returned to the caller or written to any log; every resolved secret value is redacted from stdout/stderr before the result is returned. This is the safe way to USE a secret in a command, API call, or script: prefer op_run with op://vault/item/field references in `env` over reading a secret with password_read/item_get and pasting it into a command yourself, which would put the plaintext in the model context and transcript.", inputSchema: z.object({
              command: z
                .string()
                .optional()
                .describe(
                  "Shell command line to execute (run via the platform shell). Provide either `command` or `argv`, not both.",
                ),
              argv: z
                .array(z.string())
                .optional()
                .describe(
                  "Argument vector [executable, ...args] to execute directly without a shell (safer against quoting/injection issues). Provide either `command` or `argv`, not both.",
                ),
              cwd: z
                .string()
                .optional()
                .describe("Working directory to run the command in, e.g. a repo checkout path."),
              env: z
                .record(z.string(), z.string())
                .optional()
                .describe(
                  "Map of ENV_VAR_NAME -> value. A value matching op://vault/item/field is resolved via 1Password and injected as plaintext into the child process env only; any other value is passed through unchanged as a literal.",
                ),
              shell: z
                .string()
                .optional()
                .describe(
                  "Optional shell executable to use with `command` (e.g. 'powershell.exe', 'C:/Program Files/Git/bin/bash.exe', '/bin/bash'). Defaults to the platform shell (cmd.exe on Windows, /bin/sh elsewhere). Ignored when `argv` is used.",
                ),
              timeout_ms: z
                .number()
                .int()
                .positive()
                .max(600_000)
                .optional()
                .describe("Kill the process if it runs longer than this many milliseconds. Default 120000 (2 minutes)."),
              stdin: z
                .string()
                .optional()
                .describe("Optional text to write to the process's stdin."),
            }) }, async ({ command, argv, cwd, env, shell, timeout_ms, stdin }) => {
              const startedAt = Date.now();
              let resolvedEnv: ResolvedEnvEntry[] = [];
              try {
                log("debug", "Tool call: op_run.", {
                  hasCommand: Boolean(command),
                  hasArgv: Boolean(argv),
                  cwd,
                  envKeys: env ? Object.keys(env) : [],
                  shell,
                  timeout_ms,
                });

                if (!command && !argv) {
                  throw new Error("Provide either `command` or `argv`.");
                }
                if (command && argv) {
                  throw new Error("Provide only one of `command` or `argv`, not both.");
                }
                if (argv && argv.length === 0) {
                  throw new Error("`argv` must contain at least the executable name.");
                }

                resolvedEnv = await resolveEnvEntries(env);
                const childEnv: NodeJS.ProcessEnv = { ...process.env };
                for (const envVar of SENSITIVE_SERVER_ENV_VARS) {
                  delete childEnv[envVar];
                }
                for (const entry of resolvedEnv) {
                  childEnv[entry.name] = entry.value;
                }

                const timeout = timeout_ms ?? DEFAULT_TIMEOUT_MS;

                const result = await new Promise<{
                  exitCode: number | null;
                  signal: NodeJS.Signals | null;
                  stdout: Buffer;
                  stderr: Buffer;
                  timedOut: boolean;
                  spawnError?: Error;
                }>((resolve) => {
                  const stdoutChunks: Buffer[] = [];
                  const stderrChunks: Buffer[] = [];
                  let timedOut = false;

                  const child = argv
                    ? spawn(argv[0], argv.slice(1), {
                        cwd,
                        env: childEnv,
                        shell: false,
                        timeout,
                        killSignal: "SIGTERM",
                      })
                    : spawn(command as string, {
                        cwd,
                        env: childEnv,
                        shell: shell ?? true,
                        timeout,
                        killSignal: "SIGTERM",
                      });

                  child.on("error", (spawnError) => {
                    resolve({
                      exitCode: null,
                      signal: null,
                      stdout: Buffer.concat(stdoutChunks),
                      stderr: Buffer.concat(stderrChunks),
                      timedOut,
                      spawnError,
                    });
                  });

                  child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
                  child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

                  if (stdin !== undefined && child.stdin) {
                    child.stdin.write(stdin);
                  }
                  child.stdin?.end();

                  child.on("close", (code, signal) => {
                    if (signal === "SIGTERM" || signal === "SIGKILL") {
                      // Node sets a timeout-triggered kill signal; heuristically
                      // treat it as a timeout when we hit/exceed the deadline.
                      timedOut = Date.now() - startedAt >= timeout;
                    }
                    resolve({
                      exitCode: code,
                      signal,
                      stdout: Buffer.concat(stdoutChunks),
                      stderr: Buffer.concat(stderrChunks),
                      timedOut,
                    });
                  });
                });

                const durationMs = Date.now() - startedAt;
                const redactionTargets = getRedactionTargets(resolvedEnv);
                const { text: stdout, truncated: stdoutTruncated } = truncateAndRedact(
                  result.stdout,
                  redactionTargets,
                );
                const { text: stderr, truncated: stderrTruncated } = truncateAndRedact(
                  result.stderr,
                  redactionTargets,
                );

                if (result.spawnError) {
                  const message = redact(result.spawnError.message, redactionTargets);
                  logError("op_run spawn failed.", new Error(message));
                  return errorResult(new Error(message));
                }

                log("debug", "op_run completed.", {
                  exitCode: result.exitCode,
                  signal: result.signal,
                  durationMs,
                  timedOut: result.timedOut,
                });

                return jsonResult({
                  exitCode: result.exitCode,
                  signal: result.signal,
                  timedOut: result.timedOut,
                  stdout,
                  stderr,
                  stdoutTruncated,
                  stderrTruncated,
                  durationMs,
                });
              } catch (error) {
                // Redact even on the error path in case a partially-resolved secret
                // ended up embedded in the thrown error's message.
                const targets = getRedactionTargets(resolvedEnv);
                const rawMessage = error instanceof Error ? error.message : String(error);
                const safeError = new Error(redact(rawMessage, targets));
                logError("op_run failed.", safeError);
                return errorResult(safeError);
              }
            });
}
