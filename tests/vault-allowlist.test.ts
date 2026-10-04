/**
 * Tests that the server-wide vault allow-list (OP_MCP_ALLOWED_VAULTS) is
 * enforced by every tool and resource that touches a vault — on the vault ID the
 * SDK call would actually use, and before any SDK read or write happens.
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
import { registerAllResources } from "../src/resources/index.js";

const mockedGetClient = vi.mocked(getClient);

const NOT_ALLOWED = "not in the allowed vault list";

const PROD = { id: "vlt-prod-0001", title: "Prod" };
const STAGING = { id: "vlt-staging-0002", title: "Staging" };

type SdkMethod = "list" | "get" | "put" | "create" | "delete" | "archive";

/** Every tool that takes a vault ID, with the SDK call that does its real work. */
const BY_ID_TOOLS: Array<{
  tool: string;
  sdkMethod: SdkMethod;
  args: (vaultId: string) => Record<string, unknown>;
}> = [
  { tool: "item_list", sdkMethod: "list", args: (vaultId) => ({ vaultId }) },
  { tool: "item_lookup", sdkMethod: "list", args: (vaultId) => ({ vaultId }) },
  {
    tool: "item_get",
    sdkMethod: "get",
    args: (vaultId) => ({ vaultId, itemId: "i1", reveal: true }),
  },
  {
    tool: "item_edit",
    sdkMethod: "put",
    args: (vaultId) => ({ vaultId, itemId: "i1", title: "Renamed" }),
  },
  { tool: "item_delete", sdkMethod: "delete", args: (vaultId) => ({ vaultId, itemId: "i1" }) },
  { tool: "item_archive", sdkMethod: "archive", args: (vaultId) => ({ vaultId, itemId: "i1" }) },
  {
    tool: "password_read",
    sdkMethod: "get",
    args: (vaultId) => ({ vaultId, itemId: "i1", reveal: true }),
  },
  {
    tool: "password_update",
    sdkMethod: "put",
    args: (vaultId) => ({ vaultId, itemId: "i1", newPassword: "new-pass" }),
  },
  {
    tool: "password_create",
    sdkMethod: "create",
    args: (vaultId) => ({ vaultId, title: "Created", password: "pw" }),
  },
  {
    tool: "note_create",
    sdkMethod: "create",
    args: (vaultId) => ({ vaultId, title: "Created", notes: "body" }),
  },
];

