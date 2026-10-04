/**
 * Tests for the op_check_ref tool — validates an op:// reference and
 * returns metadata only, never the secret value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";

vi.mock("../src/client.js", () => ({
  getClient: vi.fn(),
  requireServiceAccountToken: vi.fn(() => "mock-token"),
  resetClient: vi.fn(),
}));

vi.mock("../src/logger.js", () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));
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
    const originalTool = server.registerTool.bind(server);
    vi.spyOn(server, "registerTool").mockImplementation(((...args: any[]) => {
      const [name, config, handler] = args;
      registeredTools.set(name, {
        description: config.description,
        schema: config.inputSchema,
        handler,
      });
      return originalTool(...(args as Parameters<typeof originalTool>));
    }) as any);
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

  describe("resolved-vault check", () => {
    const vaults = [
      { id: "vlt-private-0001", title: "Private" },
      { id: "vlt-prod-0002", title: "Prod" },
    ];

    function setAllowList(value: string) {
      process.env.OP_MCP_ALLOWED_VAULTS = value;
      resetConfig();
    }

    /** A client whose `reference` resolves to a secret living in `resolvedVaultId`. */
    function mockClient(reference: string, resolvedVaultId: string) {
      const client = {
        vaults: { list: vi.fn().mockResolvedValue(vaults) },
        secrets: {
          resolveAll: vi.fn().mockResolvedValue({
            individualResponses: {
              [reference]: {
                content: { secret: "s3cr3t", itemId: "i1", vaultId: resolvedVaultId },
              },
            },
          }),
        },
        items: {
          get: vi.fn().mockResolvedValue({
            id: "i1",
            title: "GitHub",
            category: "Login",
            fields: [{ id: "token", title: "token", fieldType: "Concealed", value: "s3cr3t-value" }],
          }),
        },
      };
      mockedGetClient.mockResolvedValue(client as any);
      return client;
    }

    it("rejects a reference that names an allowed vault but resolves to a vault outside the allowed set", async () => {
      setAllowList("Private");
      const reference = "op://Private/github/token";
      const client = mockClient(reference, "vlt-prod-0002");

      const result = await handler()({ secretReference: reference });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not in the allowed vault list");
      expect(result.content[0].text).toContain("vlt-prod-0002");
      expect(client.secrets.resolveAll).toHaveBeenCalledTimes(1);
      expect(client.items.get).not.toHaveBeenCalled();
    });

    it.each([
      ["by name", "Private", "op://Private/github/token"],
      ["by ID", "vlt-private-0001", "op://vlt-private-0001/github/token"],
      ["by ID, in a different case", "VLT-PRIVATE-0001", "op://vlt-private-0001/github/token"],
    ])(
      "allows a reference that resolves to an allow-listed vault (%s)",
      async (_label, allowList, reference) => {
        setAllowList(allowList);
        const client = mockClient(reference, "vlt-private-0001");

        const result = await handler()({ secretReference: reference });
        const data = JSON.parse(result.content[0].text);

        expect(result.isError).toBeUndefined();
        expect(data.resolved).toBe(true);
        expect(client.items.get).toHaveBeenCalledWith("vlt-private-0001", "i1");
        expect(result.content[0].text).not.toContain("s3cr3t");
      },
    );

    it("does not list vaults when no allow-list is configured", async () => {
      const reference = "op://Private/github/token";
      const client = mockClient(reference, "vlt-prod-0002");

      const result = await handler()({ secretReference: reference });

      expect(result.isError).toBeUndefined();
      expect(client.vaults.list).not.toHaveBeenCalled();
    });
  });
});
