/**
 * Tests for the op_run tool — executes local commands with 1Password
 * secrets injected as env vars, without ever returning secret plaintext.
 *
 * Uses the real Node binary (process.execPath) as the child process so
 * these tests are platform-independent (no reliance on /bin/sh vs cmd.exe
 * shell syntax) and do not depend on any external tool being on PATH.
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
    return registeredTools.get("op_run")!.handler;
  }

  it("resolves an op:// reference into env and the child process sees the value", async () => {
    mockedGetClient.mockResolvedValue({
      secrets: { resolve: vi.fn().mockResolvedValue("my-secret-value") },
    } as any);

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
    mockedGetClient.mockResolvedValue({
      secrets: { resolve: vi.fn().mockResolvedValue("my-secret-value") },
    } as any);

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
    const resolve = vi.fn();
    mockedGetClient.mockResolvedValue({ secrets: { resolve } } as any);

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
    expect(resolve).not.toHaveBeenCalled();
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
    const resolve = vi.fn();
    mockedGetClient.mockResolvedValue({ secrets: { resolve } } as any);

    const result = await handler()({
      argv: [node, "-e", "process.exit(0)"],
      env: { MY_SECRET: "op://personal/github/token" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not in the allowed vault list");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("errors when neither command nor argv is provided", async () => {
    mockedGetClient.mockResolvedValue({ secrets: { resolve: vi.fn() } } as any);

    const result = await handler()({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Provide either `command` or `argv`");
  });

  it("errors when both command and argv are provided", async () => {
    mockedGetClient.mockResolvedValue({ secrets: { resolve: vi.fn() } } as any);

    const result = await handler()({ command: "echo hi", argv: [node, "-e", "1"] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("only one of");
  });

  it("respects cwd when provided", async () => {
    mockedGetClient.mockResolvedValue({ secrets: { resolve: vi.fn() } } as any);
    const cwd = process.cwd();
    const normalize = (p: string) => p.toLowerCase().replace(/\\/g, "/").replace(/\/$/, "");

    const result = await handler()({
      argv: [node, "-e", "process.stdout.write(process.cwd())"],
      cwd,
    });
    const data = JSON.parse(result.content[0].text);

    expect(normalize(data.stdout)).toBe(normalize(cwd));
  });
});
