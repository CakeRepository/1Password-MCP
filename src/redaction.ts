/**
 * Output redaction for op_run: builds the strings that must not reach the
 * caller (each resolved secret plus the encodings tools commonly emit for it),
 * masks them in captured output, and enforces the per-stream size cap without
 * ever exposing a secret that the cap cut in half.
 *
 * Everything here is pure so it can be unit-tested without spawning processes.
 */

export interface RedactionTarget {
  /** Env var name shown in the redaction marker. */
  name: string;
  /** Plaintext secret value. */
  value: string;
}

/** A literal string to mask. Derived encodings of a secret carry that secret's name. */
export type RedactionPattern = RedactionTarget;

export interface FinalizedOutput {
  text: string;
  truncated: boolean;
}

/** Shortest base64 fragment or secret line distinctive enough to mask on its own. */
const MIN_PARTIAL_LENGTH = 8;

/**
 * Leading base64 characters that mix in the bytes before the secret, indexed by
 * the secret's offset within its 3-byte group.
 */
const BASE64_UNSTABLE_PREFIX = [0, 2, 3] as const;

/**
 * Base64 substrings that appear whenever `value` is embedded at any offset of a
 * larger base64-encoded payload (e.g. `Authorization: Basic ...`, k8s secrets).
 */
function base64Fragments(value: string): string[] {
  const secret = Buffer.from(value, "utf8");
  const fragments: string[] = [];
  for (let shift = 0; shift < 3; shift++) {
    const bytes = Buffer.concat([Buffer.alloc(shift), secret]);
    let encoded = bytes.toString("base64").replace(/=+$/, "");
    // A trailing partial group is completed by whichever byte follows the secret.
    if (bytes.length % 3 !== 0) encoded = encoded.slice(0, -1);
    // The leading characters mix in the unknown bytes before the secret.
    encoded = encoded.slice(BASE64_UNSTABLE_PREFIX[shift]);
    if (encoded.length >= MIN_PARTIAL_LENGTH) fragments.push(encoded);
  }
  return fragments;
}

/**
 * Forms of a multi-line secret that survive re-wrapping: the CRLF rendering and
 * each long-enough line on its own (mirrors per-line masking in CI systems).
 */
function* multilineVariants(value: string): Generator<string> {
  yield value.replace(/\r?\n/g, "\r\n");
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length >= MIN_PARTIAL_LENGTH) yield trimmed;
  }
}

/** Every literal form of one secret value that should be masked. */
function* secretVariants(value: string): Generator<string> {
  yield value;
  yield JSON.stringify(value).slice(1, -1);
  try {
    yield encodeURIComponent(value);
  } catch {
    // URIError for lone surrogates: such a value has no URL-encoded form.
  }
  yield* base64Fragments(value);
  if (value.includes("\n")) yield* multilineVariants(value);
}

/**
 * Expand secrets into the full, de-duplicated list of strings to mask. Empty
 * values are ignored and, when two secrets share a form, the first name wins.
 */
export function buildRedactionPatterns(
  targets: readonly RedactionTarget[],
): RedactionPattern[] {
  const patterns: RedactionPattern[] = [];
  const seen = new Set<string>();
  for (const { name, value } of targets) {
    if (value.length === 0) continue;
    for (const variant of secretVariants(value)) {
      if (variant.length === 0 || seen.has(variant)) continue;
      seen.add(variant);
      patterns.push({ name, value: variant });
    }
  }
  return patterns;
}

/** Longest pattern in UTF-8 bytes: how much extra output must be kept past the cap. */
export function maxPatternByteLength(patterns: readonly RedactionPattern[]): number {
  let max = 0;
  for (const { value } of patterns) {
    max = Math.max(max, Buffer.byteLength(value, "utf8"));
  }
  return max;
}

interface Cursor {
  /** Position in the pattern list; earlier patterns win ties so names follow declaration order. */
  order: number;
  name: string;
  value: string;
  /** Start of this pattern's next unconsumed occurrence in the text. */
  next: number;
}

/** Index of the cursor whose next occurrence starts first, or -1 when none remain. */
function earliest(cursors: readonly Cursor[]): number {
  let best = -1;
  for (let i = 0; i < cursors.length; i++) {
    if (
      best === -1 ||
      cursors[i].next < cursors[best].next ||
      (cursors[i].next === cursors[best].next && cursors[i].order < cursors[best].order)
    ) {
      best = i;
    }
  }
  return best;
}

/** Move a cursor to its next occurrence (overlaps included), dropping it when exhausted. */
function advance(cursors: Cursor[], index: number, text: string): void {
  const cursor = cursors[index];
  cursor.next = text.indexOf(cursor.value, cursor.next + 1);
  if (cursor.next === -1) {
    cursors[index] = cursors[cursors.length - 1];
    cursors.pop();
  }
}

/**
 * Mask every occurrence of every pattern. Occurrences are located in the
 * original text, so the result does not depend on pattern order, and
 * overlapping or touching occurrences collapse into one marker. A marker names
 * the unique patterns it covers in order of first appearance: `«REDACTED:A»`
 * or `«REDACTED:A,B»`.
 *
 * Nothing at or after `limit` is emitted, except that a masked run starting
 * before `limit` is always emitted whole (its marker is safe and the plaintext
 * it replaced must not be partially shown).
 */
