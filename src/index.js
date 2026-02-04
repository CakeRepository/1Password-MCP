import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createClient } from "@1password/sdk";
import * as sdk from "@1password/sdk";

const SERVER_NAME = "1password-mcp";
const SERVER_VERSION = "1.0.0";
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

function getArgValue(name) {
  const flag = `--${name}`;
  const prefix = `${flag}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === flag && process.argv[index + 1]) {
      return process.argv[index + 1];
    }
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return undefined;
}

const logLevelValue = (
  getArgValue("log-level") ??
  process.env.MCP_LOG_LEVEL ??
  (process.env.MCP_DEBUG ? "debug" : "info")
).toLowerCase();
const LOG_LEVEL = LOG_LEVELS[logLevelValue] ?? LOG_LEVELS.info;

function formatMeta(meta) {
  if (!meta) {
    return "";
  }
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch (error) {
    return " [meta unavailable]";
  }
}

function log(level, message, meta) {
  const levelValue = LOG_LEVELS[level];
  if (typeof levelValue !== "number" || levelValue > LOG_LEVEL) {
    return;
  }
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}${formatMeta(meta)}\n`;
  process.stderr.write(line);
}

function logError(context, error) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  log("error", context, stack ? { error: message, stack } : { error: message });
}

const integrationName =
  getArgValue("integration-name") ??
  process.env.OP_INTEGRATION_NAME ??
  SERVER_NAME;
const integrationVersion =
  getArgValue("integration-version") ??
  process.env.OP_INTEGRATION_VERSION ??
  SERVER_VERSION;

const tokenFromArgs =
  getArgValue("service-account-token") ?? getArgValue("token");

let clientPromise;

function requireServiceAccountToken() {
  const token = tokenFromArgs ?? process.env.OP_SERVICE_ACCOUNT_TOKEN;
  if (!token) {
    log("error", "Missing service account token.");
    throw new Error(
      "Service account token is required. Provide it via --service-account-token or OP_SERVICE_ACCOUNT_TOKEN."
    );
  }
  return token;
}

async function getClient() {
  if (!clientPromise) {
    log("debug", "Initializing 1Password client.");
    const token = requireServiceAccountToken();
    clientPromise = createClient({
      auth: token,
      integrationName,
      integrationVersion
    });
  }
  return clientPromise;
}

function jsonResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: "text",
        text: `Error: ${message}`
      }
    ]
  };
}

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION
});

const tokenSource = tokenFromArgs
  ? "args"
  : process.env.OP_SERVICE_ACCOUNT_TOKEN
  ? "env"
  : "missing";

log("info", "Starting MCP server.", {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  integrationName,
  integrationVersion,
  node: process.version,
  tokenSource
});

process.on("uncaughtException", (error) => {
  logError("Uncaught exception.", error);
});

process.on("unhandledRejection", (reason) => {
  logError("Unhandled rejection.", reason);
});

server.tool(
  "vault_list",
  {},
  async () => {
    try {
      log("debug", "Tool call: vault_list.");
      const client = await getClient();
      const listFn = client?.vaults?.list ?? client?.vaults?.listAll;
      if (!listFn) {
        throw new Error("Your @1password/sdk version does not support listing vaults.");
      }
      const vaults = await listFn.call(client.vaults);
      const summary = (vaults ?? []).map((vault) => ({
        id: vault.id,
        name: vault.name ?? vault.title,
        description: vault.description,
        type: vault.type
      }));
      return jsonResult({ vaults: summary });
    } catch (error) {
      logError("vault_list failed.", error);
      return errorResult(error);
    }
  }
);

