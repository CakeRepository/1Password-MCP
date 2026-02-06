/**
 * Tests for src/utils.ts — result helpers and password generation.
 */

import { describe, it, expect } from "vitest";
import {
  jsonResult,
  errorResult,
  generatePassword,
  buildCharset,
  generateMemorablePassword,
  getAllWords,
} from "../src/utils.js";

// ─── jsonResult ─────────────────────────────────────────────────────

describe("jsonResult", () => {
  it("wraps data in MCP text content", () => {
    const result = jsonResult({ foo: "bar" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ foo: "bar" });
  });

  it("does not set isError", () => {
    const result = jsonResult("ok");
    expect(result.isError).toBeUndefined();
  });

  it("handles nested objects", () => {
    const data = { a: { b: [1, 2, 3] } };
    const result = jsonResult(data);
    expect(JSON.parse(result.content[0].text)).toEqual(data);
  });
});

// ─── errorResult ────────────────────────────────────────────────────

describe("errorResult", () => {
  it("wraps Error instances", () => {
    const result = errorResult(new Error("boom"));
    expect(result.content[0].text).toBe("Error: boom");
    expect(result.isError).toBe(true);
  });

  it("wraps string errors", () => {
    const result = errorResult("string error");
    expect(result.content[0].text).toBe("Error: string error");
    expect(result.isError).toBe(true);
  });

  it("wraps non-string/Error values", () => {
    const result = errorResult(42);
    expect(result.content[0].text).toBe("Error: 42");
    expect(result.isError).toBe(true);
  });
});

// ─── buildCharset ───────────────────────────────────────────────────

describe("buildCharset", () => {
  it("includes only lowercase by default (all false)", () => {
    const cs = buildCharset({
      includeUppercase: false,
      includeNumbers: false,
      includeSymbols: false,
    });
    expect(cs).toBe("abcdefghijklmnopqrstuvwxyz");
  });

  it("includes all character types when all true", () => {
    const cs = buildCharset({
      includeUppercase: true,
      includeNumbers: true,
      includeSymbols: true,
    });
    expect(cs).toContain("A");
    expect(cs).toContain("0");
    expect(cs).toContain("!");
    expect(cs.length).toBeGreaterThan(60);
  });

  it("can selectively include uppercase only", () => {
    const cs = buildCharset({
      includeUppercase: true,
      includeNumbers: false,
      includeSymbols: false,
    });
    expect(cs).toContain("A");
    expect(cs).not.toContain("0");
    expect(cs).not.toContain("!");
  });
});

// ─── generatePassword ───────────────────────────────────────────────

describe("generatePassword", () => {
  it("generates a password of the requested length", () => {
    const pw = generatePassword(32, "abc");
    expect(pw).toHaveLength(32);
  });

  it("only uses characters from the charset", () => {
    const charset = "xyz";
    const pw = generatePassword(100, charset);
    for (const ch of pw) {
      expect(charset).toContain(ch);
    }
  });

  it("produces different passwords on successive calls (statistical)", () => {
    const pw1 = generatePassword(20, "abcdefghijklmnopqrstuvwxyz");
    const pw2 = generatePassword(20, "abcdefghijklmnopqrstuvwxyz");
    // Extremely unlikely to be equal with 26^20 possibilities
    expect(pw1).not.toBe(pw2);
  });

  it("handles minimum length", () => {
    const pw = generatePassword(1, "a");
    expect(pw).toBe("a");
  });
});

// ─── generateMemorablePassword ──────────────────────────────────────

describe("generateMemorablePassword", () => {
  it("generates a password with the requested word count", () => {
    const pw = generateMemorablePassword({
      wordCount: 4,
      separator: "-",
      includeNumber: false,
      includeSymbol: false,
      capitalize: false,
    });
    expect(pw.split("-")).toHaveLength(4);
  });

  it("capitalizes words when requested", () => {
    const pw = generateMemorablePassword({
      wordCount: 3,
      separator: "-",
      includeNumber: false,
      includeSymbol: false,
      capitalize: true,
    });
    const words = pw.split("-");
    for (const word of words) {
      expect(word[0]).toBe(word[0].toUpperCase());
    }
  });

  it("appends a number when includeNumber is true", () => {
    const pw = generateMemorablePassword({
      wordCount: 2,
      separator: "-",
      includeNumber: true,
      includeSymbol: false,
      capitalize: false,
    });
    expect(pw).toMatch(/\d+$/);
  });

  it("appends a symbol when includeSymbol is true", () => {
    const pw = generateMemorablePassword({
      wordCount: 2,
      separator: "-",
      includeNumber: false,
      includeSymbol: true,
      capitalize: false,
    });
    expect(pw).toMatch(/[!@#$%^&*]$/);
  });

  it("uses custom separator", () => {
    const pw = generateMemorablePassword({
      wordCount: 3,
      separator: ".",
      includeNumber: false,
      includeSymbol: false,
      capitalize: false,
    });
    expect(pw.split(".")).toHaveLength(3);
  });
});

// ─── getAllWords ─────────────────────────────────────────────────────

describe("getAllWords", () => {
  it("returns a deduplicated list", () => {
    const words = getAllWords();
    const unique = new Set(words);
    expect(words.length).toBe(unique.size);
  });

  it("has at least 400 words", () => {
    const words = getAllWords();
    expect(words.length).toBeGreaterThanOrEqual(400);
  });

  it("contains only lowercase alpha strings", () => {
    const words = getAllWords();
    for (const word of words) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });
});