export function redact(
  text: string,
  patterns: readonly RedactionPattern[],
  limit: number = text.length,
): string {
  const cursors: Cursor[] = [];
  patterns.forEach(({ name, value }, order) => {
    const next = value.length === 0 ? -1 : text.indexOf(value);
    if (next !== -1) cursors.push({ order, name, value, next });
  });
  if (cursors.length === 0) return limit >= text.length ? text : text.slice(0, limit);

  const parts: string[] = [];
  let copied = 0;
  while (cursors.length > 0) {
    let index = earliest(cursors);
    const start = cursors[index].next;
    if (start >= limit) break;

    // Absorb every occurrence that overlaps or touches the run so far.
    let end = start;
    const names: string[] = [];
    while (index !== -1 && cursors[index].next <= end) {
      const cursor = cursors[index];
      end = Math.max(end, cursor.next + cursor.value.length);
      if (!names.includes(cursor.name)) names.push(cursor.name);
      advance(cursors, index, text);
      index = earliest(cursors);
    }

    if (start > copied) parts.push(text.slice(copied, start));
    parts.push(`«REDACTED:${names.join(",")}»`);
    copied = end;
  }
  if (copied < limit) parts.push(text.slice(copied, limit));
  return parts.join("");
}

/** Drop a trailing UTF-8 sequence that was cut off mid-character. */
function trimIncompleteUtf8(buffer: Buffer): Buffer {
  const length = buffer.length;
  for (let back = 1; back <= Math.min(3, length); back++) {
    const byte = buffer[length - back];
    if ((byte & 0xc0) === 0x80) continue; // continuation byte: keep looking for its lead byte
    const needed = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return needed > back ? buffer.subarray(0, length - back) : buffer;
  }
  return buffer;
}

/** Length of the longest suffix of `text` that is a proper prefix of `pattern` (KMP). */
function partialMatchLength(text: string, pattern: string): number {
  const max = Math.min(pattern.length - 1, text.length);
  if (max < 1) return 0;

  const failure = new Int32Array(max);
  for (let i = 1, k = 0; i < max; i++) {
    while (k > 0 && pattern.charCodeAt(i) !== pattern.charCodeAt(k)) k = failure[k - 1];
    if (pattern.charCodeAt(i) === pattern.charCodeAt(k)) k++;
    failure[i] = k;
  }

  let matched = 0;
  for (let i = text.length - max; i < text.length; i++) {
    const code = text.charCodeAt(i);
    while (matched > 0 && code !== pattern.charCodeAt(matched)) matched = failure[matched - 1];
    if (code === pattern.charCodeAt(matched)) matched++;
  }
  return matched;
}

/** Longest tail of `text` that could be the start of a secret the output was cut inside. */
function partialSecretLength(text: string, patterns: readonly RedactionPattern[]): number {
  let longest = 0;
  for (const { value } of patterns) {
    longest = Math.max(longest, partialMatchLength(text, value));
  }
  return longest;
}

/**
 * Turn captured bytes into the text returned to the caller: decode, mask, and
 * cap at `maxBytes` on a character boundary. `overflowed` means the capture
 * dropped further output, so the buffer ends at an arbitrary point and may
 * end inside a secret. Both are handled:
 *
 * - an incomplete trailing UTF-8 sequence is trimmed before decoding, so a cut
 *   character cannot become U+FFFD and hide the start of a secret;
 * - the tail that forms a proper prefix of any pattern is dropped. This is
 *   decided on the decoded text and applied during masking, so it also removes
 *   such a tail when it overlaps a masked run. It matters even though the
 *   capture keeps extra bytes: markers are shorter than what they replace, which
 *   pulls the end of the window back inside the cap.
 */
export function finalizeOutput(
  captured: Buffer,
  overflowed: boolean,
  patterns: readonly RedactionPattern[],
  maxBytes: number,
): FinalizedOutput {
  const text = (overflowed ? trimIncompleteUtf8(captured) : captured).toString("utf8");
  const limit = overflowed ? text.length - partialSecretLength(text, patterns) : text.length;
  const redacted = redact(text, patterns, limit);

  if (Buffer.byteLength(redacted, "utf8") <= maxBytes) {
    return { text: redacted, truncated: overflowed };
  }
  const capped = trimIncompleteUtf8(Buffer.from(redacted, "utf8").subarray(0, maxBytes));
  return { text: capped.toString("utf8"), truncated: true };
}

/**
 * Collects a child's output up to a fixed byte budget. Bytes past the budget
 * are discarded (the caller keeps consuming so the child never blocks on a
 * full pipe) and recorded as `overflowed`.
 */
export class OutputCapture {
  overflowed = false;
  private readonly limit: number;
  private readonly chunks: Buffer[] = [];
  private size = 0;

  constructor(limit: number) {
    this.limit = limit;
  }

  push(chunk: Buffer): void {
    const room = this.limit - this.size;
    if (chunk.length > room) {
      this.overflowed = true;
      if (room <= 0) return;
      chunk = chunk.subarray(0, room);
    }
    this.chunks.push(chunk);
    this.size += chunk.length;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks, this.size);
  }
}
