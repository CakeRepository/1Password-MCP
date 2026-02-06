/**
 * Shared utility helpers for tool responses and password generation.
 */

import type { ToolResult } from "./types.js";
import { randomInt } from "node:crypto";

// ─── MCP Result Helpers ───────────────────────────────────────────────

/** Return a successful JSON result. */
export function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/** Return an error result with the `isError` flag set. */
export function errorResult(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

// ─── Password Generation (unbiased) ──────────────────────────────────

/**
 * Generate a random password using rejection sampling (no modulo bias).
 * Uses `crypto.randomInt` which returns a uniform integer in [0, max).
 */
export function generatePassword(
  length: number,
  charset: string,
): string {
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset[randomInt(charset.length)];
  }
  return password;
}

/** Build a character set from the requested options. */
export function buildCharset(options: {
  includeUppercase: boolean;
  includeNumbers: boolean;
  includeSymbols: boolean;
}): string {
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const numbers = "0123456789";
  const symbols = "!@#$%^&*()-_=+[]{}|;:,.<>?";

  let charset = lowercase;
  if (options.includeUppercase) charset += uppercase;
  if (options.includeNumbers) charset += numbers;
  if (options.includeSymbols) charset += symbols;
  return charset;
}

// ─── Memorable Password Word Lists (EFF-inspired, ~500 words) ────────

export const WORD_LISTS = {
  nouns: [
    "apple", "bird", "cloud", "desk", "eagle", "flute", "grape", "hill",
    "iron", "joke", "kite", "leaf", "mountain", "night", "ocean", "piano",
    "quilt", "river", "stone", "tree", "wolf", "zebra", "anchor", "bridge",
    "castle", "dragon", "ember", "falcon", "garden", "harbor", "island",
    "jungle", "lantern", "meadow", "nebula", "orchid", "phoenix", "quasar",
    "rocket", "sunset", "temple", "umbrella", "valley", "whisper", "atlas",
    "beacon", "comet", "dagger", "fossil", "glacier", "helmet", "ivory",
    "javelin", "keystone", "lotus", "marble", "nucleus", "obelisk", "prism",
    "riddle", "scepter", "timber", "vortex", "willow", "zenith", "breeze",
    "canyon", "pebble", "crystal", "mirror", "shadow", "spark", "torch",
    "blaze", "frost", "coral", "pearl", "raven", "cedar", "maple", "birch",
    "aspen", "olive", "basil", "sage", "mint", "clover", "fern", "moss",
    "reed", "thorn", "bloom", "petal", "acorn", "shell", "drift", "flare",
  ],
  verbs: [
    "bake", "cook", "draw", "eat", "find", "give", "help", "jump",
    "keep", "love", "make", "note", "open", "play", "quit", "read",
    "sing", "talk", "view", "walk", "dash", "glow", "hint", "join",
    "knit", "leap", "mend", "nest", "pick", "roam", "sail", "tick",
    "wade", "yawn", "zoom", "blend", "carve", "drift", "forge", "grind",
    "hover", "ignite", "kindle", "latch", "merge", "nudge", "orbit",
    "plunge", "quest", "rally", "scout", "trace", "unveil", "weave",
    "clasp", "delve", "fling", "grasp", "hoist", "sway", "twirl",
    "swoop", "cling", "creep", "prowl", "steer", "sweep", "whirl",
    "climb", "bloom", "chase", "dream", "float", "gleam", "march",
    "pause", "reach", "shine", "soar", "spark", "stand", "surge",
    "think", "trust", "build", "craft", "guard", "plant", "share",
  ],
  adjectives: [
    "amber", "blue", "cyan", "dark", "emerald", "forest", "gold", "hazel",
    "ivory", "jade", "keen", "lime", "mauve", "navy", "olive", "pink",
    "quartz", "red", "silver", "teal", "violet", "white", "yellow", "azure",
    "bronze", "bright", "calm", "deep", "eager", "fair", "grand", "hardy",
    "jolly", "kind", "lofty", "merry", "noble", "proud", "quiet", "rapid",
    "sharp", "swift", "tall", "vast", "warm", "bold", "brave", "clear",
    "crisp", "deft", "fresh", "glad", "hale", "just", "live", "neat",
    "pure", "rare", "safe", "true", "wild", "wise", "young", "zesty",
    "agile", "blunt", "dense", "firm", "giant", "harsh", "ideal", "lucid",
    "minor", "polar", "rigid", "sleek", "thick", "vivid", "wiry", "stark",
    "brief", "chief", "prime", "royal", "solar", "urban", "vital", "civic",
    "coral", "dusty", "early", "fiery", "gusty", "icy", "lunar", "misty",
  ],
  places: [
    "alaska", "arizona", "austin", "berlin", "boston", "cairo", "dallas",
    "denver", "dublin", "geneva", "havana", "houston", "jersey", "lagos",
    "lisbon", "london", "madrid", "miami", "milan", "munich", "naples",
    "oslo", "paris", "perth", "phoenix", "portland", "prague", "rome",
    "salem", "seattle", "sofia", "sydney", "tampa", "tokyo", "tulsa",
    "venice", "vienna", "zurich", "athens", "boise", "charlotte", "durham",
    "eugene", "fresno", "helena", "jackson", "kansas", "lincoln", "memphis",
    "norfolk", "oakland", "quincy", "raleigh", "sacramento", "tacoma",
    "utah", "vernon", "wichita", "albany", "canton", "dayton", "elmira",
    "fargo", "gary", "irvine", "jersey", "kenosha", "laredo", "macon",
  ],
  nature: [
    "aurora", "avalanche", "bamboo", "blizzard", "breeze", "brook",
    "cascade", "cavern", "clover", "coral", "crater", "current", "delta",
    "desert", "dune", "eclipse", "estuary", "fjord", "flora", "geyser",
    "gorge", "grove", "harbor", "horizon", "lagoon", "lava", "meadow",
    "monsoon", "nebula", "oasis", "peak", "plateau", "prairie", "quartz",
    "rapids", "reef", "ridge", "savanna", "summit", "tempest", "thunder",
    "tundra", "typhoon", "volcano", "wetland", "zephyr", "alpine", "arctic",
    "basin", "canyon", "cliff", "coast", "cove", "creek", "field",
    "forest", "frost", "marsh", "mist", "pond", "rain", "shore",
    "storm", "stream", "swamp", "tide", "trail", "wave", "woods",
  ],
} as const;

/** Get all words from every word list, deduplicated. */
export function getAllWords(): string[] {
  const combined = [
    ...WORD_LISTS.nouns,
    ...WORD_LISTS.verbs,
    ...WORD_LISTS.adjectives,
    ...WORD_LISTS.places,
    ...WORD_LISTS.nature,
  ];
  return [...new Set(combined)];
}

/**
 * Generate a memorable password from random words.
 */
export function generateMemorablePassword(options: {
  wordCount: number;
  separator: string;
  includeNumber: boolean;
  includeSymbol: boolean;
  capitalize: boolean;
}): string {
  const allWords = getAllWords();
  const selectedWords: string[] = [];

  for (let i = 0; i < options.wordCount; i++) {
    let word = allWords[randomInt(allWords.length)];
    if (options.capitalize) {
      word = word.charAt(0).toUpperCase() + word.slice(1);
    }
    selectedWords.push(word);
  }

  let password = selectedWords.join(options.separator);

  if (options.includeNumber) {
    password += randomInt(100).toString();
  }

  if (options.includeSymbol) {
    const symbols = "!@#$%^&*";
    password += symbols[randomInt(symbols.length)];
  }

  return password;
}