server.tool(
  "item_lookup",
  {
    vaultId: z.string().min(1).describe("Vault ID to search within."),
    query: z.string().optional().describe("Optional substring to filter item titles."),
    limit: z.number().int().positive().max(200).optional().describe("Max items to return.")
  },
  async ({ vaultId, query, limit }) => {
    try {
      log("debug", "Tool call: item_lookup.", { vaultId, hasQuery: Boolean(query), limit });
      const client = await getClient();
      const listFn = client?.items?.list ?? client?.items?.listAll;
      if (!listFn) {
        throw new Error("Your @1password/sdk version does not support listing items.");
      }
      const items = await listFn.call(client.items, vaultId);
      const normalizedQuery = query?.toLowerCase();
      const filtered = normalizedQuery
        ? (items ?? []).filter((item) => item.title?.toLowerCase().includes(normalizedQuery))
        : items ?? [];
      const sliced = typeof limit === "number" ? filtered.slice(0, limit) : filtered;
      const summary = sliced.map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        vaultId: item.vaultId ?? vaultId
      }));
      return jsonResult({ items: summary, count: summary.length });
    } catch (error) {
      logError("item_lookup failed.", error);
      return errorResult(error);
    }
  }
);

server.tool(
  "password_create",
  {
    vaultId: z.string().min(1).describe("Vault ID to create the item in."),
    title: z.string().min(1).describe("Item title."),
    username: z.string().optional().describe("Username to store in the item."),
    password: z.string().min(1).describe("Password to store in the item."),
    category: z
      .enum(["Login", "Password"])
      .optional()
      .describe("Item category. Defaults to Login."),
    tags: z.array(z.string().min(1)).optional().describe("Optional tags."),
    notes: z.string().optional().describe("Optional notes."),
    url: z.string().url().optional().describe("Optional website URL to associate."),
    returnSecret: z
      .boolean()
      .optional()
      .describe("If true, include the created password in the response.")
  },
  async ({ vaultId, title, username, password, category, tags, notes, url, returnSecret }) => {
    try {
      log("debug", "Tool call: password_create.", { vaultId, title });
      const client = await getClient();
      if (!client?.items?.create) {
        throw new Error("Your @1password/sdk version does not support creating items.");
      }
      const fields = [];
      if (username) {
        fields.push({
          id: "username",
          title: "username",
          fieldType: sdk.ItemFieldType.Text,
          value: username
        });
      }
      fields.push({
        id: "password",
        title: "password",
        fieldType: sdk.ItemFieldType.Concealed,
        value: password
      });

      const categoryEnum = (category ?? "Login") === "Password"
        ? sdk.ItemCategory.Password
        : sdk.ItemCategory.Login;

      const item = await client.items.create({
        title,
        category: categoryEnum,
        vaultId,
        fields,
        tags,
        notes,
        websites: url ? [{ url }] : undefined
      });

      const response = {
        id: item.id,
        title: item.title,
        vaultId: item.vaultId ?? vaultId,
        category: item.category
      };

      if (returnSecret) {
        response.password = password;
      }

      return jsonResult(response);
    } catch (error) {
      logError("password_create failed.", error);
      return errorResult(error);
    }
  }
);

server.tool(
  "password_read",
  {
    secretReference: z
      .string()
      .optional()
      .describe("Secret reference (op://vault/item/field) to resolve."),
    vaultId: z.string().optional().describe("Vault ID for item lookup."),
    itemId: z.string().optional().describe("Item ID for item lookup."),
    field: z
      .string()
      .optional()
      .describe("Field id or title to read. Defaults to password."),
    reveal: z.boolean().optional().describe("If false, do not return the secret value.")
  },
  async ({ secretReference, vaultId, itemId, field, reveal }) => {
    try {
      log("debug", "Tool call: password_read.", {
        secretReference: Boolean(secretReference),
        vaultId,
        itemId,
        field,
        reveal
      });
      const client = await getClient();
      if (secretReference) {
        if (!client?.secrets?.resolve) {
          throw new Error("Your @1password/sdk version does not support resolving secrets.");
        }
        const value = await client.secrets.resolve(secretReference);
        if (reveal === false) {
          return jsonResult({ resolved: true });
        }
        return jsonResult({ value });
      }

      if (!vaultId || !itemId) {
        throw new Error("Provide secretReference or both vaultId and itemId.");
      }

      if (!client?.items?.get) {
        throw new Error("Your @1password/sdk version does not support getting items.");
      }
      const item = await client.items.get(vaultId, itemId);
      const desiredField = (field ?? "password").toLowerCase();
      const fields = item.fields ?? [];
      const match = fields.find((candidate) => {
        const idMatch = candidate.id?.toLowerCase() === desiredField;
        const titleMatch = candidate.title?.toLowerCase() === desiredField;
        const labelMatch = candidate.label?.toLowerCase() === desiredField;
        return idMatch || titleMatch || labelMatch;
      });

      if (!match) {
        throw new Error(`Field '${desiredField}' not found on item.`);
      }

      if (reveal === false) {
        return jsonResult({
          id: item.id,
          title: item.title,
          field: match.id ?? match.title,
          fieldType: match.fieldType ?? match.type
        });
      }

      const value = match.value;
      if (typeof value !== "string") {
        throw new Error("Field value is not a string and cannot be returned.");
      }
      return jsonResult({ value });
    } catch (error) {
      logError("password_read failed.", error);
      return errorResult(error);
    }
  }
);

