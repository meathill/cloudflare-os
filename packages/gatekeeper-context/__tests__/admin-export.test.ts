import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ContextAccount } from "../src/library-gatekeeper.js";
import { ContextCollectionDurableObject } from "../src/context-collection.js";
import type { UserLibraryDurableObject } from "../src/user-library.js";
import type { LibraryRegistryDurableObject } from "../src/registry-do.js";
import { domainName } from "../src/domain.js";
import { publicCollectionsKvKey, metadataToSummary } from "../src/collection-kv.js";

// Storage persists across the file's tests, so each gets its own sharing domain.
let domain = "";
let domains = 0;
beforeEach(() => {
  domain = `workshop-${domains++}.example`;
});

type TestEnv = {
  COLLECTIONS: DurableObjectNamespace<ContextCollectionDurableObject>;
  USER_LIBRARIES: DurableObjectNamespace<UserLibraryDurableObject>;
  REGISTRIES: DurableObjectNamespace<LibraryRegistryDurableObject>;
};
const testEnv = env as unknown as TestEnv & Cloudflare.Env;

const collection = (id: string) =>
  testEnv.COLLECTIONS.get(testEnv.COLLECTIONS.idFromName(domainName(domain, id)));
const library = (accountId: string) =>
  testEnv.USER_LIBRARIES.get(testEnv.USER_LIBRARIES.idFromName(domainName(domain, accountId)));

let nextId = 0;

/** A web collection created by `owner` — "" for a public one — as creation leaves it. */
async function createCollection(owner: string, options: {
  visibility?: "private" | "public"; title?: string; description?: string;
} = {}): Promise<string> {
  let id = `collection-${nextId++}`;
  let now = new Date();
  await collection(id).initialize({
    id, title: options.title ?? "Runbooks", description: options.description ?? "",
    visibility: options.visibility ?? "private",
    created: now, lastUpdated: now, documentCount: 0, content: { source: "web" },
  }, domain, owner);
  if (owner) await library(owner).createOwnedCollection(id);
  return id;
}

/** The account's GatekeeperUser capability, as the kernel's admin export calls it. */
function account(accountId: string) {
  return new ContextAccount(Object.assign(createExecutionContext(), {
    props: { sharingDomain: domain, accountId },
  }), testEnv);
}

const SKILL_BODY =
  "---\nname: test-skill\ndescription: A test skill\n---\n\nDo the thing, then the next thing.\n";
const PNG_BODY = "AQIDBA==";

describe("ContextAccount.exportForAdmin", () => {
  it("exports the account's owned and shared private collections", async () => {
    // carol owns a collection holding a skill and a binary document, and is a viewer on one of
    // alice's collections.
    let owned = await createCollection("carol", { title: "我的技能", description: "mine" });
    await collection(owned).putContextDocument("test-skill/SKILL.md", {
      description: "A test skill", body: SKILL_BODY,
    });
    await collection(owned).putContextDocument("logo.png", {
      description: "Logo", body: PNG_BODY, contentType: "image/png",
    });
    let shared = await createCollection("alice", { title: "共享集合", description: "bob's" });
    await collection(shared).putContextDocument("note.md", { description: "", body: "note body" });
    await collection(shared).share("alice", [{ accountId: "carol", displayName: "Carol" }], "viewer");

    let files = await account("carol").exportForAdmin();
    let byPath = new Map(files.map(file => [file.path, file]));
    expect([...byPath.keys()].toSorted()).toEqual([
      `${owned}/_collection.json`,
      `${owned}/logo.png`,
      `${owned}/test-skill/SKILL.md`,
      `${shared}/_collection.json`,
      `${shared}/note.md`,
    ]);

    // Text bodies are literal, binary bodies stay base64 — the same shape ContextDocument uses.
    expect(byPath.get(`${owned}/test-skill/SKILL.md`))
        .toEqual({ path: `${owned}/test-skill/SKILL.md`, contentType: "text/markdown", body: SKILL_BODY });
    expect(byPath.get(`${owned}/logo.png`))
        .toEqual({ path: `${owned}/logo.png`, contentType: "image/png", body: PNG_BODY });
    expect(byPath.get(`${shared}/note.md`))
        .toEqual({ path: `${shared}/note.md`, contentType: "text/markdown", body: "note body" });

    // Each collection's record: its metadata and the account's role on it.
    let ownedMeta = JSON.parse(byPath.get(`${owned}/_collection.json`)!.body) as Record<string, unknown>;
    expect(byPath.get(`${owned}/_collection.json`)!.contentType).toBe("application/json");
    expect(ownedMeta).toMatchObject({
      id: owned, title: "我的技能", description: "mine", role: "owner",
    });
    expect(typeof ownedMeta.lastUpdated).toBe("string");
    let sharedMeta = JSON.parse(byPath.get(`${shared}/_collection.json`)!.body) as Record<string, unknown>;
    expect(sharedMeta).toMatchObject({ id: shared, title: "共享集合", role: "viewer" });
  });

  it("leaves public collections out", async () => {
    let pub = await createCollection("", { visibility: "public", title: "公共集合" });
    await collection(pub).putContextDocument("pub.md", { description: "", body: "public body" });
    // Listed the way listLibrary() lists public collections, so the account does see it — the
    // export must still keep it out.
    let meta = await collection(pub).getMetadata();
    await testEnv.CONTEXT_COLLECTIONS.put(
        publicCollectionsKvKey(domain), JSON.stringify([metadataToSummary(meta)]));
    let privateId = await createCollection("carol", { title: "私有集合" });
    await collection(privateId).putContextDocument("doc.md", { description: "", body: "private" });

    let files = await account("carol").exportForAdmin();
    let paths = files.map(file => file.path).toSorted();
    expect(paths).toEqual([
      `${privateId}/_collection.json`, `${privateId}/doc.md`,
    ].toSorted());
  });

  it("exports nothing for an account with no collections", async () => {
    expect(await account("nobody").exportForAdmin()).toEqual([]);
  });
});

