/**
 * End-to-end tests for the MCP resources.
 *
 * A real MCP client talks to the production server composition
 * (`serveStdio(() => buildServer())`) over an in-memory transport pair, so
 * every request goes through the SDK's own `resources/list`,
 * `resources/templates/list`, and `resources/read` handling — URI parsing,
 * static lookup, and template matching — instead of calling our callbacks
 * directly. Only the 1Password SDK client is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  Client,
  ProtocolErrorCode,
  UriTemplate,
  type ClientOptions,
} from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

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
import { resetConfig, SERVER_NAME, SERVER_VERSION } from "../src/config.js";
import { buildServer } from "../src/server.js";

const mockedGetClient = vi.mocked(getClient);

const PROD = { id: "vlt-prod-0001", title: "Prod", description: "Production", type: "USER_CREATED" };
const CI = { id: "vlt-ci-0002", title: "CI", type: "USER_CREATED" };
const DEPLOY_KEY = { id: "itm-0001", title: "Deploy key", category: "SshKey", vaultId: PROD.id };

const ERAS: { era: "legacy" | "modern"; options: ClientOptions }[] = [
  { era: "legacy", options: {} },
  { era: "modern", options: { versionNegotiation: { mode: { pin: "2026-07-28" } } } },
];

describe.each(ERAS)("MCP resources end-to-end ($era protocol era)", ({ era, options }) => {
  const originalEnv = { ...process.env };
  let client: Client;
  let closeServer: () => Promise<void>;
  let opClient: {
    vaults: { list: ReturnType<typeof vi.fn> };
    items: { list: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    opClient = {
      vaults: { list: vi.fn().mockResolvedValue([PROD, CI]) },
      items: { list: vi.fn().mockResolvedValue([DEPLOY_KEY]) },
    };
    mockedGetClient.mockResolvedValue(opClient as any);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const handle = serveStdio(() => buildServer(), { transport: serverTransport });
    closeServer = () => handle.close();

    client = new Client({ name: "resources-e2e", version: "0.0.0" }, options);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await closeServer();
    process.env = { ...originalEnv };
    resetConfig();
  });

  async function readJson(uri: string) {
    const result = await client.readResource({ uri });
    expect(result.contents).toHaveLength(1);
    const [content] = result.contents;
    expect(content.uri).toBe(uri);
    expect(content.mimeType).toBe("application/json");
    return JSON.parse((content as { text: string }).text);
  }

  it(`negotiates the ${era} protocol era`, () => {
    expect(client.getProtocolEra()).toBe(era);
  });

  it("lists the static resources under onepassword:// URIs", async () => {
    const { resources } = await client.listResources();

    expect(resources.map((r) => r.uri).sort()).toEqual([
      "onepassword://config",
      "onepassword://vaults",
    ]);
  });

  it("lists the per-vault items resource as a URI template", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();

    expect(resourceTemplates).toEqual([
      expect.objectContaining({
        name: "vault-items",
        uriTemplate: "onepassword://vaults/{vaultId}/items",
        mimeType: "application/json",
      }),
    ]);
  });

  it("can read every advertised resource and template", async () => {
    const { resources } = await client.listResources();
    const { resourceTemplates } = await client.listResourceTemplates();
    const uris = [
      ...resources.map((r) => r.uri),
      ...resourceTemplates.map((t) => {
        const template = new UriTemplate(t.uriTemplate);
        return template.expand(
          Object.fromEntries(template.variableNames.map((name) => [name, "sample"])),
        );
      }),
    ];

    expect(uris).toHaveLength(3);
    for (const uri of uris) {
      expect((await readJson(uri)).error, uri).toBeUndefined();
    }
  });

  it("reads onepassword://config without the service account token", async () => {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "ops_e2e-sentinel-token";
    resetConfig();

    const result = await client.readResource({ uri: "onepassword://config" });
    const text = (result.contents[0] as { text: string }).text;

    expect(JSON.parse(text)).toMatchObject({
      serverName: SERVER_NAME,
      serverVersion: SERVER_VERSION,
      tokenSource: "env",
      nodeVersion: process.version,
    });
    expect(text).not.toContain("ops_e2e-sentinel-token");
  });

  it("reads onepassword://vaults", async () => {
    const data = await readJson("onepassword://vaults");

    expect(data).toEqual({
      vaults: [
        { id: PROD.id, name: "Prod", description: "Production", type: "USER_CREATED" },
        { id: CI.id, name: "CI", type: "USER_CREATED" },
      ],
    });
    expect(opClient.vaults.list).toHaveBeenCalledTimes(1);
  });

  it("reads onepassword://vaults/{vaultId}/items for the vault named in the URI", async () => {
    const data = await readJson(`onepassword://vaults/${PROD.id}/items`);

    expect(data).toEqual({
      vaultId: PROD.id,
      items: [{ id: DEPLOY_KEY.id, title: "Deploy key", category: "SshKey", vaultId: PROD.id }],
      count: 1,
    });
    expect(opClient.items.list).toHaveBeenCalledExactlyOnceWith(PROD.id);
  });

  it("percent-decodes the vaultId template variable", async () => {
    const data = await readJson("onepassword://vaults/vault%20one/items");

    expect(data.vaultId).toBe("vault one");
    expect(opClient.items.list).toHaveBeenCalledExactlyOnceWith("vault one");
  });

  it("rejects a malformed percent-encoded vaultId without calling 1Password", async () => {
    const data = await readJson("onepassword://vaults/%E0%A4%A/items");

    expect(data.error).toContain("not valid percent-encoding");
    expect(opClient.items.list).not.toHaveBeenCalled();
  });

  it("reports a 1Password failure in the resource payload", async () => {
    opClient.items.list.mockRejectedValue(new Error("vault not found"));

    const data = await readJson("onepassword://vaults/vlt-missing/items");

    expect(data).toEqual({ error: "vault not found" });
  });

  it("rejects the old 1password:// scheme as an invalid URI", async () => {
    // Why the scheme changed: the SDK parses the URI with `new URL()` before
    // dispatching, and a scheme cannot start with a digit.
    await expect(
      client.readResource({ uri: "1password://config" }),
    ).rejects.toMatchObject({ code: ProtocolErrorCode.InvalidParams });
    expect(mockedGetClient).not.toHaveBeenCalled();
  });

  describe("with OP_MCP_ALLOWED_VAULTS", () => {
    beforeEach(() => {
      process.env.OP_MCP_ALLOWED_VAULTS = "Prod";
      resetConfig();
    });

    it("lists only the allow-listed vaults", async () => {
      const data = await readJson("onepassword://vaults");

      expect(data.vaults.map((v: { id: string }) => v.id)).toEqual([PROD.id]);
    });

    it("refuses items of a vault outside the allow-list without listing them", async () => {
      const data = await readJson(`onepassword://vaults/${CI.id}/items`);

      expect(data.error).toContain("not in the allowed vault list");
      expect(opClient.items.list).not.toHaveBeenCalled();
    });

    it("checks the decoded vaultId, so percent-encoding cannot bypass the allow-list", async () => {
      const encode = (id: string) => [...id].map((c) => `%${c.charCodeAt(0).toString(16)}`).join("");

      const refused = await readJson(`onepassword://vaults/${encode(CI.id)}/items`);
      const allowed = await readJson(`onepassword://vaults/${encode(PROD.id)}/items`);

      expect(refused.error).toContain("not in the allowed vault list");
      expect(allowed.vaultId).toBe(PROD.id);
      expect(opClient.items.list).toHaveBeenCalledExactlyOnceWith(PROD.id);
    });
  });
});
