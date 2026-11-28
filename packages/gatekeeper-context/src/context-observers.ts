import {
  observerAccessVerifier, trackedCollectionObservers, type ObserverKv, type ObserverStrategy,
  type VerifyObserverAccess,
} from "@gadgets/gatekeeper-kit/observers";
import type { GatekeeperUserVerifier } from "@gadgets/workshop-shared/gatekeeper";
import { collectionPermissions } from "./collection-access.js";
import { MAX_COLLECTION_FANOUT, mapWithConcurrency } from "./concurrency.js";
import type { ContextCollectionDurableObject } from "./context-collection.js";
import { VENDOR_ID } from "./context-types.js";
import { obsContext } from "./observability.js";

const logger = obsContext.createLogger({
  component: "gatekeeper.context", vendorId: VENDOR_ID,
});

/**
 * The non-standard method Context gatekeepers call on their own verifier. The overseer only passes
 * a verifier back to the vendor that minted it, so the gatekeeper may trust this result.
 */
export interface ContextVerifierApi extends GatekeeperUserVerifier {
  /** One verdict per collection ID: whether this account can read that collection. */
  hasCollectionsAccess(sharingDomain: string, collectionIds: string[]): Promise<boolean[]>;
  /**
   * The account's ID, so a collection can be shared with the person a user-picker ticket names.
   * Null for any other sharing domain, which this account has no collections in.
   */
  getAccountId(sharingDomain: string): Promise<string | null>;
}

/**
 * Shown to a collaborator refused admission for a collection read before reads reported them as
 * subresources. It must not name the collection: the collaborator cannot read it, and a private
 * collection's title is its members' data.
 */
export const CONTEXT_OBSERVER_DENIED =
  "This workspace has read from a Skills collection that hasn't been shared with your account, so " +
  "you can't open it. Only collaborators who can read every collection the workspace has used may " +
  "open it.";

/**
 * 有缘心之助：由谁把协作者读不到的集合分享出去。`collection` 按集合 ID 在本 gatekeeper 的
 * sharingDomain 里取集合的 Durable Object；授权方是这个 gatekeeper 服务的工作区所有者的
 * Context 账号。
 */
export type ObserverAutoShare = {
  /** The account whose standing decides whether a collection may be shared. */
  grantorAccountId: string;
  /** Resolves a collection's Durable Object in this gatekeeper's sharing domain. */
  collection: (collectionId: string) => DurableObjectStub<ContextCollectionDurableObject>;
};

/**
 * 有缘心之助：自动分享写进集合成员名单的名字。verifier 不带协作者身份，统一用这个角色名；
 * 所有者在分享弹窗里看到几个同名成员时无法区分是谁。
 */
export const AUTO_SHARE_DISPLAY_NAME = "工作区协作者";

// The ACL oracle both checks share: collections are the data sets, so a subresource is a collection
// ID, spelled as the legacy tracker stored it. Public collections are domain-wide; private ones
// admit their grantees and, when enabled, everyone in the sharing domain.
function collectionAccess(sharingDomain: string, autoShare?: ObserverAutoShare) {
  return {
    hasCollectionAccess: async (
        verifier: Fetcher<ContextVerifierApi>, collectionIds: readonly string[]) => {
      let verdicts = await verifier.hasCollectionsAccess(sharingDomain, [...collectionIds]);
      if (!autoShare || verdicts.every(verdict => verdict === true)) return verdicts;
      return autoShareDeniedCollections(
        verifier, sharingDomain, collectionIds, verdicts, autoShare);
    },
  };
}

/**
 * 有缘心之助：对协作者读不到的集合用授权方的身份再看一眼。已删除或从未创建的集合直接放行
 * （这些 ID 来自本 gatekeeper 真实发生过的读取，不是外部伪造的）；授权方可以分享的私有集合
 * 由它分享给协作者的 Context 账号，分享成功的再用 verifier 复查。其余情况（授权方只是
 * viewer、其他 sharing domain 的账号等）保持拒绝，fail closed。
 */
async function autoShareDeniedCollections(
    verifier: Fetcher<ContextVerifierApi>, sharingDomain: string,
    collectionIds: readonly string[], verdicts: boolean[],
    autoShare: ObserverAutoShare): Promise<boolean[]> {
  let denied = collectionIds.flatMap(
    (id, index) => verdicts[index] === true ? [] : [{ id, index }]);
  let accesses = await mapWithConcurrency(denied, MAX_COLLECTION_FANOUT,
    ({ id }) => autoShare.collection(id).getAccess(autoShare.grantorAccountId));
  let toShare: typeof denied = [];
  denied.forEach((entry, i) => {
    let access = accesses[i]!;
    if (!access.exists) {
      verdicts[entry.index] = true;
    } else if (access.visibility === "private" && collectionPermissions(access, false).canShare) {
      toShare.push(entry);
    }
  });
  if (toShare.length === 0) return verdicts;

  // The verifier names the observer's Context account in this sharing domain; one from another
  // domain cannot be shared with here.
  let accountId = await verifier.getAccountId(sharingDomain);
  if (accountId === null) return verdicts;

  let shared = await mapWithConcurrency(toShare, MAX_COLLECTION_FANOUT, async ({ id }) => {
    try {
      await autoShare.collection(id).share(autoShare.grantorAccountId,
        [{ accountId, displayName: AUTO_SHARE_DISPLAY_NAME }], "viewer");
      logger.info("shared a collection with a workspace collaborator", {
        event: "context.observer.autoshare.granted", collectionId: id,
      });
      return true;
    } catch (error) {
      logger.warn("failed to share a collection with a workspace collaborator", {
        event: "context.observer.autoshare.failed", collectionId: id, error,
      });
      return false;
    }
  });

  // A share that did not throw is still no proof; re-check each shared id before admitting.
  let recheckIds = toShare.filter((_, i) => shared[i]).map(({ id }) => id);
  if (recheckIds.length === 0) return verdicts;
  let rechecked = await verifier.hasCollectionsAccess(sharingDomain, recheckIds);
  let position = 0;
  toShare.forEach(({ index }, i) => {
    if (shared[i]) verdicts[index] = rechecked[position++] === true;
  });
  return verdicts;
}

/**
 * Strategy C for the broad Context Library singleton, kept for what reads recorded before they
 * reported their collections as subresources: its `addObserver()` still refuses a collaborator who
 * cannot read one. Reads now record nothing here. The prefix keeps markers recorded before this
 * tracker moved to the kit. 有缘心之助：传 `autoShare` 时，准入前先尝试自动分享。
 */
export function contextObserverStrategy(
    kv: ObserverKv, sharingDomain: string, autoShare?: ObserverAutoShare): ObserverStrategy {
  return trackedCollectionObservers({
    kv,
    collectionPrefix: "observedCollection:",
    ...collectionAccess(sharingDomain, autoShare),
    denyMessage: () => CONTEXT_OBSERVER_DENIED,
    vendorId: VENDOR_ID,
  });
}

/**
 * `Gatekeeper.verifyObserverAccess()` for the collections reads report as subresources.
 * 有缘心之助：传 `autoShare` 时，校验前先尝试自动分享。
 */
export function contextObserverAccessVerifier(
    sharingDomain: string, autoShare?: ObserverAutoShare): VerifyObserverAccess {
  return observerAccessVerifier(collectionAccess(sharingDomain, autoShare));
}
