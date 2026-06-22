/**
 * Tests for MCP tool handlers with mocked 1Password client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the client module before importing tools
vi.mock("../src/client.js", () => ({
  getClient: vi.fn(),
  requireServiceAccountToken: vi.fn(() => "mock-token"),
  resetClient: vi.fn(),
}));

// Mock the logger to suppress output during tests
vi.mock("../src/logger.js", () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../src/client.js";
import { registerAllTools } from "../src/tools/index.js";

const mockedGetClient = vi.mocked(getClient);

describe("MCP Tools", () => {
  let server: McpServer;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer({ name: "test", version: "0.0.0" });

    // Spy on server.tool to capture registered handlers
    registeredTools = new Map();
    const originalTool = server.tool.bind(server);
    vi.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      // The 4-arg overload: (name, description, schema, handler)
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

  it("registers all 10 tools", () => {
    expect(registeredTools.size).toBe(10);
    expect(registeredTools.has("vault_list")).toBe(true);
    expect(registeredTools.has("item_lookup")).toBe(true);
    expect(registeredTools.has("item_delete")).toBe(true);
    expect(registeredTools.has("item_get")).toBe(true);
    expect(registeredTools.has("item_edit")).toBe(true);
    expect(registeredTools.has("password_create")).toBe(true);
    expect(registeredTools.has("password_read")).toBe(true);
    expect(registeredTools.has("password_update")).toBe(true);
    expect(registeredTools.has("password_generate")).toBe(true);
    expect(registeredTools.has("password_generate_memorable")).toBe(true);
  });

  it("all tools have descriptions", () => {
    for (const [name, tool] of registeredTools) {
      expect(tool.description, `${name} should have a description`).toBeTruthy();
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  describe("vault_list", () => {
    it("returns vault summaries", async () => {
      mockedGetClient.mockResolvedValue({
        vaults: {
          list: vi.fn().mockResolvedValue([
            { id: "v1", name: "Personal", description: "My vault", type: "USER_CREATED" },
            { id: "v2", name: "Shared", description: null, type: "USER_CREATED" },
          ]),
        },
      } as any);

      const handler = registeredTools.get("vault_list")!.handler;
      const result = await handler({});
      const data = JSON.parse(result.content[0].text);

      expect(data.vaults).toHaveLength(2);
      expect(data.vaults[0].id).toBe("v1");
      expect(data.vaults[0].name).toBe("Personal");
      expect(result.isError).toBeUndefined();
    });

    it("returns error when SDK fails", async () => {
      mockedGetClient.mockRejectedValue(new Error("SDK error"));

      const handler = registeredTools.get("vault_list")!.handler;
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("SDK error");
    });
  });

  describe("item_lookup", () => {
    it("filters items by query", async () => {
      mockedGetClient.mockResolvedValue({
        items: {
          list: vi.fn().mockResolvedValue([
            { id: "i1", title: "GitHub Token", category: "Login", vaultId: "v1" },
            { id: "i2", title: "AWS Key", category: "Password", vaultId: "v1" },
            { id: "i3", title: "GitHub SSH", category: "Login", vaultId: "v1" },
          ]),
        },
      } as any);

      const handler = registeredTools.get("item_lookup")!.handler;
      const result = await handler({ vaultId: "v1", query: "github" });
      const data = JSON.parse(result.content[0].text);

      expect(data.items).toHaveLength(2);
      expect(data.count).toBe(2);
    });

    it("respects limit parameter", async () => {
      mockedGetClient.mockResolvedValue({
        items: {
          list: vi.fn().mockResolvedValue(
            Array.from({ length: 50 }, (_, i) => ({
              id: `i${i}`,
              title: `Item ${i}`,
              category: "Login",
              vaultId: "v1",
            })),
          ),
        },
      } as any);

      const handler = registeredTools.get("item_lookup")!.handler;
      const result = await handler({ vaultId: "v1", limit: 5 });
      const data = JSON.parse(result.content[0].text);

      expect(data.items).toHaveLength(5);
      expect(data.count).toBe(5);
    });
  });

  describe("password_generate", () => {
    it("generates a password of the default length", async () => {
      const handler = registeredTools.get("password_generate")!.handler;
      const result = await handler({});
      const data = JSON.parse(result.content[0].text);

      expect(data.password).toHaveLength(20);
      expect(result.isError).toBeUndefined();
    });

    it("respects custom length", async () => {
      const handler = registeredTools.get("password_generate")!.handler;
      const result = await handler({ length: 50 });
      const data = JSON.parse(result.content[0].text);

      expect(data.password).toHaveLength(50);
    });

    it("generates lowercase-only when options disabled", async () => {
      const handler = registeredTools.get("password_generate")!.handler;
      const result = await handler({
        length: 100,
        includeUppercase: false,
        includeNumbers: false,
        includeSymbols: false,
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.password).toMatch(/^[a-z]+$/);
    });
  });

  describe("password_generate_memorable", () => {
    it("generates a memorable password with default settings", async () => {
      const handler = registeredTools.get("password_generate_memorable")!.handler;
      const result = await handler({});
      const data = JSON.parse(result.content[0].text);

      expect(data.password).toBeTruthy();
      // Default: 3 words capitalized, separated by -, with number and symbol
      const parts = data.password.split("-");
      expect(parts.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("password_read", () => {
    it("resolves a secret reference", async () => {
      mockedGetClient.mockResolvedValue({
        secrets: {
          resolve: vi.fn().mockResolvedValue("my-secret-value"),
        },
      } as any);

      const handler = registeredTools.get("password_read")!.handler;
      const result = await handler({
        secretReference: "op://vault/item/password",
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.value).toBe("my-secret-value");
    });

    it("returns metadata only when reveal is false", async () => {
      mockedGetClient.mockResolvedValue({
        secrets: {
          resolve: vi.fn().mockResolvedValue("secret"),
        },
      } as any);

      const handler = registeredTools.get("password_read")!.handler;
      const result = await handler({
        secretReference: "op://vault/item/password",
        reveal: false,
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.resolved).toBe(true);
      expect(data.value).toBeUndefined();
    });

    it("errors when neither secretReference nor vaultId/itemId provided", async () => {
      mockedGetClient.mockResolvedValue({} as any);

      const handler = registeredTools.get("password_read")!.handler;
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Provide secretReference or both vaultId and itemId");
    });
  });

  describe("item_get", () => {
    const sampleItem = {
      id: "i1",
      title: "GitHub",
      category: "Login",
      vaultId: "v1",
      tags: ["dev"],
      notes: "personal account",
      sections: [{ id: "s1", title: "Extra" }],
      fields: [
        { id: "username", title: "username", fieldType: "Text", value: "octocat" },
        { id: "password", title: "password", fieldType: "Concealed", value: "s3cr3t" },
        { id: "pin", title: "pin", fieldType: "Concealed", value: "1234", sectionId: "s1" },
      ],
      websites: [{ url: "https://github.com", label: "website", autofillBehavior: "AnywhereOnWebsite" }],
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    };

    it("conceals concealed field values by default", async () => {
      mockedGetClient.mockResolvedValue({
        items: { get: vi.fn().mockResolvedValue(sampleItem) },
      } as any);

      const handler = registeredTools.get("item_get")!.handler;
      const result = await handler({ vaultId: "v1", itemId: "i1" });
      const data = JSON.parse(result.content[0].text);

      expect(data.title).toBe("GitHub");
      expect(data.notes).toBe("personal account");
      expect(data.tags).toEqual(["dev"]);
      const username = data.fields.find((f: any) => f.id === "username");
      const password = data.fields.find((f: any) => f.id === "password");
      expect(username.value).toBe("octocat");
      expect(password.value).toBe("[concealed]");
      expect(password.section).toBeUndefined();
      const pin = data.fields.find((f: any) => f.id === "pin");
      expect(pin.section).toBe("s1");
    });

    it("reveals concealed values when reveal is true", async () => {
      mockedGetClient.mockResolvedValue({
        items: { get: vi.fn().mockResolvedValue(sampleItem) },
      } as any);

      const handler = registeredTools.get("item_get")!.handler;
      const result = await handler({ vaultId: "v1", itemId: "i1", reveal: true });
      const data = JSON.parse(result.content[0].text);

      const password = data.fields.find((f: any) => f.id === "password");
      expect(password.value).toBe("s3cr3t");
    });

    it("resolves vault/item from a secret reference", async () => {
      const get = vi.fn().mockResolvedValue(sampleItem);
      mockedGetClient.mockResolvedValue({
        items: { get },
        secrets: {
          resolveAll: vi.fn().mockResolvedValue({
            individualResponses: {
              "op://Personal/GitHub/password": {
                content: { secret: "s3cr3t", itemId: "i1", vaultId: "v1" },
              },
            },
          }),
        },
      } as any);

      const handler = registeredTools.get("item_get")!.handler;
      const result = await handler({ secretReference: "op://Personal/GitHub/password" });
      const data = JSON.parse(result.content[0].text);

      expect(get).toHaveBeenCalledWith("v1", "i1");
      expect(data.id).toBe("i1");
    });

    it("errors when neither secretReference nor vaultId/itemId provided", async () => {
      mockedGetClient.mockResolvedValue({
        items: { get: vi.fn() },
      } as any);

      const handler = registeredTools.get("item_get")!.handler;
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Provide secretReference or both vaultId and itemId");
    });
  });

  describe("item_edit", () => {
    function makeClient() {
      const put = vi.fn().mockImplementation((item: any) => Promise.resolve(item));
      const get = vi.fn().mockResolvedValue({
        id: "i1",
        title: "Old Title",
        category: "Login",
        vaultId: "v1",
        tags: ["old"],
        notes: "old notes",
        sections: [],
        websites: [],
        fields: [
          { id: "username", title: "username", fieldType: "Text", value: "user" },
          { id: "password", title: "password", fieldType: "Concealed", value: "old-pass" },
          { id: "legacy", title: "legacy", fieldType: "Text", value: "remove-me" },
        ],
        version: 1,
        files: [],
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      });
      return { get, put };
    }

    it("updates title, replaces tags, and upserts/removes fields", async () => {
      const { get, put } = makeClient();
      mockedGetClient.mockResolvedValue({ items: { get, put } } as any);

      const handler = registeredTools.get("item_edit")!.handler;
      const result = await handler({
        vaultId: "v1",
        itemId: "i1",
        title: "New Title",
        tags: ["new"],
        fields: [
          { idOrTitle: "password", type: "concealed", value: "new-pass" },
          { idOrTitle: "api-key", type: "concealed", value: "abc123", section: "s1" },
        ],
        removeFields: ["legacy"],
      });
      const data = JSON.parse(result.content[0].text);

      expect(result.isError).toBeUndefined();
      const putArg = put.mock.calls[0][0];
      expect(putArg.title).toBe("New Title");
      expect(putArg.tags).toEqual(["new"]);
      // unreferenced field preserved
      expect(putArg.fields.find((f: any) => f.id === "username").value).toBe("user");
      // updated in place
      expect(putArg.fields.find((f: any) => f.id === "password").value).toBe("new-pass");
      // new field created
      const created = putArg.fields.find((f: any) => f.id === "api-key");
      expect(created.value).toBe("abc123");
      expect(created.fieldType).toBe("Concealed");
      expect(created.sectionId).toBe("s1");
      // removed
      expect(putArg.fields.find((f: any) => f.id === "legacy")).toBeUndefined();
      expect(data.title).toBe("New Title");
    });

    it("clears notes when given an empty string", async () => {
      const { get, put } = makeClient();
      mockedGetClient.mockResolvedValue({ items: { get, put } } as any);

      const handler = registeredTools.get("item_edit")!.handler;
      await handler({ vaultId: "v1", itemId: "i1", notes: "" });

      expect(put.mock.calls[0][0].notes).toBe("");
    });

    it("preserves notes when notes is omitted", async () => {
      const { get, put } = makeClient();
      mockedGetClient.mockResolvedValue({ items: { get, put } } as any);

      const handler = registeredTools.get("item_edit")!.handler;
      await handler({ vaultId: "v1", itemId: "i1", title: "X" });

      expect(put.mock.calls[0][0].notes).toBe("old notes");
    });

    it("errors when the SDK cannot update items", async () => {
      mockedGetClient.mockResolvedValue({
        items: { get: vi.fn().mockResolvedValue({}) },
      } as any);

      const handler = registeredTools.get("item_edit")!.handler;
      const result = await handler({ vaultId: "v1", itemId: "i1", title: "X" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("does not support updating items");
    });
  });
});