describe("vault allow-list enforcement", () => {
  let server: McpServer;
  let registeredTools: Map<string, any>;
  let registeredResources: Map<string, any>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    resetConfig();
    delete process.env.OP_MCP_ALLOWED_VAULTS;

    server = new McpServer({ name: "test", version: "0.0.0" });
    registeredTools = new Map();
    registeredResources = new Map();
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
    const originalResource = server.registerResource.bind(server);
    vi.spyOn(server, "registerResource").mockImplementation(((...args: any[]) => {
      const [name, , , handler] = args;
      registeredResources.set(name, handler);
      return originalResource(...(args as Parameters<typeof originalResource>));
    }) as any);
    registerAllTools(server);
    registerAllResources(server);
  });

  afterEach(() => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) delete process.env[key];
      else process.env[key] = originalEnv[key];
    });
    resetConfig();
  });

  function setAllowList(value: string) {
    process.env.OP_MCP_ALLOWED_VAULTS = value;
    resetConfig();
  }

  /** A mock client where every SDK operation succeeds; installed as getClient()'s result. */
  function makeClient(vaults: unknown[] = [PROD, STAGING]) {
    const timestamp = new Date("2024-01-01T00:00:00.000Z");
    const itemIn = (vaultId: string) => ({
      id: "i1",
      title: "Item",
      category: "Login",
      vaultId,
      tags: [],
      notes: "",
      sections: [],
      websites: [],
      fields: [{ id: "password", title: "password", fieldType: "Concealed", value: "pw-value" }],
      version: 1,
      files: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const client = {
      vaults: { list: vi.fn().mockResolvedValue(vaults) },
      items: {
        list: vi.fn().mockResolvedValue([
          {
            id: "i1",
            title: "Item",
            category: "Login",
            vaultId: PROD.id,
            tags: [],
            websites: [],
            state: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ]),
        get: vi.fn().mockImplementation(async (vaultId: string) => itemIn(vaultId)),
        put: vi.fn().mockImplementation(async (item: unknown) => item),
        create: vi.fn().mockImplementation(async (params: any) => ({
          id: "new1",
          title: params.title,
          vaultId: params.vaultId,
          category: params.category,
          tags: [],
          fields: [],
        })),
        delete: vi.fn().mockResolvedValue(undefined),
        archive: vi.fn().mockResolvedValue(undefined),
      },
      secrets: {
        resolve: vi.fn(),
        resolveAll: vi.fn(),
      },
    };
    mockedGetClient.mockResolvedValue(client as any);
    return client;
  }

  /** Assert that no item or secret SDK operation ran. */
  function expectNoSdkOperations(client: ReturnType<typeof makeClient>) {
    for (const fn of [
      ...Object.values(client.items),
      client.secrets.resolve,
      client.secrets.resolveAll,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  }

  function call(tool: string, args: Record<string, unknown>) {
    return registeredTools.get(tool)!.handler(args);
  }

  describe.each(BY_ID_TOOLS)("$tool", ({ tool, sdkMethod, args }) => {
    it("rejects a vault outside the allow-list before any SDK operation", async () => {
      setAllowList("Prod");
      const client = makeClient();

      const result = await call(tool, args(STAGING.id));

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(NOT_ALLOWED);
      expect(result.content[0].text).toContain(STAGING.id);
      expectNoSdkOperations(client);
    });

    it("rejects a vault ID that matches no vault at all", async () => {
      setAllowList("Prod");
      const client = makeClient();

      const result = await call(tool, args("vlt-unknown-9999"));

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(NOT_ALLOWED);
      expectNoSdkOperations(client);
    });

    it.each([
      ["by name", "Prod"],
      ["by name, in a different case", "pROD"],
      ["by ID", PROD.id],
      ["by ID, in a different case", PROD.id.toUpperCase()],
      ["among several entries", "Archive, Prod , Other"],
    ])("allows an allow-listed vault (%s)", async (_label, allowList) => {
      setAllowList(allowList);
      const client = makeClient();

      const result = await call(tool, args(PROD.id));

      expect(result.isError).toBeUndefined();
      expect(client.items[sdkMethod]).toHaveBeenCalledTimes(1);
      expect(client.vaults.list).toHaveBeenCalledTimes(1);
    });

    it("fails closed when the vaults cannot be listed", async () => {
      setAllowList("Prod");
      const client = makeClient();
      client.vaults.list.mockRejectedValue(new Error("vault listing unavailable"));

      const result = await call(tool, args(PROD.id));

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("vault listing unavailable");
      expectNoSdkOperations(client);
    });

    it("does not list vaults when no allow-list is configured", async () => {
      const client = makeClient();

      const result = await call(tool, args(STAGING.id));

      expect(result.isError).toBeUndefined();
      expect(client.items[sdkMethod]).toHaveBeenCalledTimes(1);
      expect(client.vaults.list).not.toHaveBeenCalled();
    });
  });

  describe("secret references (item_get, password_read)", () => {
    const refTools = ["item_get", "password_read"];

    /** Make resolveAll resolve `reference` to a secret in `vaultId`. */
    function resolveTo(
      client: ReturnType<typeof makeClient>,
      reference: string,
      vaultId: string,
    ) {
      client.secrets.resolveAll.mockResolvedValue({
        individualResponses: {
          [reference]: { content: { secret: "ref-secret-value", itemId: "i1", vaultId } },
        },
      });
    }

    describe.each(refTools)("%s", (tool) => {
      it("rejects a reference naming a vault outside the allow-list before resolving", async () => {
        setAllowList("Prod");
        const client = makeClient();

        const result = await call(tool, {
          secretReference: "op://Staging/db/password",
          reveal: true,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(NOT_ALLOWED);
        expectNoSdkOperations(client);
        expect(client.vaults.list).not.toHaveBeenCalled();
        expect(mockedGetClient).not.toHaveBeenCalled();
      });

      it("rejects when an allow-listed reference resolves to a vault outside the allowed set", async () => {
        setAllowList("Prod");
        const client = makeClient();
        resolveTo(client, "op://Prod/db/password", STAGING.id);

        const result = await call(tool, {
          secretReference: "op://Prod/db/password",
          reveal: true,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(NOT_ALLOWED);
        expect(result.content[0].text).toContain(STAGING.id);
        expect(result.content[0].text).not.toContain("ref-secret-value");
        expect(client.secrets.resolveAll).toHaveBeenCalledWith(["op://Prod/db/password"]);
        expect(client.items.get).not.toHaveBeenCalled();
      });

      it.each([
        ["by name", "Prod", "op://Prod/db/password"],
        ["by ID", PROD.id, `op://${PROD.id}/db/password`],
        ["by name, in a different case", "prod", "op://PROD/db/password"],
      ])(
        "resolves a reference to an allow-listed vault (%s)",
        async (_label, allowList, reference) => {
          setAllowList(allowList);
          const client = makeClient();
          resolveTo(client, reference, PROD.id);

          const result = await call(tool, { secretReference: reference, reveal: true });

          expect(result.isError).toBeUndefined();
          const data = JSON.parse(result.content[0].text);
          if (tool === "password_read") {
            expect(data).toEqual({ value: "ref-secret-value" });
          } else {
            expect(client.items.get).toHaveBeenCalledWith(PROD.id, "i1");
            expect(data.vaultId).toBe(PROD.id);
          }
        },
      );

      it("does not list vaults when no allow-list is configured", async () => {
        const client = makeClient();
        resolveTo(client, "op://Staging/db/password", STAGING.id);

        const result = await call(tool, { secretReference: "op://Staging/db/password" });

        expect(result.isError).toBeUndefined();
        expect(client.vaults.list).not.toHaveBeenCalled();
      });

      it("ignores vaultId/itemId when a secretReference is given", async () => {
        setAllowList("Prod");
        const client = makeClient();
        resolveTo(client, "op://Prod/db/password", PROD.id);

        const result = await call(tool, {
          secretReference: "op://Prod/db/password",
          vaultId: STAGING.id,
          itemId: "i9",
        });

        expect(result.isError).toBeUndefined();
      });
    });

    it("password_read never calls secrets.resolve, so the vault can always be checked", async () => {
      const client = makeClient();
      resolveTo(client, "op://Prod/db/password", PROD.id);

      await call("password_read", { secretReference: "op://Prod/db/password" });

      expect(client.secrets.resolve).not.toHaveBeenCalled();
      expect(client.secrets.resolveAll).toHaveBeenCalledWith(["op://Prod/db/password"]);
    });
  });

  describe("vault_list", () => {
    it("returns only the allow-listed vaults (by name) with a single vaults.list call", async () => {
      setAllowList("Prod");
      const client = makeClient([
        { ...PROD, description: "production" },
        { ...STAGING, description: "staging" },
      ]);

      const result = await call("vault_list", {});
      const data = JSON.parse(result.content[0].text);

      expect(data.vaults.map((v: any) => v.id)).toEqual([PROD.id]);
      expect(data.vaults[0].name).toBe("Prod");
      expect(data.vaults[0].description).toBe("production");
      expect(result.content[0].text).not.toContain(STAGING.id);
      expect(client.vaults.list).toHaveBeenCalledTimes(1);
    });

    it("returns only the allow-listed vaults (by ID, case-insensitive) with a single vaults.list call", async () => {
      setAllowList(STAGING.id.toUpperCase());
      const client = makeClient();

      const result = await call("vault_list", {});
      const data = JSON.parse(result.content[0].text);

      expect(data.vaults.map((v: any) => v.id)).toEqual([STAGING.id]);
      expect(client.vaults.list).toHaveBeenCalledTimes(1);
    });

    it("returns an empty list when no vault matches the allow-list", async () => {
      setAllowList("Nonexistent");
      makeClient();

      const result = await call("vault_list", {});

      expect(JSON.parse(result.content[0].text)).toEqual({ vaults: [] });
    });

    it("surfaces a vaults.list failure instead of listing anything", async () => {
      setAllowList("Prod");
      const client = makeClient();
      client.vaults.list.mockRejectedValue(new Error("vault listing unavailable"));

      const result = await call("vault_list", {});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("vault listing unavailable");
    });

    it("returns every vault with a single vaults.list call when unrestricted", async () => {
      const client = makeClient();

      const result = await call("vault_list", {});
      const data = JSON.parse(result.content[0].text);

      expect(data.vaults.map((v: any) => v.id)).toEqual([PROD.id, STAGING.id]);
      expect(client.vaults.list).toHaveBeenCalledTimes(1);
    });
  });

  describe("1password://vaults resource", () => {
    async function readVaults() {
      const result = await registeredResources.get("vault-list")();
      return JSON.parse(result.contents[0].text);
    }

    it("returns only the allow-listed vaults (by name) with a single vaults.list call", async () => {
      setAllowList("Prod");
      const client = makeClient();

      const data = await readVaults();

      expect(data.vaults.map((v: any) => v.id)).toEqual([PROD.id]);
      expect(JSON.stringify(data)).not.toContain(STAGING.id);
      expect(client.vaults.list).toHaveBeenCalledTimes(1);
    });

    it("returns only the allow-listed vaults (by ID, case-insensitive) with a single vaults.list call", async () => {
      setAllowList(STAGING.id.toUpperCase());
      const client = makeClient();

      const data = await readVaults();

      expect(data.vaults.map((v: any) => v.id)).toEqual([STAGING.id]);
      expect(client.vaults.list).toHaveBeenCalledTimes(1);
    });

    it("returns an empty list when no vault matches the allow-list", async () => {
      setAllowList("Nonexistent");
      makeClient();

      const data = await readVaults();

      expect(data).toEqual({ vaults: [] });
    });

    it("reports a vaults.list failure instead of listing anything", async () => {
      setAllowList("Prod");
      const client = makeClient();
      client.vaults.list.mockRejectedValue(new Error("vault listing unavailable"));

      const data = await readVaults();

      expect(data.error).toContain("vault listing unavailable");
      expect(data.vaults).toBeUndefined();
    });

    it("returns every vault with a single vaults.list call when unrestricted", async () => {
      const client = makeClient();

      const data = await readVaults();

      expect(data.vaults.map((v: any) => v.id)).toEqual([PROD.id, STAGING.id]);
      expect(client.vaults.list).toHaveBeenCalledTimes(1);
    });
  });

  describe("1password://vaults/{vaultId}/items resource", () => {
    async function readItems(vaultId: string) {
      // Passed as a string: the handler accepts string or URL, and a URL object
      // cannot be built for the `1password:` scheme (a scheme can't start with a digit).
      const result = await registeredResources.get("vault-items")(
        `1password://vaults/${vaultId}/items`,
      );
      return JSON.parse(result.contents[0].text);
    }

    it("rejects a vault outside the allow-list before listing items", async () => {
      setAllowList("Prod");
      const client = makeClient();

      const data = await readItems(STAGING.id);

      expect(data.error).toContain(NOT_ALLOWED);
      expect(data.items).toBeUndefined();
      expect(client.items.list).not.toHaveBeenCalled();
    });

    it.each([
      ["by name", "Prod"],
      ["by ID", PROD.id],
    ])("lists items of an allow-listed vault (%s)", async (_label, allowList) => {
      setAllowList(allowList);
      const client = makeClient();

      const data = await readItems(PROD.id);

      expect(data.error).toBeUndefined();
      expect(data.vaultId).toBe(PROD.id);
      expect(data.count).toBe(1);
      expect(client.items.list).toHaveBeenCalledWith(PROD.id);
    });

    it("does not list vaults when no allow-list is configured", async () => {
      const client = makeClient();

      const data = await readItems(STAGING.id);

      expect(data.error).toBeUndefined();
      expect(client.items.list).toHaveBeenCalledWith(STAGING.id);
      expect(client.vaults.list).not.toHaveBeenCalled();
    });
  });

  describe("tools that never touch a vault", () => {
    it("password_generate works with an allow-list and no vault listing", async () => {
      setAllowList("Prod");
      const client = makeClient();

      const result = await call("password_generate", {});

      expect(result.isError).toBeUndefined();
      expect(client.vaults.list).not.toHaveBeenCalled();
    });
  });
});