server.tool(
  "password_update",
  {
    vaultId: z.string().min(1).describe("Vault ID containing the item."),
    itemId: z.string().min(1).describe("Item ID to update."),
    newPassword: z.string().min(1).describe("New password value."),
    field: z
      .string()
      .optional()
      .describe("Field id or title to update. Defaults to password."),
    returnSecret: z
      .boolean()
      .optional()
      .describe("If true, include the updated password in the response.")
  },
  async ({ vaultId, itemId, newPassword, field, returnSecret }) => {
    try {
      log("debug", "Tool call: password_update.", { vaultId, itemId, field });
      const client = await getClient();
      if (!client?.items?.get) {
        throw new Error("Your @1password/sdk version does not support getting items.");
      }
      if (!client?.items?.put) {
        throw new Error("Your @1password/sdk version does not support updating items.");
      }
      const item = await client.items.get(vaultId, itemId);
      const desiredField = (field ?? "password").toLowerCase();

      const fields = Array.isArray(item.fields) ? [...item.fields] : [];
      let updated = false;

      for (const candidate of fields) {
        const idMatch = candidate.id?.toLowerCase() === desiredField;
        const titleMatch = candidate.title?.toLowerCase() === desiredField;
        const labelMatch = candidate.label?.toLowerCase() === desiredField;
        if (idMatch || titleMatch || labelMatch) {
          candidate.value = newPassword;
          updated = true;
          break;
        }
      }

      if (!updated) {
        fields.push({
          id: desiredField,
          title: desiredField,
          fieldType: sdk.ItemFieldType.Concealed,
          value: newPassword
        });
      }

      item.fields = fields;
      const updatedItem = await client.items.put(item);

      const response = {
        id: updatedItem.id,
        title: updatedItem.title,
        vaultId: updatedItem.vaultId ?? vaultId
      };

      if (returnSecret) {
        response.password = newPassword;
      }

      return jsonResult(response);
    } catch (error) {
      logError("password_update failed.", error);
      return errorResult(error);
    }
  }
);

server.tool(
  "password_generate",
  {
    length: z.number().int().min(8).max(128).optional().describe("Length of the password. Defaults to 20."),
    includeSymbols: z.boolean().optional().describe("Include symbols. Defaults to true."),
    includeNumbers: z.boolean().optional().describe("Include numbers. Defaults to true."),
    includeUppercase: z.boolean().optional().describe("Include uppercase letters. Defaults to true.")
  },
  async ({ length = 20, includeSymbols = true, includeNumbers = true, includeUppercase = true }) => {
    try {
      log("debug", "Tool call: password_generate.", { length, includeSymbols, includeNumbers, includeUppercase });
      const crypto = await import("crypto");
      
      const lowercase = "abcdefghijklmnopqrstuvwxyz";
      const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const numbers = "0123456789";
      const symbols = "!@#$%^&*()-_=+[]{}|;:,.<>?";

      let charset = lowercase;
      if (includeUppercase) charset += uppercase;
      if (includeNumbers) charset += numbers;
      if (includeSymbols) charset += symbols;

      let password = "";
      const randomValues = new Uint32Array(length);
      // Use webcrypto if available (Node 15+), fallback to crypto.randomFillSync
      if (globalThis.crypto && globalThis.crypto.getRandomValues) {
        globalThis.crypto.getRandomValues(randomValues);
      } else {
        // Fallback for older environments or if global crypto isn't set
        const buffer = crypto.randomBytes(length * 4);
        for (let i = 0; i < length; i++) {
          randomValues[i] = buffer.readUInt32BE(i * 4);
        }
      }

      for (let i = 0; i < length; i++) {
        password += charset[randomValues[i] % charset.length];
      }

      return jsonResult({ password });
    } catch (error) {
      logError("password_generate failed.", error);
      return errorResult(error);
    }
  }
);

