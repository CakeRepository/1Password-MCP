/**
 * Tests for MCP Prompts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the client and logger
vi.mock("../src/client.js", () => ({
  getClient: vi.fn(),
  requireServiceAccountToken: vi.fn(() => "mock-token"),
}));
vi.mock("../src/logger.js", () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllPrompts } from "../src/prompts/index.js";

describe("MCP Prompts", () => {
  let server: McpServer;
  let registeredPrompts: Map<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer({ name: "test", version: "0.0.0" });

    registeredPrompts = new Map();
    const originalPrompt = server.prompt.bind(server);
    vi.spyOn(server, "prompt").mockImplementation((...args: any[]) => {
      // (name, description, params, handler)
      if (args.length === 4) {
        registeredPrompts.set(args[0], {
          description: args[1],
          params: args[2],
          handler: args[3],
        });
      }
      return originalPrompt(...args);
    });

    registerAllPrompts(server);
  });

  it("registers all 4 prompts", () => {
    expect(registeredPrompts.size).toBe(4);
    expect(registeredPrompts.has("generate-secure-password")).toBe(true);
    expect(registeredPrompts.has("credential-rotation")).toBe(true);
    expect(registeredPrompts.has("vault-audit")).toBe(true);
    expect(registeredPrompts.has("secret-reference-helper")).toBe(true);
  });

  it("all prompts have descriptions", () => {
    for (const [name, prompt] of registeredPrompts) {
      expect(prompt.description, `${name} should have a description`).toBeTruthy();
      expect(typeof prompt.description).toBe("string");
    }
  });

  describe("generate-secure-password", () => {
    it("returns a message with password generation instructions", async () => {
      const handler = registeredPrompts.get("generate-secure-password")!.handler;
      const result = await handler({});

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content.text).toContain("password_generate");
    });

    it("includes purpose in the prompt when provided", async () => {
      const handler = registeredPrompts.get("generate-secure-password")!.handler;
      const result = await handler({ purpose: "database" });

      expect(result.messages[0].content.text).toContain("database");
    });

    it("switches to memorable style when requested", async () => {
      const handler = registeredPrompts.get("generate-secure-password")!.handler;
      const result = await handler({ style: "memorable" });

      expect(result.messages[0].content.text).toContain("memorable passphrase");
      expect(result.messages[0].content.text).toContain("password_generate_memorable");
    });
  });

  describe("credential-rotation", () => {
    it("generates rotation workflow without target", async () => {
      const handler = registeredPrompts.get("credential-rotation")!.handler;
      const result = await handler({});

      expect(result.messages[0].content.text).toContain("vault_list");
      expect(result.messages[0].content.text).toContain("password_update");
    });

    it("skips vault discovery when target is specified", async () => {
      const handler = registeredPrompts.get("credential-rotation")!.handler;
      const result = await handler({ vaultId: "v1", itemId: "i1" });

      expect(result.messages[0].content.text).toContain("v1");
      expect(result.messages[0].content.text).toContain("i1");
    });
  });

  describe("vault-audit", () => {
    it("asks to list vaults when no vaultId is given", async () => {
      const handler = registeredPrompts.get("vault-audit")!.handler;
      const result = await handler({});

      expect(result.messages[0].content.text).toContain("vault_list");
    });

    it("skips vault listing when vaultId is provided", async () => {
      const handler = registeredPrompts.get("vault-audit")!.handler;
      const result = await handler({ vaultId: "v123" });

      expect(result.messages[0].content.text).toContain("v123");
      expect(result.messages[0].content.text).toContain("item_lookup");
    });
  });

  describe("secret-reference-helper", () => {
    it("generates reference construction instructions", async () => {
      const handler = registeredPrompts.get("secret-reference-helper")!.handler;
      const result = await handler({});

      expect(result.messages[0].content.text).toContain("op://");
      expect(result.messages[0].content.text).toContain("vault_list");
    });

    it("includes vault and item names when provided", async () => {
      const handler = registeredPrompts.get("secret-reference-helper")!.handler;
      const result = await handler({ vaultName: "Dev", itemName: "DB Password" });

      expect(result.messages[0].content.text).toContain("Dev");
      expect(result.messages[0].content.text).toContain("DB Password");
    });
  });
});
