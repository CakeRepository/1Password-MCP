/**
 * Server-wide vault allow-list enforcement.
 *
 * `OP_MCP_ALLOWED_VAULTS` / `--allowed-vaults` (vault names or IDs,
 * case-insensitive) restricts which vaults this server may read from or write
 * to. `assertVaultAllowed` in `secret-ref.ts` only checks the vault segment as
 * it is written in an `op://` reference, but most tools address vaults by ID
 * and a reference can name a vault differently from the allow-list entry. These
 * helpers therefore resolve the allow-list to the concrete IDs of the vaults
 * visible to the service account and check the vault ID a tool is about to use.
 *
 * A vault is allowed exactly when its own ID, title, or name matches an
 * allow-list entry (`vaultMatchesAllowList`). The ID checks and the listing
 * filter both use that one definition.
 *
 * An empty allow-list (the default) means no restriction: every helper returns
 * immediately and makes NO SDK calls. With a non-empty allow-list the ID checks
 * fail closed: if vaults cannot be listed, nothing is allowed.
 */

import { getConfig } from "./config.js";

/** A vault listing entry: the fields used for allow-list matching (SDK `VaultOverview`; older SDKs used `name`). */
export interface VaultLike {
  id: string;
  title?: string;
  name?: string;
}

/**
 * Minimal structural view of the SDK client: just enough to list vaults. The
 * client returned by `getClient()` satisfies it.
 */
export interface VaultAccessClient {
  vaults?: {
    list?: () => Promise<VaultLike[]>;
    /** Legacy SDK name for `list`. */
    listAll?: () => Promise<VaultLike[]>;
  };
}

/** Build the error thrown for a vault that is outside the allow-list. */
function vaultNotAllowedError(vaultId: string, allowedVaults: readonly string[]): Error {
  return new Error(
    `Vault '${vaultId}' is not in the allowed vault list (${allowedVaults.join(", ")}). ` +
      "Configure OP_MCP_ALLOWED_VAULTS or --allowed-vaults to permit it.",
  );
}

/**
 * True if the vault's own ID, title, or name case-insensitively equals an
 * allow-list entry. The single definition of "allowed vault", shared by the ID
 * checks (`resolveAllowedVaultIds`) and the listing filter (`filterAllowedVaults`).
 */
function vaultMatchesAllowList(
  vault: VaultLike,
  allowedVaults: readonly string[],
): boolean {
  const labels = [vault?.id, vault?.title, vault?.name]
    .filter((label): label is string => typeof label === "string")
    .map((label) => label.toLowerCase());
  return allowedVaults.some((entry) => labels.includes(entry.toLowerCase()));
}

/**
 * Resolve the allow-list to the lower-cased IDs of the vaults it permits, by
 * listing the vaults visible to the service account and matching each one.
 */
async function resolveAllowedVaultIds(
  client: VaultAccessClient,
  allowedVaults: readonly string[],
): Promise<Set<string>> {
  const listFn = client?.vaults?.list ?? client?.vaults?.listAll;
  if (!listFn) {
    throw new Error(
      "Your @1password/sdk version does not support listing vaults, which is required to enforce the vault allow-list.",
    );
  }

  const vaults = (await listFn.call(client.vaults)) ?? [];
  const allowedIds = new Set<string>();
  for (const vault of vaults) {
    if (
      typeof vault?.id === "string" &&
      vaultMatchesAllowList(vault, allowedVaults)
    ) {
      allowedIds.add(vault.id.toLowerCase());
    }
  }
  return allowedIds;
}

/**
 * Throw if `vaultId` is not the ID of an allow-listed vault. IDs are compared
 * case-insensitively. A no-op (no SDK calls) when no allow-list is configured.
 */
export async function assertVaultIdAllowed(
  client: VaultAccessClient,
  vaultId: string,
): Promise<void> {
  await assertVaultIdsAllowed(client, [vaultId]);
}

/**
 * Throw if any of `vaultIds` is not the ID of an allow-listed vault, listing
 * vaults only once however many IDs are given. A no-op (no SDK calls) when no
 * allow-list is configured or `vaultIds` is empty.
 */
export async function assertVaultIdsAllowed(
  client: VaultAccessClient,
  vaultIds: readonly string[],
): Promise<void> {
  const { allowedVaults } = getConfig();
  if (allowedVaults.length === 0 || vaultIds.length === 0) return;

  const allowedIds = await resolveAllowedVaultIds(client, allowedVaults);
  for (const vaultId of vaultIds) {
    if (typeof vaultId !== "string" || !allowedIds.has(vaultId.toLowerCase())) {
      throw vaultNotAllowedError(String(vaultId), allowedVaults);
    }
  }
}

/**
 * Return only the vaults that the allow-list permits, preserving order. Makes
 * no SDK call: each vault is matched on its own `id`/`title`/`name`, so pass the
 * entries returned by `vaults.list()`. Returns `vaults` untouched when no
 * allow-list is configured.
 */
export function filterAllowedVaults<T extends VaultLike>(vaults: T[]): T[] {
  const { allowedVaults } = getConfig();
  if (allowedVaults.length === 0) return vaults;

  return vaults.filter((vault) => vaultMatchesAllowList(vault, allowedVaults));
}
