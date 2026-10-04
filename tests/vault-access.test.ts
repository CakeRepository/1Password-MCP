/**
 * Tests for src/vault-access.ts — server-wide vault allow-list enforcement by
 * vault ID, resolved through the vaults visible to the service account.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetConfig } from "../src/config.js";
import {
  assertVaultIdAllowed,
  assertVaultIdsAllowed,
  filterAllowedVaults,
} from "../src/vault-access.js";

const PROD = { id: "vlt-prod-0001", title: "Prod" };
const DEV = { id: "vlt-dev-0002", title: "Dev" };
const PRIVATE = { id: "vlt-private-0003", title: "Private" };

/** A client whose vaults.list resolves to `vaults`. */
function makeClient(vaults: unknown[] = [PROD, DEV, PRIVATE]) {
  const list = vi.fn().mockResolvedValue(vaults);
  return { client: { vaults: { list } }, list };
}

function setAllowList(value: string) {
  process.env.OP_MCP_ALLOWED_VAULTS = value;
  resetConfig();
}

describe("vault-access", () => {
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

  describe("with no allow-list configured (default)", () => {
    it("allows any vault ID without calling the SDK", async () => {
      const { client, list } = makeClient();

      await expect(assertVaultIdAllowed(client, "anything")).resolves.toBeUndefined();
      await expect(
        assertVaultIdsAllowed(client, ["a", "b", "c"]),
      ).resolves.toBeUndefined();
      expect(list).not.toHaveBeenCalled();
    });

    it("works with a client that cannot list vaults", async () => {
      await expect(assertVaultIdAllowed({}, "anything")).resolves.toBeUndefined();
      await expect(assertVaultIdsAllowed({}, ["anything"])).resolves.toBeUndefined();
    });

    it("treats a blank allow-list as no restriction", async () => {
      setAllowList("  , ,");
      const { client, list } = makeClient();
      const vaults = [PROD, DEV];

      await expect(assertVaultIdAllowed(client, "anything")).resolves.toBeUndefined();
      expect(list).not.toHaveBeenCalled();
      expect(filterAllowedVaults(vaults)).toBe(vaults);
    });

    it("returns the vaults from filterAllowedVaults untouched", () => {
      const vaults = [PROD, DEV, PRIVATE];

      expect(filterAllowedVaults(vaults)).toBe(vaults);
    });
  });

  describe("assertVaultIdAllowed", () => {
    it("allows a vault whose title is in the allow-list", async () => {
      setAllowList("Prod");
      const { client } = makeClient();

      await expect(assertVaultIdAllowed(client, PROD.id)).resolves.toBeUndefined();
    });

    it("allows a vault whose ID is in the allow-list", async () => {
      setAllowList(DEV.id);
      const { client } = makeClient();

      await expect(assertVaultIdAllowed(client, DEV.id)).resolves.toBeUndefined();
    });

    it("rejects vaults that are not allow-listed, in the existing error style", async () => {
      setAllowList("Prod");
      const { client } = makeClient();

      await expect(assertVaultIdAllowed(client, DEV.id)).rejects.toThrow(
        `Vault '${DEV.id}' is not in the allowed vault list (Prod). ` +
          "Configure OP_MCP_ALLOWED_VAULTS or --allowed-vaults to permit it.",
      );
    });

    it("lists every configured entry in the error", async () => {
      setAllowList("Prod, vlt-dev-0002");
      const { client } = makeClient();

      await expect(assertVaultIdAllowed(client, PRIVATE.id)).rejects.toThrow(
        /\(Prod, vlt-dev-0002\)/,
      );
    });

    it("compares allow-list entries, vault titles, and IDs case-insensitively", async () => {
      setAllowList("pROD, VLT-DEV-0002");
      const { client } = makeClient();

      await expect(assertVaultIdAllowed(client, PROD.id)).resolves.toBeUndefined();
      await expect(
        assertVaultIdAllowed(client, PROD.id.toUpperCase()),
      ).resolves.toBeUndefined();
      await expect(assertVaultIdAllowed(client, DEV.id)).resolves.toBeUndefined();
      await expect(assertVaultIdAllowed(client, PRIVATE.id)).rejects.toThrow(
        /not in the allowed vault list/,
      );
    });

    it("matches the legacy `name` property when a vault has no title", async () => {
      setAllowList("Legacy");
      const { client } = makeClient([{ id: "vlt-legacy-0009", name: "Legacy" }]);

      await expect(assertVaultIdAllowed(client, "vlt-legacy-0009")).resolves.toBeUndefined();
    });

    it("does not treat a vault title as a vault ID", async () => {
      setAllowList("Prod");
      const { client } = makeClient();

      // Items APIs take vault IDs; the title of an allowed vault is not an allowed ID.
      await expect(assertVaultIdAllowed(client, "Prod")).rejects.toThrow(
        /not in the allowed vault list/,
      );
    });

    it("rejects every vault when no visible vault matches the allow-list", async () => {
      setAllowList("Nonexistent");
      const { client } = makeClient();

      await expect(assertVaultIdAllowed(client, PROD.id)).rejects.toThrow(
        /not in the allowed vault list/,
      );
    });

    it("rejects an empty or non-string vault ID when restricted", async () => {
      setAllowList("Prod");
      const { client } = makeClient();

      await expect(assertVaultIdAllowed(client, "")).rejects.toThrow(
        /not in the allowed vault list/,
      );
      await expect(
        assertVaultIdAllowed(client, undefined as unknown as string),
      ).rejects.toThrow(/not in the allowed vault list/);
    });

    it("lists vaults once per check", async () => {
      setAllowList("Prod");
      const { client, list } = makeClient();

      await assertVaultIdAllowed(client, PROD.id);

      expect(list).toHaveBeenCalledTimes(1);
    });

    it("fails closed when the SDK cannot list vaults", async () => {
      setAllowList("Prod");

      await expect(assertVaultIdAllowed({}, PROD.id)).rejects.toThrow(
        /does not support listing vaults/,
      );
      await expect(assertVaultIdAllowed({ vaults: {} }, PROD.id)).rejects.toThrow(
        /does not support listing vaults/,
      );
    });

    it("fails closed when listing vaults fails", async () => {
      setAllowList("Prod");
      const client = { vaults: { list: vi.fn().mockRejectedValue(new Error("network down")) } };

      await expect(assertVaultIdAllowed(client, PROD.id)).rejects.toThrow("network down");
    });

    it("falls back to listAll on older SDKs", async () => {
      setAllowList("Prod");
      const listAll = vi.fn().mockResolvedValue([PROD, DEV]);

      await expect(
        assertVaultIdAllowed({ vaults: { listAll } }, PROD.id),
      ).resolves.toBeUndefined();
      await expect(
        assertVaultIdAllowed({ vaults: { listAll } }, DEV.id),
      ).rejects.toThrow(/not in the allowed vault list/);
    });
  });

  describe("assertVaultIdsAllowed", () => {
    it("allows several vaults with a single vaults.list call", async () => {
      setAllowList("Prod, Dev");
      const { client, list } = makeClient();

      await expect(
        assertVaultIdsAllowed(client, [PROD.id, DEV.id, PROD.id]),
      ).resolves.toBeUndefined();
      expect(list).toHaveBeenCalledTimes(1);
    });

    it("rejects when any one of the vaults is not allowed", async () => {
      setAllowList("Prod, Dev");
      const { client, list } = makeClient();

      await expect(
        assertVaultIdsAllowed(client, [PROD.id, PRIVATE.id, DEV.id]),
      ).rejects.toThrow(`Vault '${PRIVATE.id}' is not in the allowed vault list`);
      expect(list).toHaveBeenCalledTimes(1);
    });

    it("makes no SDK call for an empty list of vault IDs", async () => {
      setAllowList("Prod");
      const { client, list } = makeClient();

      await expect(assertVaultIdsAllowed(client, [])).resolves.toBeUndefined();
      expect(list).not.toHaveBeenCalled();
    });

    it("accepts the vault IDs of resolveAll-style responses", async () => {
      setAllowList("Prod");
      const { client } = makeClient();
      const individualResponses = {
        "op://Prod/a/b": { content: { secret: "x", itemId: "i1", vaultId: PROD.id } },
        "op://Prod/c/d": { content: { secret: "y", itemId: "i2", vaultId: DEV.id } },
      };
      const vaultIds = Object.values(individualResponses).map(
        (response) => response.content.vaultId,
      );

      await expect(assertVaultIdsAllowed(client, vaultIds)).rejects.toThrow(
        `Vault '${DEV.id}' is not in the allowed vault list`,
      );
    });
  });

  describe("filterAllowedVaults", () => {
    it("keeps only allow-listed vaults, preserving order and objects", () => {
      setAllowList("Private, vlt-prod-0001");
      const vaults = [DEV, PROD, PRIVATE];

      const filtered = filterAllowedVaults(vaults);

      expect(filtered).toEqual([PROD, PRIVATE]);
      expect(filtered[0]).toBe(PROD);
      expect(filtered[1]).toBe(PRIVATE);
      expect(vaults).toEqual([DEV, PROD, PRIVATE]);
    });

    it("matches each vault's own ID, title, and name case-insensitively", () => {
      setAllowList("pROD, VLT-DEV-0002, legacy");
      const legacy = { id: "vlt-legacy-0009", name: "Legacy" };

      expect(filterAllowedVaults([PROD, DEV, PRIVATE, legacy])).toEqual([PROD, DEV, legacy]);
    });

    it("returns an empty list when no vault is allow-listed", () => {
      setAllowList("Nonexistent");

      expect(filterAllowedVaults([PROD, DEV])).toEqual([]);
    });

    it("preserves extra properties of the input vaults", () => {
      setAllowList("Prod");
      const rich = { ...PROD, description: "production", type: "USER_CREATED" };

      expect(filterAllowedVaults([rich, DEV])).toEqual([rich]);
    });

    it("matches a vault that carries no title or name only by its ID", () => {
      setAllowList("Prod");
      expect(filterAllowedVaults([{ id: PROD.id }])).toEqual([]);

      setAllowList(PROD.id);
      expect(filterAllowedVaults([{ id: PROD.id }])).toEqual([{ id: PROD.id }]);
    });

    it("drops malformed entries instead of throwing when restricted", () => {
      setAllowList("Prod");
      const malformed = [null, undefined, {}, PROD] as unknown as typeof PROD[];

      expect(filterAllowedVaults(malformed)).toEqual([PROD]);
    });

    it("agrees with the ID checks on which vaults are allowed", async () => {
      const vaults = [PROD, DEV, PRIVATE, { id: "vlt-legacy-0009", name: "Legacy" }];
      const { client } = makeClient(vaults);

      for (const allowList of [
        "Prod",
        "vlt-dev-0002",
        "prod, LEGACY",
        "Private, Dev, nope",
        "nope",
      ]) {
        setAllowList(allowList);
        const assertedIds: string[] = [];
        for (const vault of vaults) {
          try {
            await assertVaultIdAllowed(client, vault.id);
            assertedIds.push(vault.id);
          } catch {
            // not allowed
          }
        }

        expect(filterAllowedVaults(vaults).map((vault) => vault.id), allowList).toEqual(
          assertedIds,
        );
      }
    });
  });
});
