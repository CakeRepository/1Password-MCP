/**
 * Barrel module — registers all MCP tools on the server.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerVaultList } from "./vault-list.js";
import { registerItemLookup } from "./item-lookup.js";
import { registerItemDelete } from "./item-delete.js";
import { registerItemGet } from "./item-get.js";
import { registerItemEdit } from "./item-edit.js";
import { registerItemList } from "./item-list.js";
import { registerItemArchive } from "./item-archive.js";
import { registerNoteCreate } from "./note-create.js";
import { registerPasswordCreate } from "./password-create.js";
import { registerPasswordRead } from "./password-read.js";
import { registerPasswordUpdate } from "./password-update.js";
import { registerPasswordGenerate } from "./password-generate.js";
import { registerPasswordGenerateMemorable } from "./password-generate-memorable.js";
import { registerOpRun } from "./op-run.js";
import { registerOpCheckRef } from "./op-check-ref.js";

/** Register every tool with the MCP server. */
export function registerAllTools(server: McpServer): void {
  registerVaultList(server);
  registerItemLookup(server);
  registerItemDelete(server);
  registerItemGet(server);
  registerItemEdit(server);
  registerItemList(server);
  registerItemArchive(server);
  registerNoteCreate(server);
  registerPasswordCreate(server);
  registerPasswordRead(server);
  registerPasswordUpdate(server);
  registerPasswordGenerate(server);
  registerPasswordGenerateMemorable(server);
  registerOpRun(server);
  registerOpCheckRef(server);
}