describe("ContextAccount.deleteForAdmin", () => {
  it("deletes the account's own private collection, out of every library", async () => {
    let owned = await createCollection("carol", { title: "我的技能" });
    await collection(owned).putContextDocument("test-skill/SKILL.md", {
      description: "A test skill", body: SKILL_BODY,
    });
    await collection(owned).share("carol", [{ accountId: "dave", displayName: "Dave" }], "viewer");
    let kept = await createCollection("carol", { title: "留存的集合" });

    let deleted = await account("carol").deleteForAdmin([owned]);
    expect(deleted).toEqual([owned]);

    // The collection is gone for its members, and out of their libraries.
    expect(await collection(owned).getAccess("carol")).toMatchObject({ exists: false });
    expect(await collection(owned).getAccess("dave")).toMatchObject({ exists: false });
    let carolLibrary = await library("carol").listPrivateLibrary(domain, "carol");
    expect(carolLibrary.map(entry => entry.id)).toEqual([kept]);
    expect(await library("dave").listPrivateLibrary(domain, "dave")).toEqual([]);
    expect(await collection(kept).getAccess("carol"))
        .toMatchObject({ exists: true, role: "owner" });
  });

  it("skips what the account does not own — shared, public and missing ids", async () => {
    // carol is an editor of alice's collection: an editor never deletes.
    let shared = await createCollection("alice", { title: "共享集合" });
    await collection(shared).share("alice", [{ accountId: "carol", displayName: "Carol" }], "editor");
    let pub = await createCollection("", { visibility: "public", title: "公共集合" });

    let deleted = await account("carol").deleteForAdmin([shared, pub, "never-created"]);
    expect(deleted).toEqual([]);

    // Everything skipped is untouched: the grants, the collection, and carol's library entry.
    expect(await collection(shared).getAccess("alice"))
        .toMatchObject({ exists: true, role: "owner" });
    expect(await collection(shared).getAccess("carol"))
        .toMatchObject({ exists: true, role: "editor" });
    expect(await collection(pub).getAccess("carol")).toMatchObject({ exists: true });
    let carolLibrary = await library("carol").listPrivateLibrary(domain, "carol");
    expect(carolLibrary.map(entry => entry.id)).toEqual([shared]);
  });

  it("returns exactly the ids it deleted from a mixed list", async () => {
    let owned = await createCollection("carol");
    let shared = await createCollection("alice");
    await collection(shared).share("alice", [{ accountId: "carol", displayName: "Carol" }], "viewer");

    let deleted = await account("carol").deleteForAdmin(["never-created", shared, owned]);
    expect(deleted).toEqual([owned]);
    expect(await collection(owned).getAccess("carol")).toMatchObject({ exists: false });
    expect(await collection(shared).getAccess("carol"))
        .toMatchObject({ exists: true, role: "viewer" });
  });
});