const WORD_LISTS = {
  nouns: ["apple", "bird", "cloud", "desk", "eagle", "flute", "grape", "hill", "iron", "joke", "kite", "leaf", "mountain", "night", "ocean", "piano", "quilt", "river", "stone", "tree", "wolf", "zebra", "anchor", "bridge", "castle"],
  verbs: ["bake", "cook", "draw", "eat", "find", "give", "help", "jump", "keep", "love", "make", "note", "open", "play", "quit", "read", "sing", "talk", "view", "walk", "dash", "glow", "hint", "iron", "join"],
  colors: ["amber", "blue", "cyan", "drab", "emerald", "forest", "gold", "hazel", "ivory", "jade", "khaki", "lime", "mauve", "navy", "olive", "pink", "quartz", "red", "silver", "teal", "violet", "white", "yellow", "azure", "bronze"],
  states: ["alaska", "arizona", "arkansas", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "maine", "nevada", "ohio", "oregon", "texas", "utah", "vermont", "virginia", "wyoming", "california", "colorado", "maryland", "michigan", "newyork"],
  countries: ["brazil", "canada", "denmark", "egypt", "france", "greece", "india", "japan", "kenya", "libya", "mexico", "norway", "oman", "peru", "qatar", "russia", "spain", "turkey", "uganda", "vietnam", "brazil", "chile", "italy", "jordan", "korea"]
};

server.tool(
  "password_generate_memorable",
  {
    wordCount: z.number().int().min(2).max(10).optional().describe("Number of words to include. Defaults to 3."),
    separator: z.string().max(5).optional().describe("Separator between words. Defaults to '-'."),
    includeNumber: z.boolean().optional().describe("Include a random number at the end. Defaults to true."),
    includeSymbol: z.boolean().optional().describe("Include a random symbol at the end. Defaults to true."),
    capitalize: z.boolean().optional().describe("Capitalize each word. Defaults to true.")
  },
  async ({ wordCount = 3, separator = "-", includeNumber = true, includeSymbol = true, capitalize = true }) => {
    try {
      log("debug", "Tool call: password_generate_memorable.", { wordCount, separator, includeNumber, includeSymbol, capitalize });
      const crypto = await import("crypto");
      
      const allWords = [...WORD_LISTS.nouns, ...WORD_LISTS.verbs, ...WORD_LISTS.colors, ...WORD_LISTS.states, ...WORD_LISTS.countries];
      const selectedWords = [];
      
      for (let i = 0; i < wordCount; i++) {
        const randomIndex = crypto.randomInt(0, allWords.length);
        let word = allWords[randomIndex];
        if (capitalize) {
          word = word.charAt(0).toUpperCase() + word.slice(1);
        }
        selectedWords.push(word);
      }

      let password = selectedWords.join(separator);

      if (includeNumber) {
        password += crypto.randomInt(0, 100).toString();
      }

      if (includeSymbol) {
        const symbols = "!@#$%^&*";
        password += symbols[crypto.randomInt(0, symbols.length)];
      }

      return jsonResult({ password });
    } catch (error) {
      logError("password_generate_memorable failed.", error);
      return errorResult(error);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  log("info", "Connecting MCP server transport.");
  await server.connect(transport);
  log("info", "MCP server connected. Awaiting requests.");
}

main().catch((error) => {
  logError(`Failed to start ${SERVER_NAME}.`, error);
  process.exit(1);
});
