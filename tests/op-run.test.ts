/**
 * Tests for the op_run tool — executes local commands with 1Password
 * secrets injected as env vars, without ever returning secret plaintext.
 *
 * Uses the real Node binary (process.execPath) as the child process so
 * these tests are platform-independent (no reliance on /bin/sh vs cmd.exe
 * shell syntax) and do not depend on any external tool being on PATH.
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
const node = process.execPath;

describe("op_run", () => {
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
    return registeredTools.get("op_run")!.handler;
  }

  function mockBulkResolve(values: Record<string, string>) {
    const resolveAll = vi.fn().mockImplementation(async (references: string[]) => ({
      individualResponses: Object.fromEntries(
        references.map((reference) => [reference, { content: { secret: values[reference] ?? "" } }]),
      ),
    }));
    mockedGetClient.mockResolvedValue({ secrets: { resolveAll } } as any);
    return resolveAll;
  }

  it("resolves an op:// reference into env and the child process sees the value", async () => {
    mockBulkResolve({ "op://Private/github/token": "my-secret-value" });

    const result = await handler()({
      argv: [
        node,
        "-e",
        "process.exit(process.env.MY_SECRET === 'my-secret-value' ? 0 : 1)",
      ],
      env: { MY_SECRET: "op://Private/github/token" },
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.exitCode).toBe(0);
  });

  it("redacts the resolved secret value out of stdout even if the command echoes it", async () => {
    mockBulkResolve({ "op://Private/github/token": "my-secret-value" });

    const result = await handler()({
      argv: [node, "-e", "process.stdout.write('token=' + process.env.MY_SECRET)"],
      env: { MY_SECRET: "op://Private/github/token" },
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.exitCode).toBe(0);
    expect(data.stdout).not.toContain("my-secret-value");
    expect(data.stdout).toBe("token=«REDACTED:MY_SECRET»");
  });

  it("passes literal (non op://) env values through unchanged without calling 1Password", async () => {
    const result = await handler()({
      argv: [
        node,
        "-e",
        "process.exit(process.env.PLAIN_VAR === 'plain-value' ? 0 : 1)",
      ],
      env: { PLAIN_VAR: "plain-value" },
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.exitCode).toBe(0);
    expect(mockedGetClient).not.toHaveBeenCalled();
  });

  it("captures a nonzero exit code and stderr", async () => {
    mockedGetClient.mockResolvedValue({ secrets: { resolve: vi.fn() } } as any);

    const result = await handler()({
      argv: [node, "-e", "process.stderr.write('boom'); process.exit(7)"],
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.exitCode).toBe(7);
    expect(data.stderr).toContain("boom");
  });

  it("rejects an op:// reference from a vault outside a configured allow-list", async () => {
    process.env.OP_MCP_ALLOWED_VAULTS = "Private";
    resetConfig();
    const resolveAll = vi.fn();
    mockedGetClient.mockResolvedValue({ secrets: { resolveAll } } as any);

    const result = await handler()({
      argv: [node, "-e", "process.exit(0)"],
      env: { MY_SECRET: "op://personal/github/token" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not in the allowed vault list");
    expect(resolveAll).not.toHaveBeenCalled();
  });

  it("errors when neither command nor argv is provided", async () => {
    const result = await handler()({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Provide either `command` or `argv`");
  });

  it("errors when both command and argv are provided", async () => {
    const result = await handler()({ command: "echo hi", argv: [node, "-e", "1"] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("only one of");
  });

  it("respects cwd when provided", async () => {
    const cwd = process.cwd();
    const normalize = (p: string) => p.toLowerCase().replace(/\\/g, "/").replace(/\/$/, "");

    const result = await handler()({
      argv: [node, "-e", "process.stdout.write(process.cwd())"],
      cwd,
    });
    const data = JSON.parse(result.content[0].text);

    expect(normalize(data.stdout)).toBe(normalize(cwd));
  });

  it("resolves multiple secret references with one bulk SDK request", async () => {
    const resolveAll = mockBulkResolve({
      "op://Private/first/token": "first-value",
      "op://Private/second/token": "second-value",
    });

    const result = await handler()({
      argv: [node, "-e", "process.exit(process.env.FIRST && process.env.SECOND ? 0 : 1)"],
      env: {
        FIRST: "op://Private/first/token",
        SECOND: "op://Private/second/token",
      },
    });

    expect(result.isError).toBeUndefined();
    expect(resolveAll).toHaveBeenCalledOnce();
    expect(resolveAll).toHaveBeenCalledWith([
      "op://Private/first/token",
      "op://Private/second/token",
    ]);
  });

  it("strips server OP_SERVICE_ACCOUNT_TOKEN and keychain credentials from child environment", async () => {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "ops_secret_master_token_12345";
    process.env.OP_KEYCHAIN_SERVICE = "my-keychain-svc";
    process.env.OP_KEYCHAIN_ACCOUNT = "my-keychain-acc";
    resetConfig();

    const result = await handler()({
      argv: [
        node,
        "-e",
        "process.stdout.write(JSON.stringify({ token: process.env.OP_SERVICE_ACCOUNT_TOKEN, svc: process.env.OP_KEYCHAIN_SERVICE, acc: process.env.OP_KEYCHAIN_ACCOUNT }))",
      ],
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.exitCode).toBe(0);
    const envObserved = JSON.parse(data.stdout);
    expect(envObserved.token).toBeUndefined();
    expect(envObserved.svc).toBeUndefined();
    expect(envObserved.acc).toBeUndefined();
  });

  it("redacts server OP_SERVICE_ACCOUNT_TOKEN from output as defense-in-depth", async () => {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "ops_secret_master_token_12345";
    resetConfig();

    const result = await handler()({
      argv: [
        node,
        "-e",
        "process.stdout.write('leaked=' + 'ops_secret_master_token_12345'); process.stderr.write('err=' + 'ops_secret_master_token_12345')",
      ],
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.exitCode).toBe(0);
    expect(data.stdout).not.toContain("ops_secret_master_token_12345");
    expect(data.stderr).not.toContain("ops_secret_master_token_12345");
    expect(data.stdout).toBe("leaked=«REDACTED:OP_SERVICE_ACCOUNT_TOKEN»");
    expect(data.stderr).toBe("err=«REDACTED:OP_SERVICE_ACCOUNT_TOKEN»");
  });

  it("allows caller to explicitly inject OP_SERVICE_ACCOUNT_TOKEN via op:// reference and redacts it", async () => {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "original-server-token";
    resetConfig();
    mockBulkResolve({ "op://Private/custom/token": "injected-custom-token" });

    const result = await handler()({
      argv: [
        node,
        "-e",
        "process.stdout.write('active=' + process.env.OP_SERVICE_ACCOUNT_TOKEN)",
      ],
      env: { OP_SERVICE_ACCOUNT_TOKEN: "op://Private/custom/token" },
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.exitCode).toBe(0);
    expect(data.stdout).not.toContain("injected-custom-token");
    expect(data.stdout).not.toContain("original-server-token");
    expect(data.stdout).toBe("active=«REDACTED:OP_SERVICE_ACCOUNT_TOKEN»");
  });

  it("redacts secret value before truncation when output exceeds max buffer size", async () => {
    mockBulkResolve({ "op://Private/secret/key": "supersecretkey999" });

    // Secret straddles the 5 MiB boundary (bytes 5,242,870 to 5,242,887)
    const paddingLength = 5 * 1024 * 1024 - 10;
    const result = await handler()({
      argv: [
        node,
        "-e",
        `process.stdout.write('A'.repeat(${paddingLength}) + process.env.MY_SECRET + 'trailing')`,
      ],
      env: { MY_SECRET: "op://Private/secret/key" },
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.exitCode).toBe(0);
    expect(data.stdoutTruncated).toBe(true);
    expect(data.stdout).not.toContain("supersecretkey999");
    expect(data.stdout).not.toContain("supersecre");
    expect(data.stdout).toContain("«REDACTED");
  });
});
