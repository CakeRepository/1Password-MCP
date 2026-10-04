/**
 * MCP server factory — builds one fully registered server instance.
 *
 * Kept apart from the stdio entrypoint (`index.ts`) so tests can build the
 * real server without starting a stdio connection.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
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
