/**
 * Tests for the op_run tool — executes local commands with 1Password
 * secrets injected as env vars, redacting them from the returned output.
 *
 * Uses the real Node binary (process.execPath) as the child process so
 * these tests are platform-independent (no reliance on /bin/sh vs cmd.exe
 * shell syntax) and do not depend on any external tool being on PATH.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { buildRedactionPatterns, maxPatternByteLength } from "../src/redaction.js";
import { registerAllTools } from "../src/tools/index.js";

// Every test spawns real processes, which can take seconds on a loaded Windows machine.
vi.setConfig({ testTimeout: 30_000 });

const mockedGetClient = vi.mocked(getClient);
const node = process.execPath;
const isWindows = process.platform === "win32";
const MIB = 1024 * 1024;

/** True while the process exists (a killed-but-unreaped zombie counts as gone). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform === "linux") {
    try {
      return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
    } catch {
      return false;
    }
  }
  return true;
}

async function waitUntilDead(pid: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

/** Clean up a process a test deliberately left running. */
function killQuietly(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 1) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

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

  /**
   * Mock the SDK's bulk `secrets.resolveAll`. By default responses carry only the
   * secret and the client has no `vaults`, like the original callers expect.
   * `vaultIds` sets the vault ID each reference resolves to; `vaults` adds a
   * `vaults.list` mock, exposed as `resolveAll.vaultsList`.
   */
  function mockBulkResolve(
    values: Record<string, string>,
    options: {
      vaultIds?: Record<string, string>;
      vaults?: { id: string; title: string }[];
    } = {},
  ) {
    const resolveAll = vi.fn().mockImplementation(async (references: string[]) => ({
      individualResponses: Object.fromEntries(
        references.map((reference) => {
          const vaultId = options.vaultIds?.[reference];
          return [
            reference,
            { content: { secret: values[reference] ?? "", ...(vaultId !== undefined ? { vaultId } : {}) } },
          ];
        }),
      ),
    }));
    const vaultsList = vi.fn().mockResolvedValue(options.vaults ?? []);
    mockedGetClient.mockResolvedValue({
      secrets: { resolveAll },
      ...(options.vaults ? { vaults: { list: vaultsList } } : {}),
    } as any);
    return Object.assign(resolveAll, { vaultsList });
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

  it("describes redaction as best-effort rather than a guarantee", () => {
    const description: string = registeredTools.get("op_run")!.description;

    expect(description).toMatch(/best-effort/i);
    expect(description).not.toMatch(/never returned/i);
    expect(description).toContain("op://");
  });

  it("runs a shell command line when `command` is given", async () => {
    const result = await handler()({ command: "echo shell-ok" });
    const data = JSON.parse(result.content[0].text);

    expect(data.exitCode).toBe(0);
    expect(data.timedOut).toBe(false);
    expect(data.stdout.trim()).toBe("shell-ok");
  });

  it("returns an error result when the executable cannot be spawned, redacting secrets in it", async () => {
    mockBulkResolve({ "op://Private/api/key": "hunter2-hunter2" });

    const result = await handler()({
      argv: ["no-such-binary-hunter2-hunter2"],
      env: { MY_SECRET: "op://Private/api/key" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ENOENT");
    expect(result.content[0].text).not.toContain("hunter2-hunter2");
  });

  describe("redaction of overlapping and encoded secrets", () => {
    it("masks a secret that contains another secret without leaking the remainder", async () => {
      mockBulkResolve({
        "op://Private/api/user": "svc-bot",
        "op://Private/api/credentials": "svc-bot:Zx9-real-secret",
      });
      const script =
        "process.stdout.write('auth=' + process.env.API_CREDENTIALS + ' user=' + process.env.API_USER)";

      for (const env of [
        { API_USER: "op://Private/api/user", API_CREDENTIALS: "op://Private/api/credentials" },
        { API_CREDENTIALS: "op://Private/api/credentials", API_USER: "op://Private/api/user" },
      ]) {
        const result = await handler()({ argv: [node, "-e", script], env });
        const data = JSON.parse(result.content[0].text);

        expect(data.exitCode).toBe(0);
        expect(data.stdout).not.toContain("Zx9-real-secret");
        expect(data.stdout).not.toContain("svc-bot");
        expect(data.stdout).toMatch(/^auth=«REDACTED:API_[A-Z_,]+» user=«REDACTED:API_USER»$/);
      }
    });

    it("masks a secret embedded in a base64 payload at every alignment", async () => {
      const secret = "Zx9-real-secret-value";
      mockBulkResolve({ "op://Private/api/key": secret });

      const script = [
        "const secret = process.env.SECRET;",
        "const lines = [];",
        "for (let p = 0; p <= 5; p++) lines.push(Buffer.from('x'.repeat(p) + secret + 'tail').toString('base64'));",
        "lines.push(Buffer.from('user:' + secret).toString('base64'));",
        "process.stdout.write(lines.join('\\n'));",
      ].join("\n");
      const payloads = [0, 1, 2, 3, 4, 5]
        .map((p) => Buffer.from("x".repeat(p) + secret + "tail").toString("base64"))
        .concat(Buffer.from("user:" + secret).toString("base64"));

      const result = await handler()({
        argv: [node, "-e", script],
        env: { SECRET: "op://Private/api/key" },
      });
      const data = JSON.parse(result.content[0].text);
      const lines: string[] = data.stdout.split("\n");

      expect(data.exitCode).toBe(0);
      expect(lines).toHaveLength(payloads.length);
      payloads.forEach((payload, index) => {
        expect(data.stdout).not.toContain(payload);
        // Only a few edge characters of the payload may survive around the marker.
        expect(lines[index]).not.toContain(payload.slice(6, -6));
        expect(lines[index]).toContain("«REDACTED:SECRET»");
      });
    });

    it("masks JSON-escaped and URL-encoded forms of a secret", async () => {
      const secret = 'pa"ss\\wo/rd+x=y z';
      mockBulkResolve({ "op://Private/api/pass": secret });

      const script =
        "const s = process.env.SECRET; process.stdout.write([JSON.stringify({ password: s }), encodeURIComponent(s), 'plain ' + s].join('\\n'))";
      const result = await handler()({
        argv: [node, "-e", script],
        env: { SECRET: "op://Private/api/pass" },
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.exitCode).toBe(0);
      expect(data.stdout).not.toContain(secret);
      expect(data.stdout).not.toContain(JSON.stringify(secret).slice(1, -1));
      expect(data.stdout).not.toContain(encodeURIComponent(secret));
      expect(data.stdout.split("\n")).toEqual([
        '{"password":"«REDACTED:SECRET»"}',
        "«REDACTED:SECRET»",
        "plain «REDACTED:SECRET»",
      ]);
    });

    it("masks a multi-line secret printed with CRLF line endings or re-indented", async () => {
      const lines = [
        "-----BEGIN TEST KEY-----",
        "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
        "KcwggSjAgEAAoIBAQC7VJTUt9Us8cKj",
        "-----END TEST KEY-----",
      ];
      mockBulkResolve({ "op://Private/ssh/key": lines.join("\n") });

      const script =
        "const s = process.env.KEY; process.stdout.write(s.replace(/\\n/g, '\\r\\n') + '\\n--\\n' + s.split('\\n').map((l) => '    ' + l).join('\\n'))";
      const result = await handler()({
        argv: [node, "-e", script],
        env: { KEY: "op://Private/ssh/key" },
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.exitCode).toBe(0);
      for (const line of lines) {
        expect(data.stdout).not.toContain(line);
      }
      expect(data.stdout).toBe(
        ["«REDACTED:KEY»", "--", ...lines.map(() => "    «REDACTED:KEY»")].join("\n"),
      );
    });

    it("masks encodings of the server's own service account token", async () => {
      const token = "ops_server_token_0123456789abcdef";
      process.env.OP_SERVICE_ACCOUNT_TOKEN = token;
      resetConfig();

      const result = await handler()({
        argv: [
          node,
          "-e",
          `process.stdout.write(Buffer.from('Bearer ${token}').toString('base64') + ' ' + encodeURIComponent('${token}'))`,
        ],
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.stdout).not.toContain(Buffer.from(`Bearer ${token}`).toString("base64").slice(8, -8));
      expect(data.stdout).toContain("«REDACTED:OP_SERVICE_ACCOUNT_TOKEN»");
    });
  });

  describe("output limits", () => {
    it("caps retained output while draining a child that writes far more than the limit", async () => {
      const script = [
        "const chunk = Buffer.alloc(64 * 1024, 'x');",
        "let remaining = 320;", // 20 MiB per stream
        "(function write() {",
        "  while (remaining > 0) {",
        "    remaining--;",
        "    process.stderr.write(chunk);",
        "    if (!process.stdout.write(chunk)) { process.stdout.once('drain', write); return; }",
        "  }",
        "})();",
      ].join("\n");

      const result = await handler()({ argv: [node, "-e", script] });
      const data = JSON.parse(result.content[0].text);

      // The child can only finish if the server keeps draining its pipes.
      expect(data.exitCode).toBe(0);
      expect(data.timedOut).toBe(false);
      expect(data.stdoutTruncated).toBe(true);
      expect(data.stderrTruncated).toBe(true);
      expect(Buffer.byteLength(data.stdout, "utf8")).toBeLessThanOrEqual(5 * MIB);
      expect(Buffer.byteLength(data.stderr, "utf8")).toBeLessThanOrEqual(5 * MIB);
      expect(data.stdout.length).toBeGreaterThan(5 * MIB - 1024);
    });

    it("never emits a secret prefix that the retained window cut off", async () => {
      delete process.env.OP_SERVICE_ACCOUNT_TOKEN; // keeps the pattern set, and so the window size, fixed
      resetConfig();
      const bulk = "L".repeat(300);
      const tail = "tail-secret-0123456789";
      mockBulkResolve({ "op://Private/bulk/key": bulk, "op://Private/tail/key": tail });
      const patterns = buildRedactionPatterns([
        { name: "BULK", value: bulk },
        { name: "TAIL", value: tail },
      ]);
      const windowBytes = 5 * MIB + maxPatternByteLength(patterns);
      const cutOff = 15; // characters of `tail` that still fit in the retained window

      // Masking the repeated bulk secret shrinks the output, pulling the cut-off
      // prefix of `tail` back under the 5 MiB cap unless it is removed explicitly.
      const script = [
        "const head = (process.env.BULK + '\\n').repeat(50);",
        `const filler = 'A'.repeat(${windowBytes} - ${cutOff} - head.length);`,
        "process.stdout.write(head + filler + process.env.TAIL + '-and-more');",
      ].join("\n");
      const result = await handler()({
        argv: [node, "-e", script],
        env: { BULK: "op://Private/bulk/key", TAIL: "op://Private/tail/key" },
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.exitCode).toBe(0);
      expect(data.stdoutTruncated).toBe(true);
      expect(data.stdout).toContain("«REDACTED:BULK»");
      expect(data.stdout).not.toContain("tail-");
      expect(data.stdout.endsWith("A")).toBe(true);
      expect(Buffer.byteLength(data.stdout, "utf8")).toBeLessThan(5 * MIB);
    });

    it("survives a child that exits without reading its stdin", async () => {
      const result = await handler()({
        argv: [node, "-e", "process.exit(0)"],
        stdin: "x".repeat(8 * MIB),
      });
      const data = JSON.parse(result.content[0].text);

      expect(result.isError).toBeUndefined();
      expect(data.exitCode).toBe(0);
    });
  });

  describe("timeouts", () => {
    // Time the child gets to start and print before its timeout fires; creating
    // a process can take seconds on a loaded Windows machine.
    const START_BUDGET_MS = 3000;
    // Longest a timed-out call may take beyond its timeout: SIGKILL grace,
    // time to abandon the pipes, and scheduling slack.
    const OVERRUN_MS = 2000 + 500 + 2500;

    async function runTimed(script: string) {
      const startedAt = Date.now();
      const result = await handler()({ argv: [node, "-e", script], timeout_ms: START_BUDGET_MS });
      const elapsed = Date.now() - startedAt;
      const data = JSON.parse(result.content[0].text);
      return { data, elapsed, pid: Number(String(data.stdout).trim().split("\n")[0]) };
    }

    function expectPid(pid: number): void {
      expect(
        Number.isInteger(pid) && pid > 1,
        "no pid printed: the child was killed before it started, raise START_BUDGET_MS",
      ).toBe(true);
    }

    it("kills the whole process tree on timeout and returns promptly", async () => {
      const { data, elapsed, pid } = await runTimed(
        [
          "const { spawn } = require('node:child_process');",
          "const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'inherit' });",
          "process.stdout.write(String(grandchild.pid) + '\\n');",
          "setTimeout(() => {}, 60000);",
        ].join("\n"),
      );

      try {
        expect(data.timedOut).toBe(true);
        expect(elapsed).toBeLessThan(START_BUDGET_MS + OVERRUN_MS);
        expectPid(pid);
        expect(await waitUntilDead(pid), "grandchild survived the timeout").toBe(true);
      } finally {
        killQuietly(pid);
      }
    });

    it("returns around the timeout when the child exits but a descendant keeps the pipes open", async () => {
      const { data, elapsed, pid } = await runTimed(
        [
          "const { spawn } = require('node:child_process');",
          "const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'inherit' });",
          "process.stdout.write(String(grandchild.pid) + '\\n', () => process.exit(0));",
        ].join("\n"),
      );

      try {
        expect(elapsed).toBeLessThan(START_BUDGET_MS + OVERRUN_MS);
        expectPid(pid);
        expect(await waitUntilDead(pid), "grandchild survived the timeout").toBe(true);
        // Windows ties a child's descendants to its lifetime, so there is nothing left to time out there.
        if (!isWindows) expect(data.timedOut).toBe(true);
      } finally {
        killQuietly(pid);
      }
    });

    it("stops waiting for pipes held by a descendant outside the process tree", async () => {
      // `detached` moves the grandchild into its own session / out of the job,
      // so neither the group kill nor taskkill can reach it.
      const { data, elapsed, pid } = await runTimed(
        [
          "const { spawn } = require('node:child_process');",
          "const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'inherit', detached: true });",
          "process.stdout.write(String(grandchild.pid) + '\\n', () => process.exit(0));",
        ].join("\n"),
      );

      try {
        expectPid(pid);
        expect(data.timedOut).toBe(true);
        expect(elapsed).toBeGreaterThanOrEqual(START_BUDGET_MS - 100);
        expect(elapsed).toBeLessThan(START_BUDGET_MS + OVERRUN_MS);
      } finally {
        killQuietly(pid);
      }
    });

    it("escalates to SIGKILL for a command that ignores SIGTERM", async () => {
      const { data, elapsed } = await runTimed(
        "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setTimeout(() => {}, 60000);",
      );

      expect(data.stdout, "the child was killed before it started, raise START_BUDGET_MS").toContain("ready");
      expect(data.timedOut).toBe(true);
      expect(elapsed).toBeLessThan(START_BUDGET_MS + OVERRUN_MS);
      if (!isWindows) {
        expect(data.signal).toBe("SIGKILL");
        expect(elapsed).toBeGreaterThanOrEqual(START_BUDGET_MS + 1900); // timeout + SIGTERM grace
      }
    });

    it.skipIf(isWindows)("returns around the timeout when a shell backgrounds a process that holds the pipes", async () => {
      const startedAt = Date.now();
      const result = await handler()({ command: "sleep 100000 &", timeout_ms: 1000 });
      const elapsed = Date.now() - startedAt;
      const data = JSON.parse(result.content[0].text);

      expect(data.timedOut).toBe(true);
      expect(elapsed).toBeLessThan(1000 + OVERRUN_MS);
    });

    it("does not report a timeout for a command that finishes in time", async () => {
      const result = await handler()({
        argv: [node, "-e", "process.stdout.write('done')"],
        timeout_ms: 30_000,
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.exitCode).toBe(0);
      expect(data.timedOut).toBe(false);
      expect(data.stdout).toBe("done");
    });
  });

  describe("child environment", () => {
    it("scrubs server credentials whatever the case of their names", async () => {
      process.env["Op_Service_Account_Token"] = "ops_mixed_case_token_12345";
      process.env["op_keychain_service"] = "mixed-case-service";
      process.env["OP_Keychain_Account"] = "mixed-case-account";
      resetConfig();

      const result = await handler()({
        argv: [
          node,
          "-e",
          "process.stdout.write(JSON.stringify(Object.keys(process.env).filter((key) => /^op_(service_account_token|keychain_service|keychain_account)$/i.test(key))))",
        ],
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.exitCode).toBe(0);
      expect(JSON.parse(data.stdout)).toEqual([]);
    });

    it("still applies caller-supplied values for those names", async () => {
      process.env["Op_Keychain_Service"] = "server-value";
      resetConfig();

      const result = await handler()({
        argv: [node, "-e", "process.stdout.write(String(process.env.OP_KEYCHAIN_SERVICE))"],
        env: { OP_KEYCHAIN_SERVICE: "caller-value" },
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.stdout).toBe("caller-value");
    });
  });

  describe("vault allow-list on the vault a reference resolves to", () => {
    const VAULTS = [
      { id: "vault-private", title: "Private" },
      { id: "vault-prod", title: "Prod" },
    ];
    const SECRET = "the-secret-value";
    let markerDir: string;
    let marker: string;

    beforeEach(() => {
      markerDir = mkdtempSync(join(tmpdir(), "op-run-allowlist-"));
      marker = join(markerDir, "child-ran");
    });

    afterEach(() => {
      rmSync(markerDir, { recursive: true, force: true });
    });

    function setAllowList(value: string): void {
      process.env.OP_MCP_ALLOWED_VAULTS = value;
      resetConfig();
    }

    /** Creates the marker file (proof it ran) and exits 0 only if it sees the secret. */
    function markerCommand(): string[] {
      return [
        node,
        "-e",
        `require('node:fs').writeFileSync(process.env.MARKER, 'ran'); process.exit(process.env.MY_SECRET === '${SECRET}' ? 0 : 3)`,
      ];
    }

    it("rejects a reference that resolves to a vault outside the allow-list, before running anything", async () => {
      setAllowList("Private");
      const resolveAll = mockBulkResolve(
        { "op://Private/api/key": SECRET },
        { vaultIds: { "op://Private/api/key": "vault-prod" }, vaults: VAULTS },
      );

      const result = await handler()({
        argv: markerCommand(),
        env: { MY_SECRET: "op://Private/api/key", MARKER: marker },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not in the allowed vault list");
      expect(result.content[0].text).toContain("vault-prod");
      expect(result.content[0].text).not.toContain(SECRET);
      // The written vault segment passed the textual pre-check, so it was the ID check that stopped it.
      expect(resolveAll).toHaveBeenCalledOnce();
      expect(resolveAll.vaultsList).toHaveBeenCalledOnce();
      expect(existsSync(marker)).toBe(false);
    });

    it("injects the value when the same reference resolves to an allow-listed vault", async () => {
      setAllowList("Private");
      const resolveAll = mockBulkResolve(
        { "op://Private/api/key": SECRET },
        { vaultIds: { "op://Private/api/key": "vault-private" }, vaults: VAULTS },
      );

      const result = await handler()({
        argv: markerCommand(),
        env: { MY_SECRET: "op://Private/api/key", MARKER: marker },
      });
      const data = JSON.parse(result.content[0].text);

      expect(result.isError).toBeUndefined();
      expect(data.exitCode).toBe(0); // 0 only if the child saw the secret
      expect(existsSync(marker)).toBe(true); // the same command that never ran above
      expect(resolveAll.vaultsList).toHaveBeenCalledOnce();
    });

    it("accepts an allow-list entry and a reference that are both written as the vault ID", async () => {
      setAllowList("vault-private");
      mockBulkResolve(
        { "op://vault-private/api/key": SECRET },
        { vaultIds: { "op://vault-private/api/key": "vault-private" }, vaults: VAULTS },
      );

      const result = await handler()({
        argv: markerCommand(),
        env: { MY_SECRET: "op://vault-private/api/key", MARKER: marker },
      });
      const data = JSON.parse(result.content[0].text);

      expect(result.isError).toBeUndefined();
      expect(data.exitCode).toBe(0);
      expect(existsSync(marker)).toBe(true);
    });

    it("rejects a reference written with an allowed vault ID that resolves elsewhere", async () => {
      setAllowList("vault-private");
      mockBulkResolve(
        { "op://vault-private/api/key": SECRET },
        { vaultIds: { "op://vault-private/api/key": "vault-prod" }, vaults: VAULTS },
      );

      const result = await handler()({
        argv: markerCommand(),
        env: { MY_SECRET: "op://vault-private/api/key", MARKER: marker },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not in the allowed vault list");
      expect(existsSync(marker)).toBe(false);
    });

    it("does not list vaults when no allow-list is configured", async () => {
      const resolveAll = mockBulkResolve(
        { "op://Private/api/key": SECRET },
        { vaultIds: { "op://Private/api/key": "vault-prod" }, vaults: VAULTS },
      );

      const result = await handler()({
        argv: markerCommand(),
        env: { MY_SECRET: "op://Private/api/key", MARKER: marker },
      });
      const data = JSON.parse(result.content[0].text);

      expect(result.isError).toBeUndefined();
      expect(data.exitCode).toBe(0);
      expect(existsSync(marker)).toBe(true);
      expect(resolveAll).toHaveBeenCalledOnce();
      expect(resolveAll.vaultsList).not.toHaveBeenCalled();
    });

    it("lists vaults once however many references are resolved", async () => {
      setAllowList("Private,Prod");
      const references = { FIRST: "op://Private/a/token", SECOND: "op://Prod/b/token" };
      const resolveAll = mockBulkResolve(
        { [references.FIRST]: "first-value", [references.SECOND]: "second-value" },
        {
          vaultIds: { [references.FIRST]: "vault-private", [references.SECOND]: "vault-prod" },
          vaults: VAULTS,
        },
      );

      const result = await handler()({
        argv: [node, "-e", "process.exit(process.env.FIRST === 'first-value' && process.env.SECOND === 'second-value' ? 0 : 1)"],
        env: references,
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.exitCode).toBe(0);
      expect(resolveAll).toHaveBeenCalledOnce();
      expect(resolveAll.vaultsList).toHaveBeenCalledOnce();
    });

    it("runs nothing if any one of several references resolves to a disallowed vault", async () => {
      setAllowList("Private,Prod");
      const references = { FIRST: "op://Private/a/token", SECOND: "op://Prod/b/token" };
      const resolveAll = mockBulkResolve(
        { [references.FIRST]: "first-value", [references.SECOND]: "second-value" },
        {
          vaultIds: { [references.FIRST]: "vault-private", [references.SECOND]: "vault-elsewhere" },
          vaults: VAULTS,
        },
      );

      const result = await handler()({
        argv: markerCommand(),
        env: { ...references, MARKER: marker },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("vault-elsewhere");
      expect(result.content[0].text).not.toContain("first-value");
      expect(resolveAll.vaultsList).toHaveBeenCalledOnce();
      expect(existsSync(marker)).toBe(false);
    });

    it("reports an unresolvable reference before checking any vault", async () => {
      setAllowList("Private");
      const resolveAll = vi.fn().mockResolvedValue({
        individualResponses: {
          "op://Private/a/token": { content: { secret: "first-value", vaultId: "vault-prod" } },
          "op://Private/b/token": { error: { type: "itemNotFound" } },
        },
      });
      const list = vi.fn().mockResolvedValue(VAULTS);
      mockedGetClient.mockResolvedValue({ secrets: { resolveAll }, vaults: { list } } as any);

      const result = await handler()({
        argv: markerCommand(),
        env: { FIRST: "op://Private/a/token", SECOND: "op://Private/b/token", MARKER: marker },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Could not resolve secret reference 'op://Private/b/token' (itemNotFound)",
      );
      expect(result.content[0].text).not.toContain("allowed vault list");
      expect(list).not.toHaveBeenCalled();
      expect(existsSync(marker)).toBe(false);
    });

    it("fails closed, with the error still redacted, when the vaults cannot be listed", async () => {
      const token = "ops_secret_master_token_12345";
      process.env.OP_SERVICE_ACCOUNT_TOKEN = token;
      setAllowList("Private");
      const resolveAll = mockBulkResolve(
        { "op://Private/api/key": SECRET },
        { vaultIds: { "op://Private/api/key": "vault-private" }, vaults: [] },
      );
      resolveAll.vaultsList.mockRejectedValue(new Error(`request failed for ${token}`));

      const result = await handler()({
        argv: markerCommand(),
        env: { MY_SECRET: "op://Private/api/key", MARKER: marker },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("request failed for «REDACTED:OP_SERVICE_ACCOUNT_TOKEN»");
      expect(result.content[0].text).not.toContain(token);
      expect(existsSync(marker)).toBe(false);
    });

    it("fails closed when the SDK client cannot list vaults at all", async () => {
      setAllowList("Private");
      mockBulkResolve({ "op://Private/api/key": SECRET }, { vaultIds: { "op://Private/api/key": "vault-private" } });

      const result = await handler()({
        argv: markerCommand(),
        env: { MY_SECRET: "op://Private/api/key", MARKER: marker },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("does not support listing vaults");
      expect(existsSync(marker)).toBe(false);
    });

    it("does not touch the SDK for a literal-only env, even with an allow-list", async () => {
      setAllowList("Private");

      const result = await handler()({
        argv: markerCommand(),
        env: { MY_SECRET: SECRET, MARKER: marker },
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.exitCode).toBe(0);
      expect(existsSync(marker)).toBe(true);
      expect(mockedGetClient).not.toHaveBeenCalled();
    });
  });
});
