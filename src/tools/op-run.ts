/**
 * op_run — Execute a local command with 1Password secrets injected as
 * environment variables. This is the MCP equivalent of `op run -- <command>`.
 * Resolved values reach only the child process environment and are redacted
 * from the captured output on a best-effort basis (see ../redaction.ts).
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";
import { getClient } from "../client.js";
import { getConfig } from "../config.js";
import { log, logError } from "../logger.js";
import {
  OutputCapture,
  buildRedactionPatterns,
  finalizeOutput,
  maxPatternByteLength,
  redact,
  type RedactionPattern,
  type RedactionTarget,
} from "../redaction.js";
import { jsonResult, errorResult } from "../utils.js";
import { isSecretRef, parseSecretRef, assertVaultAllowed } from "../secret-ref.js";
import { assertVaultIdsAllowed } from "../vault-access.js";

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MiB safety cap per stream
const DEFAULT_TIMEOUT_MS = 120_000;
/** How long a timed-out command may take to die after SIGTERM before it is SIGKILLed. */
const KILL_GRACE_MS = 2_000;
/** How long to wait for the pipes to close after SIGKILL before abandoning them. */
const ABANDON_DELAY_MS = 500;

/** Server credentials that must never reach a child (compared case-insensitively). */
const SENSITIVE_SERVER_ENV_VARS: ReadonlySet<string> = new Set([
  "OP_SERVICE_ACCOUNT_TOKEN",
  "OP_KEYCHAIN_SERVICE",
  "OP_KEYCHAIN_ACCOUNT",
]);

interface ResolvedEnvEntry {
  name: string;
  value: string;
  /** True if this env var came from an op:// reference and must be redacted from output. */
  secret: boolean;
}

/**
 * Resolve every secret reference needed by one command in one bulk SDK request.
 * The vault segment of each reference is pre-checked against the allow-list as
 * written; once resolved, the vaults the references actually point at are
 * checked by ID too, before any value is returned.
 */
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

  const vaultIds: string[] = [];
  for (const [name, rawValue] of envEntries) {
    if (isSecretRef(rawValue)) {
      const response = resolved.individualResponses[rawValue];
      if (!response?.content) {
        const reason = response?.error?.type ?? "unknown";
        throw new Error(`Could not resolve secret reference '${rawValue}' (${reason}).`);
      }
      vaultIds.push(response.content.vaultId);
      entries.push({ name, value: response.content.secret, secret: true });
    } else {
      entries.push({ name, value: rawValue, secret: false });
    }
  }

  // A reference can name an allowed vault yet resolve to another one. Check the
  // resolved vaults (one listing for all of them) before returning any value,
  // so nothing is injected and no child is spawned for a disallowed vault.
  await assertVaultIdsAllowed(client, vaultIds);
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

/** Everything that must be masked in this command's output, derived encodings included. */
function buildPatterns(resolvedEnv: ResolvedEnvEntry[]): RedactionPattern[] {
  return buildRedactionPatterns(getRedactionTargets(resolvedEnv));
}

/** Copy the server environment minus its own credentials, then apply the caller's entries. */
function buildChildEnv(resolvedEnv: ResolvedEnvEntry[]): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  // The copy is a plain object, so match names case-insensitively ourselves:
  // Windows environment names are, and `Op_Service_Account_Token` would
  // otherwise survive a `delete childEnv["OP_SERVICE_ACCOUNT_TOKEN"]`.
  for (const key of Object.keys(childEnv)) {
    if (SENSITIVE_SERVER_ENV_VARS.has(key.toUpperCase())) {
      delete childEnv[key];
    }
  }
  for (const entry of resolvedEnv) {
    childEnv[entry.name] = entry.value;
  }
  return childEnv;
}

/**
 * Kill a spawned command and everything it started. POSIX children are spawned
 * detached as process-group leaders, so the whole group is signalled; Windows
 * has no groups, so `taskkill /T` walks the process tree instead (it cannot
 * find descendants of a parent that has already exited).
 */
function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined || pid <= 1) return;

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot;
    const taskkill = systemRoot ? join(systemRoot, "System32", "taskkill.exe") : "taskkill";
    const killDirectChild = (): void => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    };
    try {
      // Errors are ignored beyond a fallback: taskkill also fails when the child already exited.
      execFile(taskkill, ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, (error) => {
        if (error) killDirectChild();
      });
    } catch {
      killDirectChild();
    }
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

