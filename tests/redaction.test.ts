/**
 * Unit tests for the pure op_run redaction module: pattern derivation,
 * order-independent masking, and output finalization (cap + cut-off secrets).
 */

import { describe, it, expect } from "vitest";
import {
  OutputCapture,
  buildRedactionPatterns,
  finalizeOutput,
  maxPatternByteLength,
  redact,
  type RedactionPattern,
} from "../src/redaction.js";

const MIB = 1024 * 1024;

function valuesOf(value: string, name = "S"): string[] {
  return buildRedactionPatterns([{ name, value }]).map((pattern) => pattern.value);
}

/** Deterministic PRNG so the randomized tests are reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("buildRedactionPatterns", () => {
  it("includes the raw value and tags every pattern with the secret's name", () => {
    const patterns = buildRedactionPatterns([{ name: "TOKEN", value: "abc123xyz789" }]);

    expect(patterns[0]).toEqual({ name: "TOKEN", value: "abc123xyz789" });
    expect(patterns.every((pattern) => pattern.name === "TOKEN")).toBe(true);
  });

  it("ignores empty values and de-duplicates by value, keeping the first name", () => {
    const patterns = buildRedactionPatterns([
      { name: "EMPTY", value: "" },
      { name: "FIRST", value: "shared-secret-value" },
      { name: "SECOND", value: "shared-secret-value" },
    ]);

    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.every((pattern) => pattern.name === "FIRST")).toBe(true);
    const values = patterns.map((pattern) => pattern.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("adds no extra literal forms when JSON and URL encoding leave the value unchanged", () => {
    // Raw value plus its three base64 alignments, nothing else.
    expect(valuesOf("plainvalue1")).toHaveLength(4);
  });

  it("adds the JSON-escaped form", () => {
    const secret = 'pa"ss\\wo\nrd';
    expect(valuesOf(secret)).toContain(JSON.stringify(secret).slice(1, -1));
  });

  it("adds the URL-encoded form", () => {
    expect(valuesOf("p w/d+x=y")).toContain("p%20w%2Fd%2Bx%3Dy");
  });

  it("skips the URL-encoded form for lone surrogates instead of throwing", () => {
    const secret = "ab\ud800cdefgh";
    expect(() => buildRedactionPatterns([{ name: "S", value: secret }])).not.toThrow();
    const values = valuesOf(secret);
    expect(values).toContain(secret);
    expect(values.some((value) => value.includes("%"))).toBe(false);
  });

  describe("base64 fragments", () => {
    const secrets = [
      "password",
      "Zx9-real-secret-value",
      "pässwörd-€-🔑-xyz",
      "supersecretkey999",
      "????>>>>>>~~~~~~",
    ];

    it("appear in the encoding of any payload embedding the secret at any offset", () => {
      for (const secret of secrets) {
        const fragments = valuesOf(secret);
        for (let prefixLength = 0; prefixLength <= 5; prefixLength++) {
          const payload = Buffer.from("x".repeat(prefixLength) + secret + "tail").toString("base64");
          expect(
            fragments.some((fragment) => payload.includes(fragment)),
            `prefix length ${prefixLength}, secret ${secret}`,
          ).toBe(true);
        }
      }
    });

    it("are independent of the bytes surrounding the secret", () => {
      const random = makeRandom(1234);
      const randomBytes = (length: number) =>
        Buffer.from(Array.from({ length }, () => Math.floor(random() * 256)));

      for (const secret of secrets) {
        const fragments = valuesOf(secret);
        for (let prefixLength = 0; prefixLength <= 8; prefixLength++) {
          for (let suffixLength = 0; suffixLength <= 4; suffixLength++) {
            const payload = Buffer.concat([
              randomBytes(prefixLength),
              Buffer.from(secret, "utf8"),
              randomBytes(suffixLength),
            ]).toString("base64");
            expect(
              fragments.some((fragment) => payload.includes(fragment)),
              `prefix ${prefixLength}, suffix ${suffixLength}, secret ${secret}`,
            ).toBe(true);
          }
        }
      }
    });

    it("are skipped when shorter than eight characters", () => {
      expect(valuesOf("abc")).toEqual(["abc"]);
    });

    it("are standard base64, not base64url", () => {
      const fragments = valuesOf("????>>>>>>~~~~~~").filter((value) => /^[A-Za-z0-9+/]+$/.test(value));
      expect(fragments.some((value) => /[+/]/.test(value))).toBe(true);
      expect(valuesOf("????>>>>>>~~~~~~").some((value) => /[-_]/.test(value))).toBe(false);
    });
  });

  describe("multi-line secrets", () => {
    const secret = [
      "-----BEGIN KEY-----",
      "AAAABBBBCCCCDDDD",
      "short",
      "  EEEEFFFFGGGG  \r",
      "-----END KEY-----",
    ].join("\n");

    it("adds the CRLF rendering", () => {
      expect(valuesOf(secret)).toContain(secret.replace(/\r?\n/g, "\r\n"));
    });

    it("adds each trimmed line of at least eight characters", () => {
      const values = valuesOf(secret);

      expect(values).toContain("-----BEGIN KEY-----");
      expect(values).toContain("AAAABBBBCCCCDDDD");
      expect(values).toContain("EEEEFFFFGGGG");
      expect(values).toContain("-----END KEY-----");
      expect(values).not.toContain("short");
    });

    it("adds neither for single-line secrets", () => {
      const values = valuesOf("single-line-secret-value");
      expect(values.some((value) => value.includes("\r\n"))).toBe(false);
    });

    it("keeps a secret with a trailing newline detectable without it", () => {
      expect(valuesOf("token-with-newline\n")).toContain("token-with-newline");
    });
  });
});

describe("redact", () => {
  const pattern = (name: string, value: string): RedactionPattern => ({ name, value });

  it("returns the text untouched when there are no patterns or no matches", () => {
    const text = "nothing to see here";
    expect(redact(text, [])).toBe(text);
    expect(redact(text, [pattern("S", "missing-value")])).toBe(text);
    expect(redact("", [pattern("S", "abc")])).toBe("");
  });

  it("ignores empty pattern values", () => {
    expect(redact("abc", [pattern("S", "")])).toBe("abc");
  });

  it("replaces a single match with the exact marker", () => {
    expect(redact("token=hunter22!", [pattern("MY_SECRET", "hunter22!")])).toBe(
      "token=«REDACTED:MY_SECRET»",
    );
  });

  it("replaces every occurrence and keeps the surrounding text", () => {
    expect(redact("x abc y abc z", [pattern("S", "abc")])).toBe(
      "x «REDACTED:S» y «REDACTED:S» z",
    );
  });

  it("treats secret values and names literally, not as regexes or replacement templates", () => {
    const secret = "a$&(b)*c.$1";
    expect(redact(`x${secret}y${secret}`, [pattern("N$&M", secret)])).toBe(
      "x«REDACTED:N$&M»y«REDACTED:N$&M»",
    );
  });

  it("masks secrets containing multi-byte characters", () => {
    expect(redact("a pw-🔑-secret b", [pattern("S", "pw-🔑-secret")])).toBe("a «REDACTED:S» b");
  });

  it("does not leak the remainder of a longer secret that contains a shorter one", () => {
    const user = pattern("API_USER", "svc-bot");
    const credentials = pattern("API_CREDENTIALS", "svc-bot:Zx9-real-secret");
    const text = "auth=svc-bot:Zx9-real-secret user=svc-bot";

    for (const patterns of [[user, credentials], [credentials, user]]) {
      const redacted = redact(text, patterns);
      expect(redacted).not.toContain("Zx9-real-secret");
      expect(redacted).not.toContain("svc-bot");
      expect(redacted).toMatch(/^auth=«REDACTED:API_[A-Z_,]+» user=«REDACTED:API_USER»$/);
    }
    expect(redact(text, [user, credentials])).toBe(
      "auth=«REDACTED:API_USER,API_CREDENTIALS» user=«REDACTED:API_USER»",
    );
  });

  it("merges partially overlapping matches into one marker naming both", () => {
    expect(redact("xabcdefx", [pattern("A", "abcd"), pattern("B", "cdef")])).toBe(
      "x«REDACTED:A,B»x",
    );
  });

  it("merges adjacent matches into one marker", () => {
    expect(redact("abcd", [pattern("A", "ab"), pattern("B", "cd")])).toBe("«REDACTED:A,B»");
    expect(redact("tokentoken", [pattern("T", "token")])).toBe("«REDACTED:T»");
  });

  it("merges a nested match into the enclosing one, listing names by first appearance", () => {
    const outer = pattern("OUTER", "xx-secret-yy");
    const inner = pattern("INNER", "secret");

    expect(redact("a xx-secret-yy b", [inner, outer])).toBe("a «REDACTED:OUTER,INNER» b");
  });

  it("breaks ties between matches starting together by pattern order", () => {
    const text = "abcdef";
    expect(redact(text, [pattern("SHORT", "ab"), pattern("LONG", "abcdef")])).toBe(
      "«REDACTED:SHORT,LONG»",
    );
    expect(redact(text, [pattern("LONG", "abcdef"), pattern("SHORT", "ab")])).toBe(
      "«REDACTED:LONG,SHORT»",
    );
  });

  it("collapses overlapping occurrences of the same pattern", () => {
    expect(redact("aaaaaaa", [pattern("A", "aaaa")])).toBe("«REDACTED:A»");
    expect(redact("ababab", [pattern("A", "abab")])).toBe("«REDACTED:A»");
  });

  it("keeps separate markers for matches that neither overlap nor touch", () => {
    expect(redact("ab-ab", [pattern("A", "ab")])).toBe("«REDACTED:A»-«REDACTED:A»");
  });

  it("lists each name once when several patterns of the same secret merge", () => {
    expect(redact("abcd", [pattern("A", "abc"), pattern("A", "bcd")])).toBe("«REDACTED:A»");
  });

  it("names a merged run in order of first appearance, not pattern order", () => {
    expect(redact("xxzz", [pattern("B", "zz"), pattern("A", "xx")])).toBe("«REDACTED:A,B»");
  });

  it("matches a naive reference implementation on random inputs", () => {
    const naive = (text: string, patterns: RedactionPattern[]): string => {
      const matches: { start: number; end: number; order: number; name: string }[] = [];
      patterns.forEach(({ name, value }, order) => {
        for (let i = 0; i + value.length <= text.length; i++) {
          if (text.startsWith(value, i)) matches.push({ start: i, end: i + value.length, order, name });
        }
      });
      matches.sort((a, b) => a.start - b.start || a.order - b.order);

      let output = "";
      let copied = 0;
      let i = 0;
      while (i < matches.length) {
        const start = matches[i].start;
        let end = matches[i].end;
        const names: string[] = [];
        while (i < matches.length && matches[i].start <= end) {
          end = Math.max(end, matches[i].end);
          if (!names.includes(matches[i].name)) names.push(matches[i].name);
          i++;
        }
        output += text.slice(copied, start) + `«REDACTED:${names.join(",")}»`;
        copied = end;
      }
      return output + text.slice(copied);
    };

    const random = makeRandom(42);
    const pick = (alphabet: string) => alphabet[Math.floor(random() * alphabet.length)];
    for (let iteration = 0; iteration < 3000; iteration++) {
      const alphabet = random() < 0.5 ? "ab" : "abc";
      const text = Array.from({ length: 1 + Math.floor(random() * 40) }, () => pick(alphabet)).join("");
      const patterns = Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({
        name: pick("ABC"),
        value: Array.from({ length: 1 + Math.floor(random() * 5) }, () => pick(alphabet)).join(""),
      }));

      expect(redact(text, patterns), JSON.stringify({ text, patterns })).toBe(naive(text, patterns));
    }
  });

  describe("limit", () => {
    const patterns = [pattern("A", "abc-def")];

    it("cuts plain text at the limit", () => {
      expect(redact("hello world", [pattern("S", "zzz")], 5)).toBe("hello");
      expect(redact("hello abc-def world", patterns, 3)).toBe("hel");
    });

    it("emits a marker for a run that starts before the limit even if it ends after it", () => {
      expect(redact("xx abc-def yy", patterns, 6)).toBe("xx «REDACTED:A»");
    });

    it("drops runs that start at or after the limit", () => {
      expect(redact("xx abc-def yy", patterns, 3)).toBe("xx ");
    });
  });

  it("redacts a 5 MiB output quickly, even when every position matches", () => {
    const secret = "Zx9-real-secret-0-with-some-length";
    const noise = "lorem ipsum dolor sit amet ".repeat(Math.ceil((5 * MIB) / 27));
    const patterns = buildRedactionPatterns([{ name: "S", value: secret }]);

    const started = Date.now();
    expect(redact(noise, patterns)).toBe(noise);
    expect(redact(("a".repeat(MIB * 5)), [pattern("A", "aaaaaaaa")])).toBe("«REDACTED:A»");
    expect(redact(`${secret}\n`.repeat(100_000), patterns)).toBe("«REDACTED:S»\n".repeat(100_000));
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe("maxPatternByteLength", () => {
  it("is zero without patterns", () => {
    expect(maxPatternByteLength([])).toBe(0);
  });

  it("measures UTF-8 bytes, not characters", () => {
    expect(
      maxPatternByteLength([
        { name: "A", value: "abc" },
        { name: "B", value: "é€🔑" },
      ]),
    ).toBe(9);
  });
});

describe("finalizeOutput", () => {
  const MARKER_BYTES = (name: string) => Buffer.byteLength(`«REDACTED:${name}»`);

  it("changes nothing when there are no patterns and the output is within the cap", () => {
    expect(finalizeOutput(Buffer.from("hello"), false, [], 100)).toEqual({
      text: "hello",
      truncated: false,
    });
    expect(finalizeOutput(Buffer.alloc(0), false, [], 100)).toEqual({ text: "", truncated: false });
  });

  it("does not strip anything from output that did not overflow", () => {
    const patterns = buildRedactionPatterns([{ name: "S", value: "supersecretkey999" }]);
    expect(finalizeOutput(Buffer.from("A super"), false, patterns, 100)).toEqual({
      text: "A super",
      truncated: false,
    });
  });

  it("still caps and flags output when there are no patterns", () => {
    expect(finalizeOutput(Buffer.from("x".repeat(10)), false, [], 4)).toEqual({
      text: "xxxx",
      truncated: true,
    });
    expect(finalizeOutput(Buffer.from("x".repeat(4)), false, [], 4)).toEqual({
      text: "xxxx",
      truncated: false,
    });
  });

  it("flags overflowed output as truncated even when it fits the cap", () => {
    expect(finalizeOutput(Buffer.from("short"), true, [], 100)).toEqual({
      text: "short",
      truncated: true,
    });
  });

  it("masks secrets", () => {
    const patterns = buildRedactionPatterns([{ name: "S", value: "abc123xyz789" }]);
    expect(finalizeOutput(Buffer.from("t=abc123xyz789"), false, patterns, 100)).toEqual({
      text: "t=«REDACTED:S»",
      truncated: false,
    });
  });

  it("flags truncation when markers make the masked text larger than the cap", () => {
    const patterns = buildRedactionPatterns([{ name: "PIN", value: "pin1" }]);
    const raw = Buffer.from("pin1 pin1 pin1 pin1");
    expect(raw.length).toBeLessThan(MARKER_BYTES("PIN") * 4);

    const result = finalizeOutput(raw, false, patterns, 40);

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(40);
    expect(result.text).not.toContain("pin1");
  });

  it("masks a secret that straddles the cap before cutting", () => {
    const patterns = buildRedactionPatterns([{ name: "S", value: "supersecretkey999" }]);
    const raw = Buffer.from("A".repeat(30) + "supersecretkey999" + "trailing");

    const result = finalizeOutput(raw, false, patterns, 40);

    // 30 bytes of padding plus the first 10 bytes of the marker (« is two bytes).
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("A".repeat(30) + "«REDACTED");
    expect(result.text).not.toContain("supers");
  });

  describe("when the capture overflowed", () => {
    it("drops a secret prefix that markers pulled back inside the cap", () => {
      const bulk = "L".repeat(40);
      const tail = "supersecretkey999";
      const patterns = buildRedactionPatterns([
        { name: "BULK", value: bulk },
        { name: "TAIL", value: tail },
      ]);
      const cap = 120;
      const window = cap + maxPatternByteLength(patterns);
      const cutOff = 15; // characters of `tail` that fit in the retained window
      const head = ("A" + bulk).repeat(3);
      const filler = window - cutOff - head.length;
      expect(filler).toBeGreaterThan(0);
      const stream = Buffer.from(head + "B".repeat(filler) + tail + "-and-more");
      const captured = stream.subarray(0, window);

      // Plain masking leaves the cut-off prefix behind, comfortably inside the cap...
      const masked = redact(captured.toString("utf8"), patterns);
      expect(masked.endsWith(tail.slice(0, cutOff))).toBe(true);
      expect(Buffer.byteLength(masked)).toBeLessThan(cap);

      // ...so finalization must remove it.
      const result = finalizeOutput(captured, true, patterns, cap);
      expect(result.truncated).toBe(true);
      expect(result.text).toBe(("A«REDACTED:BULK»").repeat(3) + "B".repeat(filler));
      expect(result.text).not.toContain("s");
    });

    it("leaves no prefix of the secret at the end when the window cuts it", () => {
      const secret = "supersecretkey999";
      const patterns = buildRedactionPatterns([{ name: "S", value: secret }]);

      for (let kept = 1; kept < secret.length; kept++) {
        const captured = Buffer.from("A".repeat(10) + secret.slice(0, kept));
        const { text, truncated } = finalizeOutput(captured, true, patterns, 100);

        expect(truncated).toBe(true);
        expect(text).toBe("A".repeat(10));
      }
    });

    it("drops the longest cut-off prefix when several patterns could match", () => {
      const patterns = buildRedactionPatterns([
        { name: "ONE", value: "xyz-long-secret-one" },
        { name: "TWO", value: "yz-long-secret-two" },
      ]);
      // "xyz-lo" starts ONE and its tail "yz-lo" starts TWO; the longer one decides the cut.
      const captured = Buffer.from("q xyz-lo");

      expect(finalizeOutput(captured, true, patterns, 100).text).toBe("q ");
    });

    it("keeps a complete secret at the very end masked", () => {
      const patterns = buildRedactionPatterns([{ name: "S", value: "supersecretkey999" }]);
      const captured = Buffer.from("id=supersecretkey999");

      expect(finalizeOutput(captured, true, patterns, 100)).toEqual({
        text: "id=«REDACTED:S»",
        truncated: true,
      });
    });

    it("drops the cut-off prefix of one secret that overlaps a masked run of another", () => {
      const patterns = buildRedactionPatterns([
        { name: "A", value: "abc-def" },
        { name: "B", value: "def-ghijklmn" },
      ]);
      // "def-ghij" is the start of B; its first three characters are also the end of A.
      const captured = Buffer.from("xx abc-def-ghij");

      const { text } = finalizeOutput(captured, true, patterns, 100);

      expect(text).toBe("xx «REDACTED:A»");
      expect(text).not.toContain("ghij");
    });

    it("keeps a masked run that ends exactly where the cut-off secret begins", () => {
      const patterns = buildRedactionPatterns([
        { name: "A", value: "alpha-key-1" },
        { name: "B", value: "supersecretkey999" },
      ]);

      expect(finalizeOutput(Buffer.from("id=alpha-key-1supersec"), true, patterns, 100).text).toBe(
        "id=«REDACTED:A»",
      );
    });

    it("trims a multi-byte character cut in half so the secret before it is still recognised", () => {
      const patterns = buildRedactionPatterns([{ name: "S", value: "secret-é-more" }]);
      const full = Buffer.from("AAAA secret-é-more");
      const captured = full.subarray(0, full.indexOf(0xc3) + 1);
      expect(captured.toString("utf8").endsWith("secret-�")).toBe(true);

      const result = finalizeOutput(captured, true, patterns, 100);

      expect(result.text).toBe("AAAA ");
      expect(result.text).not.toContain("�");
    });

    it("keeps decoding a partial character leniently when nothing was dropped", () => {
      const cutEmoji = Buffer.from("ab🔑").subarray(0, 4);
      expect(finalizeOutput(cutEmoji, false, [], 100).text).toContain("�");
      expect(finalizeOutput(cutEmoji, true, [], 100).text).toBe("ab");
    });
  });

  describe("character boundaries", () => {
    // a = 1 byte, é = 2, 🔑 = 4, z = 1
    const raw = Buffer.from("aé🔑z");

    it("never cuts through a multi-byte character", () => {
      const expected: Record<number, string> = {
        0: "",
        1: "a",
        2: "a",
        3: "aé",
        4: "aé",
        5: "aé",
        6: "aé",
        7: "aé🔑",
        8: "aé🔑z",
      };
      for (const [maxBytes, text] of Object.entries(expected)) {
        const result = finalizeOutput(raw, false, [], Number(maxBytes));
        expect(result.text, `maxBytes ${maxBytes}`).toBe(text);
        expect(result.text).not.toContain("�");
        expect(result.truncated).toBe(Number(maxBytes) < raw.length);
      }
    });

    it("never cuts through a multi-byte character inside a marker", () => {
      const patterns = buildRedactionPatterns([{ name: "S", value: "supersecretkey999" }]);
      // The marker starts with « (2 bytes); a one-byte budget after the text would split it.
      const result = finalizeOutput(Buffer.from("xyzsupersecretkey999"), false, patterns, 4);

      expect(result.text).toBe("xyz");
      expect(result.truncated).toBe(true);
    });
  });
});

describe("OutputCapture", () => {
  it("starts empty and not overflowed", () => {
    const capture = new OutputCapture(10);
    expect(capture.toBuffer()).toHaveLength(0);
    expect(capture.overflowed).toBe(false);
  });

  it("keeps everything up to the limit without flagging overflow", () => {
    const capture = new OutputCapture(10);
    capture.push(Buffer.from("hello"));
    capture.push(Buffer.from("world"));

    expect(capture.toBuffer().toString()).toBe("helloworld");
    expect(capture.overflowed).toBe(false);
  });

  it("cuts the chunk that crosses the limit and discards the rest", () => {
    const capture = new OutputCapture(8);
    capture.push(Buffer.from("hello"));
    capture.push(Buffer.from("world"));
    capture.push(Buffer.from("more"));

    expect(capture.toBuffer().toString()).toBe("hellowor");
    expect(capture.overflowed).toBe(true);
  });

  it("retains only the budget while a flood of data passes through", () => {
    const limit = 5 * MIB;
    const capture = new OutputCapture(limit);
    const chunk = Buffer.alloc(64 * 1024);
    let sent = 0;
    for (let i = 0; sent < 20 * MIB; i++) {
      chunk.fill(i % 251);
      capture.push(Buffer.from(chunk));
      sent += chunk.length;
    }

    const kept = capture.toBuffer();
    expect(kept).toHaveLength(limit);
    expect(capture.overflowed).toBe(true);
    // The retained bytes are the first ones written.
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(Math.floor((limit - 1) / chunk.length) % 251);
  });
});
