/**
 * Tests for the op_check_ref tool — validates an op:// reference and
 * returns metadata only, never the secret value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/client.js", () => ({
  getClient: vi.fn(),
  requireServiceAccountToken: vi.fn(() => "mock-token"),
  resetClient: vi.fn(),
}));

vi.mock("../src/logger.js", () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../src/client.js";
import { resetConfig } from "../src/config.js";
import { registerAllTools } from "../src/tools/index.js";

const mockedGetClient = vi.mocked(getClient);

describe("op_check_ref", () => {
  let server: McpServer;
  let registeredTools: Map<string, any>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    resetConfig();
    delete process.env.OP_MCP_ALLOWED_VAULTS;

    server = new McpServer({ name: "test", version: "0.0.0" });
    registeredTools = new Map();
    const originalTool = server.tool.bind(server);
    vi.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        registeredTools.set(args[0], {
          description: args[1],
          schema: args[2],
          handler: args[3],
        });
      }
      return originalTool(...args);
    });
    registerAllTools(server);
  });

  afterEach(() => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) delete process.env[key];
      else process.env[key] = originalEnv[key];
    });
    resetConfig();
  });

  function handler() {
    return registeredTools.get("op_check_ref")!.handler;
  }

  it("returns metadata for a resolvable reference without the value", async () => {
    mockedGetClient.mockResolvedValue({
      secrets: {
        resolveAll: vi.fn().mockResolvedValue({
          individualResponses: {
            "op://Private/github/token": {
              content: { secret: "s3cr3t", itemId: "i1", vaultId: "v1" },
            },
          },
        }),
      },
      items: {
        get: vi.fn().mockResolvedValue({
          id: "i1",
          title: "GitHub",
          category: "Login",
          fields: [
            { id: "token", title: "token", fieldType: "Concealed", value: "s3cr3t-value" },
          ],
        }),
      },
    } as any);

    const result = await handler()({ secretReference: "op://Private/github/token" });
    const data = JSON.parse(result.content[0].text);
    const raw = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(data.resolved).toBe(true);
    expect(data.vault.name).toBe("Private");
    expect(data.item.title).toBe("GitHub");
    expect(data.field.id).toBe("token");
    expect(data.field.type).toBe("Concealed");
    expect(data.field.value).toBeUndefined();
    expect(raw).not.toContain("s3cr3t-value");
  });

  it("errors when the reference does not resolve", async () => {
    mockedGetClient.mockResolvedValue({
      secrets: {
        resolveAll: vi.fn().mockResolvedValue({
          individualResponses: {
            "op://Private/missing/token": { error: { type: "not_found" } },
          },
        }),
      },
      items: { get: vi.fn() },
    } as any);

    const result = await handler()({ secretReference: "op://Private/missing/token" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Could not resolve secret reference");
  });

  it("errors when the field is not found on the item", async () => {
    mockedGetClient.mockResolvedValue({
      secrets: {
        resolveAll: vi.fn().mockResolvedValue({
          individualResponses: {
            "op://Private/github/nope": {
              content: { secret: "x", itemId: "i1", vaultId: "v1" },
            },
          },
        }),
      },
      items: {
        get: vi.fn().mockResolvedValue({
          id: "i1",
          title: "GitHub",
          fields: [{ id: "token", title: "token", fieldType: "Concealed", value: "x" }],
        }),
      },
    } as any);

    const result = await handler()({ secretReference: "op://Private/github/nope" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found on item");
  });

  it("rejects a vault outside a configured allow-list before resolving", async () => {
    process.env.OP_MCP_ALLOWED_VAULTS = "Private";
    resetConfig();
    const resolveAll = vi.fn();
    mockedGetClient.mockResolvedValue({
      secrets: { resolveAll },
      items: { get: vi.fn() },
    } as any);

    const result = await handler()({ secretReference: "op://personal/github/token" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not in the allowed vault list");
    expect(resolveAll).not.toHaveBeenCalled();
  });
});
