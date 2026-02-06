/**
 * 1Password SDK client singleton.
 */

import { createClient } from "@1password/sdk";
import { getConfig } from "./config.js";
import { log } from "./logger.js";

type OnePasswordClient = Awaited<ReturnType<typeof createClient>>;

let clientPromise: Promise<OnePasswordClient> | undefined;

/** Ensure a service account token is available; throw otherwise. */
export function requireServiceAccountToken(): string {
  const config = getConfig();
  if (!config.serviceAccountToken) {
    log("error", "Missing service account token.");
    throw new Error(
      "Service account token is required. Provide it via --service-account-token or OP_SERVICE_ACCOUNT_TOKEN.",
    );
  }
  return config.serviceAccountToken;
}

/** Get (or lazily create) the 1Password SDK client. */
export async function getClient(): Promise<OnePasswordClient> {
  if (!clientPromise) {
    log("debug", "Initializing 1Password client.");
    const token = requireServiceAccountToken();
    const config = getConfig();
    clientPromise = createClient({
      auth: token,
      integrationName: config.integrationName,
      integrationVersion: config.integrationVersion,
    });
  }
  return clientPromise;
}

/** Reset the client singleton (useful for testing). */
export function resetClient(): void {
  clientPromise = undefined;
}
