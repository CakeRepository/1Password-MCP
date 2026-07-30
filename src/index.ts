/**
 * 1Password MCP Server — main entrypoint.
 *
 * Builds one server instance per stdio connection and lets the MCP v2
 * transport negotiate either protocol revision 2026-07-28 or a legacy
 * 2025-era connection.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { SERVER_NAME, SERVER_VERSION, getConfig } from "./config.js";
import { log, logError } from "./logger.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllPrompts } from "./prompts/index.js";
import { registerAllResources } from "./resources/index.js";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerAllTools(server);
  registerAllPrompts(server);
  registerAllResources(server);

  return server;
}

process.on("uncaughtException", (error) => {
  logError("Uncaught exception.", error);
});

process.on("unhandledRejection", (reason) => {
  logError("Unhandled rejection.", reason);
});

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

  log("info", "Starting MCP stdio protocol negotiation.");
  await serveStdio(() => buildServer());
}

main().catch((error) => {
  logError(`Failed to start ${SERVER_NAME}.`, error);
  process.exit(1);
});