interface RunOptions {
  command?: string;
  argv?: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  shell?: string;
  stdin?: string;
  timeoutMs: number;
  /** Maximum bytes retained per output stream. */
  retainBytes: number;
}

interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: OutputCapture;
  stderr: OutputCapture;
  timedOut: boolean;
  spawnError?: Error;
}

/**
 * Run the command with bounded output capture and a timeout that covers the
 * whole process tree. Always resolves, within roughly the timeout plus the
 * kill grace, even if a descendant keeps the stdio pipes open.
 */
function runCommand(options: RunOptions): Promise<RunResult> {
  const { command, argv, cwd, env, shell, stdin, timeoutMs, retainBytes } = options;

  return new Promise<RunResult>((resolve) => {
    const stdout = new OutputCapture(retainBytes);
    const stderr = new OutputCapture(retainBytes);
    let timedOut = false;
    let settled = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let abandonTimer: NodeJS.Timeout | undefined;

    const spawnOptions = {
      cwd,
      env,
      windowsHide: true,
      // On POSIX the child leads its own process group so a timeout can signal its descendants too.
      detached: process.platform !== "win32",
    };
    const child = argv
      ? spawn(argv[0], argv.slice(1), { ...spawnOptions, shell: false })
      : spawn(command as string, { ...spawnOptions, shell: shell ?? true });

    const settle = (spawnError?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      clearTimeout(abandonTimer);
      resolve({ exitCode, signal: exitSignal, stdout, stderr, timedOut, spawnError });
    };

    child.on("error", (spawnError) => settle(spawnError));
    child.on("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
    });
    child.on("close", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      settle();
    });

    // Keep consuming (and discarding) output past the cap so the child never blocks on a full pipe.
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    // A child that exits without reading its stdin would otherwise raise an unhandled EPIPE.
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream?.on("error", () => {});
    }

    if (child.stdin) {
      if (stdin !== undefined) child.stdin.write(stdin);
      child.stdin.end();
    }

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => {
        killProcessTree(child, "SIGKILL");
        // If a descendant outside the tree still holds the pipes, stop waiting for them.
        abandonTimer = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          settle();
        }, ABANDON_DELAY_MS);
      }, KILL_GRACE_MS);
    }, timeoutMs);
  });
}

export function registerOpRun(server: McpServer): void {
  server.registerTool("op_run", { description: "Run a local shell command with 1Password secrets injected as environment variables. Resolved values go only into the child process environment, are never logged by the server, and are redacted from stdout/stderr on a best-effort basis (including common encodings such as JSON, URL and base64) — a command that deliberately transforms or transmits a secret can still expose it. This is the preferred way to USE a secret in a command, API call, or script: prefer op_run with op://vault/item/field references in `env` over reading a secret with password_read/item_get and pasting it into a command yourself, which would put the plaintext in the model context and transcript.", inputSchema: z.object({
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
                .describe("Kill the process and everything it started if it runs longer than this many milliseconds. Default 120000 (2 minutes)."),
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
                // Built before spawning: the capture needs to know how much extra output
                // keeps a secret that straddles the size cap intact.
                const patterns = buildPatterns(resolvedEnv);

                const result = await runCommand({
                  command,
                  argv,
                  cwd,
                  env: buildChildEnv(resolvedEnv),
                  shell,
                  stdin,
                  timeoutMs: timeout_ms ?? DEFAULT_TIMEOUT_MS,
                  retainBytes: MAX_OUTPUT_BYTES + maxPatternByteLength(patterns),
                });

                const durationMs = Date.now() - startedAt;

                if (result.spawnError) {
                  const message = redact(result.spawnError.message, patterns);
                  logError("op_run spawn failed.", new Error(message));
                  return errorResult(new Error(message));
                }

                const { text: stdout, truncated: stdoutTruncated } = finalizeOutput(
                  result.stdout.toBuffer(),
                  result.stdout.overflowed,
                  patterns,
                  MAX_OUTPUT_BYTES,
                );
                const { text: stderr, truncated: stderrTruncated } = finalizeOutput(
                  result.stderr.toBuffer(),
                  result.stderr.overflowed,
                  patterns,
                  MAX_OUTPUT_BYTES,
                );

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
                const patterns = buildPatterns(resolvedEnv);
                const rawMessage = error instanceof Error ? error.message : String(error);
                const safeError = new Error(redact(rawMessage, patterns));
                logError("op_run failed.", safeError);
                return errorResult(safeError);
              }
            });
}
