// Creating a collection, shared by the management API and agent skill saves.

import {
  ContextCollectionContent, ContextCollectionMetadata, ContextCollectionVisibility, DEFAULT_GIT_BRANCH,
} from "./context-types.js";
import type { ContextCollectionDurableObject } from "./context-collection.js";

/** Metadata for a new, empty collection under a fresh ID. */
export function newCollectionMetadata(
  title: string,
  description: string,
  visibility: ContextCollectionVisibility,
  icon: string | undefined,
  source: ContextCollectionContent["source"],
): ContextCollectionMetadata {
  let now = new Date();
  return {
    id: crypto.randomUUID(),
    icon,
    title,
    description,
    visibility,
    created: now,
    lastUpdated: now,
    documentCount: 0,
    content: source === "git"
      ? { source, remote: "", branch: DEFAULT_GIT_BRANCH, lastRefreshedAt: now }
      : { source },
  };
}

/**
 * Initialize a collection, then make it reachable through `index`. Nothing is reachable until it is
 * indexed, so an indexing failure deletes the collection as `deleter`.
 */
export async function initializeCollection(
  collection: DurableObjectStub<ContextCollectionDurableObject>,
  metadata: ContextCollectionMetadata,
  domain: string,
  ownerAccountId: string,
  index: (metadata: ContextCollectionMetadata) => Promise<void> | void,
  deleter: { accountId: string; isAdmin: boolean },
): Promise<ContextCollectionMetadata> {
  let initialized = await collection.initialize(metadata, domain, ownerAccountId);
  try {
    await index(initialized);
  } catch (err) {
    await collection.deleteSelf(deleter.accountId, deleter.isAdmin).catch(() => {});
    throw err;
  }
  return initialized;
}
