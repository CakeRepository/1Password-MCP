/**
 * Tests for src/config.ts — server configuration and CLI argument parsing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig, resetConfig, SERVER_NAME, SERVER_VERSION } from "../src/config.js";

describe("config", () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfig();
    // Clean env vars that affect config
    delete process.env.MCP_LOG_LEVEL;
    delete process.env.MCP_DEBUG;
    delete process.env.OP_INTEGRATION_NAME;
    delete process.env.OP_INTEGRATION_VERSION;
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
  });

  afterEach(() => {
    process.argv = originalArgv;
    // Restore env
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    });
    resetConfig();
  });

  it("exports correct server constants", () => {
    expect(SERVER_NAME).toBe("1password-mcp");
    expect(SERVER_VERSION).toBe("2.0.0");
  });

  it("defaults to info log level", () => {
    process.argv = ["node", "index.js"];
    const config = getConfig();
    expect(config.logLevel).toBe("info");
    expect(config.logLevelValue).toBe(2);
  });

  it("reads log level from --log-level arg", () => {
    process.argv = ["node", "index.js", "--log-level", "debug"];
    const config = getConfig();
    expect(config.logLevel).toBe("debug");
    expect(config.logLevelValue).toBe(3);
  });

  it("reads log level from MCP_LOG_LEVEL env", () => {
    process.argv = ["node", "index.js"];
    process.env.MCP_LOG_LEVEL = "warn";
    const config = getConfig();
    expect(config.logLevel).toBe("warn");
  });

  it("sets debug level when MCP_DEBUG is set", () => {
    process.argv = ["node", "index.js"];
    process.env.MCP_DEBUG = "1";
    const config = getConfig();
    expect(config.logLevel).toBe("debug");
  });

  it("reports tokenSource as missing when no token provided", () => {
    process.argv = ["node", "index.js"];
    const config = getConfig();
    expect(config.tokenSource).toBe("missing");
    expect(config.serviceAccountToken).toBeUndefined();
  });

  it("reads token from --service-account-token arg", () => {
    process.argv = ["node", "index.js", "--service-account-token", "test-token"];
    const config = getConfig();
    expect(config.tokenSource).toBe("args");
    expect(config.serviceAccountToken).toBe("test-token");
  });

  it("reads token from env var", () => {
    process.argv = ["node", "index.js"];
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "env-token";
    const config = getConfig();
    expect(config.tokenSource).toBe("env");
    expect(config.serviceAccountToken).toBe("env-token");
  });

  it("prefers arg token over env token", () => {
    process.argv = ["node", "index.js", "--token", "arg-token"];
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "env-token";
    const config = getConfig();
    expect(config.tokenSource).toBe("args");
    expect(config.serviceAccountToken).toBe("arg-token");
  });

  it("uses default integration name/version", () => {
    process.argv = ["node", "index.js"];
    const config = getConfig();
    expect(config.integrationName).toBe(SERVER_NAME);
    expect(config.integrationVersion).toBe(SERVER_VERSION);
  });

  it("reads --flag=value style args", () => {
    process.argv = ["node", "index.js", "--log-level=error"];
    const config = getConfig();
    expect(config.logLevel).toBe("error");
  });

  it("caches config on repeated calls", () => {
    process.argv = ["node", "index.js"];
    const c1 = getConfig();
    const c2 = getConfig();
    expect(c1).toBe(c2);
  });
});
