/**
 * Lifecycle regression tests for the stdio entrypoint (`src/index.ts`).
 *
 * Guards against the orphan-spin bug: when the server loses its parent
 * (stdin closed) or hits a fatal error, it must exit promptly instead of
 * idling — or worse, spinning at 100% CPU — forever.
 *
 * These tests spawn the compiled entrypoint, so `npm run build` must run
 * before `npm test` (skipped otherwise).
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const entrypoint = join(rootDir, "dist", "index.js");

describe.skipIf(!existsSync(entrypoint))("stdio lifecycle", () => {
  it("exits 0 promptly when stdin is closed (orphaned server)", () => {
    const result = spawnSync(process.execPath, [entrypoint], {
      input: "",
      timeout: 10_000,
      encoding: "utf8",
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });

  it("logs once and exits non-zero on a fatal error instead of spinning", async () => {
    // NOTE: stdin is deliberately held open here. Without the fix, the
    // process logs the error and keeps running (spinning forever once
    // orphaned with broken stdio); the test would time out and fail.
    const trigger =
      "data:text/javascript,setTimeout(()=>{throw new Error('boom-test')},200);";
    const child = spawn(process.execPath, ["--import", trigger, entrypoint], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(null);
      }, 10_000);
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    expect(exitCode).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Uncaught exception");
  });
});
