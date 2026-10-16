/**
 * 1Password MCP Server — main entrypoint.
 *
 * Builds one server instance per stdio connection and lets the MCP v2
 * transport negotiate either protocol revision 2026-07-28 or a legacy
 * 2025-era connection.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  SERVER_NAME,
  SERVER_VERSION,
  getConfig,
  getTokenSourceWarning,
} from "./config.js";
import { log, logError } from "./logger.js";
import { buildServer } from "./server.js";

export { buildServer };

// Once set, the process is on its way out: no further handler may re-enter
// the shutdown path (or the logging path that feeds the spin described below).
let shuttingDown = false;

/**
 * Best-effort final error report. Logging itself can throw here — e.g. when
 * stderr is a broken pipe after the parent went away — so every write is
 * guarded. An unreportable error is still fatal; it is just a quiet one.
 */
function reportFatal(context: string, error: unknown): void {
  try {
    logError(context, error);
  } catch {
    try {
      process.stderr.write(`[fatal] ${context}\n`);
    } catch {
      /* stderr is gone; nothing left to report through. */
    }
  }
}

function shutdown(exitCode: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exit(exitCode);
}

// A fatal error in a stdio server is unrecoverable: the connection state is
// unknown and the client cannot be answered reliably. Log once and exit so a
// supervisor can restart cleanly. NOTE: never just log-and-continue here —
// when stdio is broken (orphaned process, EPIPE on every write), each
// logging attempt throws again and the process spins at 100% CPU forever.
process.on("uncaughtException", (error) => {
  reportFatal("Uncaught exception.", error);
  shutdown(1);
});

process.on("unhandledRejection", (reason) => {
  reportFatal("Unhandled rejection.", reason);
  shutdown(1);
});

// Nobody left on the other end of stdin: this server is an orphan. Exit
// instead of idling (or spinning) forever.
process.stdin.on("end", () => shutdown(0));
process.stdin.on("close", () => shutdown(0));

// Supervisor-initiated shutdown is a clean shutdown, not an error.
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

async function main(): Promise<void> {
  const config = getConfig();

  log("info", "Starting MCP server.", {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    integrationName: config.integrationName,
    integrationVersion: config.integrationVersion,
    node: process.version,
    tokenSource: config.tokenSource,
  });

  const tokenWarning = getTokenSourceWarning(config.tokenSource);
  if (tokenWarning) log("warn", tokenWarning);

  log("info", "Starting MCP stdio protocol negotiation.");
  await serveStdio(() => buildServer());
}

main().catch((error) => {
  logError(`Failed to start ${SERVER_NAME}.`, error);
  process.exit(1);
});
