/**
 * 1Password MCP Server — main entrypoint.
 *
 * Wires together the MCP server with tools, prompts, resources,
 * and the stdio transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION, getConfig } from "./config.js";
import { log, logError } from "./logger.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllPrompts } from "./prompts/index.js";
import { registerAllResources } from "./resources/index.js";

// ─── Create the MCP server ──────────────────────────────────────────

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

// ─── Register capabilities ──────────────────────────────────────────

registerAllTools(server);
registerAllPrompts(server);
registerAllResources(server);

// ─── Global error handlers ──────────────────────────────────────────

process.on("uncaughtException", (error) => {
  logError("Uncaught exception.", error);
});

process.on("unhandledRejection", (reason) => {
  logError("Unhandled rejection.", reason);
});

// ─── Start ──────────────────────────────────────────────────────────

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

  const transport = new StdioServerTransport();
  log("info", "Connecting MCP server transport.");
  await server.connect(transport);
  log("info", "MCP server connected. Awaiting requests.");
}

main().catch((error) => {
  logError(`Failed to start ${SERVER_NAME}.`, error);
  process.exit(1);
});
