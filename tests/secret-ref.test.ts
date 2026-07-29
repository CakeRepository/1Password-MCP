/**
 * Tests for src/secret-ref.ts — op:// reference parsing and vault allow-listing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetConfig } from "../src/config.js";
import {
  isSecretRef,
  parseSecretRef,
  assertVaultAllowed,
} from "../src/secret-ref.js";

describe("secret-ref", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfig();
    delete process.env.OP_MCP_ALLOWED_VAULTS;
  });

  afterEach(() => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) delete process.env[key];
      else process.env[key] = originalEnv[key];
    });
    resetConfig();
  });

  describe("isSecretRef", () => {
    it("recognizes a well-formed op:// reference", () => {
      expect(isSecretRef("op://Private/github/token")).toBe(true);
    });

    it("rejects plain literal strings", () => {
      expect(isSecretRef("plain-value")).toBe(false);
      expect(isSecretRef("https://example.com")).toBe(false);
    });
  });

  describe("parseSecretRef", () => {
    it("splits vault/item/field segments", () => {
      const ref = parseSecretRef("op://Private/github/token");
      expect(ref.vault).toBe("Private");
      expect(ref.item).toBe("github");
      expect(ref.field).toBe("token");
    });

    it("allows slashes within the field segment", () => {
      const ref = parseSecretRef("op://Private/github/section/nested-field");
      expect(ref.field).toBe("section/nested-field");
    });

    it("throws on a malformed reference", () => {
      expect(() => parseSecretRef("not-a-ref")).toThrow(/Invalid secret reference/);
      expect(() => parseSecretRef("op://only-vault")).toThrow(/Invalid secret reference/);
    });
  });

  describe("assertVaultAllowed", () => {
    it("allows any vault when no allow-list is configured (default)", () => {
      expect(() => assertVaultAllowed("Private")).not.toThrow();
      expect(() => assertVaultAllowed("anything-else")).not.toThrow();
    });

    it("restricts to the configured vaults when OP_MCP_ALLOWED_VAULTS is set", () => {
      process.env.OP_MCP_ALLOWED_VAULTS = "personal, work";
      resetConfig();
      expect(() => assertVaultAllowed("personal")).not.toThrow();
      expect(() => assertVaultAllowed("work")).not.toThrow();
      expect(() => assertVaultAllowed("WORK")).not.toThrow(); // case-insensitive
      expect(() => assertVaultAllowed("Private")).toThrow(/not in the allowed vault list/);
    });
  });
});
