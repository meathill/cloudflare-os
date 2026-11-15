import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ActionJournal, type ActionJournalKv } from "@gadgets/gatekeeper-kit/actions";
import { ObservationGate, privateObservers } from "@gadgets/gatekeeper-kit/observers";
import type { ActionDescription } from "@gadgets/workshop-shared/gatekeeper";
import type { ContextCollectionDurableObject } from "../src/context-collection.js";
import type { UserLibraryDurableObject } from "../src/user-library.js";
import { domainName } from "../src/domain.js";
import { LibraryReadSession } from "../src/library-read.js";
import { LibrarySession } from "../src/library-write.js";
import {
  canSaveSkills, DEFAULT_SKILL_COLLECTION, SKILL_ACTIONS, type SkillHost,
} from "../src/skill-actions.js";

type TestEnv = {
  COLLECTIONS: DurableObjectNamespace<ContextCollectionDurableObject>;
  USER_LIBRARIES: DurableObjectNamespace<UserLibraryDurableObject>;
};
const testEnv = env as unknown as TestEnv & Cloudflare.Env;

// Storage persists across the file's tests, so each gets its own sharing domain.
let domain = "";
let domains = 0;
beforeEach(() => {
  domain = `skills-${domains++}.example`;
});

const collection = (id: string) =>
  testEnv.COLLECTIONS.get(testEnv.COLLECTIONS.idFromName(domainName(domain, id)));
const library = (accountId: string) =>
  testEnv.USER_LIBRARIES.get(testEnv.USER_LIBRARIES.idFromName(domainName(domain, accountId)));

let nextId = 0;

async function createCollection(owner: string): Promise<string> {
  let id = `collection-${nextId++}`;
  let now = new Date();
  await collection(id).initialize({
    id, title: "Runbooks", description: "", visibility: "private",
    created: now, lastUpdated: now, documentCount: 0, content: { source: "web" },
  }, domain, owner);
  await library(owner).createOwnedCollection(id);
  return id;
}

function memoryKv(): ActionJournalKv {
  let map = new Map<string, unknown>();
  return {
    get: <T>(key: string) => map.get(key) as T | undefined,
    put: <T>(key: string, value: T) => void map.set(key, value),
    delete: (key: string) => map.delete(key),
    list: <T>({ prefix, startAfter, end, limit }: {
      prefix: string; startAfter?: string; end?: string; limit?: number;
    }) => [...map.entries()]
      .filter(([key]) => key.startsWith(prefix)
        && (startAfter === undefined || key > startAfter) && (end === undefined || key < end))
      .toSorted(([left], [right]) => left < right ? -1 : 1)
      .slice(0, limit) as [string, T][],
  };
}

/** The agent's session for `accountId`, with the approval queue recording what it is asked. */
function agentSession(accountId: string) {
  let host: SkillHost = {
    domain, accountId, collection, userLibrary: () => library(accountId),
  };
  let actions = SKILL_ACTIONS.bind(new ActionJournal(memoryKv(), { namespace: "skills" }), host);
  let submitted: { id: number; description: ActionDescription }[] = [];
  let queue = {
    async submitAction(id: number, description: ActionDescription) {
      submitted.push({ id, description });
    },
    [Symbol.dispose]() {},
  };
  let authorizer = {
    async authorizeObservation() {},
    [Symbol.dispose]() {},
  } as unknown as ConstructorParameters<typeof ObservationGate>[0];
  let reader = new LibraryReadSession(
    testEnv, testEnv.COLLECTIONS, testEnv.USER_LIBRARIES, domain, accountId,
    new ObservationGate(authorizer, privateObservers("No observers in this fixture.")));
  let session = new LibrarySession(reader, queue, actions, host);
  return { session, actions, submitted, last: () => submitted.at(-1)! };
}

const SKILL = {
  name: "baokuan-chaiju",
  description: "拆解爆款短剧并升级设定。用户要求拆剧换皮时使用。",
  body: "# 爆款拆剧换皮\n\n1. 骨架平移\n2. 情绪轴锁定\n",
};

async function skills(collectionId: string) {
  return (await collection(collectionId).listAgentSkills()).map(skill => skill.skillName);
}

async function defaultCollectionId(accountId: string): Promise<string> {
  return library(accountId).getDefaultSkillCollectionId();
}

describe("createSkill", () => {
  it("creates the default collection on the first approved save and reuses it", async () => {
    let { session, actions, last } = agentSession("owner");

    await session.createSkill(SKILL);
    expect(last().description).toMatchObject({
      title: "保存技能：baokuan-chaiju",
      autoApprovable: true,
      awaitDecision: true,
      descriptionIsComplete: true,
      actionKind: { tag: "context.saveSkill", label: "保存技能" },
    });
    // Nothing is stored before approval.
    expect(await defaultCollectionId("owner")).toBe("");

    await actions.apply(last().id);
    let defaultId = await defaultCollectionId("owner");
    expect(await skills(defaultId)).toEqual(["baokuan-chaiju"]);
    let entries = await library("owner").listLibrary(domain, "owner");
    expect(entries.map(entry => entry.title)).toEqual([DEFAULT_SKILL_COLLECTION.title]);
    let stored = await collection(defaultId).getContextDocument("baokuan-chaiju/SKILL.md");
    expect(stored?.body).toBe(
      "---\nname: baokuan-chaiju\ndescription: 拆解爆款短剧并升级设定。用户要求拆剧换皮时使用。\n---\n\n"
      + SKILL.body);

    await session.createSkill({ ...SKILL, name: "qingxu-zhou" });
    await actions.apply(last().id);
    expect(await defaultCollectionId("owner")).toBe(defaultId);
    expect((await skills(defaultId)).toSorted()).toEqual(["baokuan-chaiju", "qingxu-zhou"]);
  });

  it("concurrent first saves from two workspaces end up in one default collection", async () => {
    let first = agentSession("owner");
    let second = agentSession("owner");
    await first.session.createSkill(SKILL);
    await second.session.createSkill({ ...SKILL, name: "qingxu-zhou" });

    await Promise.all([first.actions.apply(first.last().id), second.actions.apply(second.last().id)]);
    let entries = await library("owner").listLibrary(domain, "owner");
    expect(entries).toHaveLength(1);
    expect((await skills(entries[0]!.id)).toSorted()).toEqual(["baokuan-chaiju", "qingxu-zhou"]);
  });

  it("applies a retried save once", async () => {
    let { session, actions, last } = agentSession("owner");
    let id = await createCollection("owner");
    await session.createSkill({ ...SKILL, collectionId: id });
    await actions.apply(last().id);
    await actions.apply(last().id);
    expect(await skills(id)).toEqual(["baokuan-chaiju"]);
  });

  it("needs a manual approval for a collection others can read", async () => {
    let { session, last } = agentSession("owner");
    let id = await createCollection("owner");
    await collection(id).share("owner", [{ accountId: "teammate", displayName: "Teammate" }], "viewer");

    await session.createSkill({ ...SKILL, collectionId: id });
    expect(last().description).toMatchObject({
      autoApprovable: false,
      actionKind: { tag: "context.saveSkill" },
    });
  });

  it("refuses collections the account cannot save to", async () => {
    let { session, submitted } = agentSession("viewer");
    let shared = await createCollection("owner");
    await collection(shared).share("owner", [{ accountId: "viewer", displayName: "Viewer" }], "viewer");

    for (let collectionId of [shared, "missing"]) {
      await expect(session.createSkill({ ...SKILL, collectionId })).rejects.toThrow("编辑权限");
    }
    expect(submitted).toEqual([]);
  });

  it("never saves to a Git-backed or public collection", () => {
    let now = new Date();
    let metadata = {
      id: "c", title: "", description: "", visibility: "private" as const,
      created: now, lastUpdated: now, documentCount: 0,
    };
    let owner = {
      exists: true, visibility: "private" as const, role: "owner" as const,
      everyoneCanView: false, hasOwner: true, shared: false,
    };
    expect(canSaveSkills(owner, { ...metadata, content: { source: "web" } })).toBe(true);
    expect(canSaveSkills(owner, {
      ...metadata, content: { source: "git", remote: "", branch: "main", lastRefreshedAt: now },
    })).toBe(false);
    expect(canSaveSkills({ ...owner, visibility: "public", role: null }, {
      ...metadata, visibility: "public", content: { source: "web" },
    })).toBe(false);
  });

  it("refuses invalid skills before asking the user", async () => {
    let { session, actions, last, submitted } = agentSession("owner");
    await expect(session.createSkill({ ...SKILL, name: "拆剧" })).rejects.toThrow("Skill name");
    await expect(session.createSkill({ ...SKILL, description: " " })).rejects.toThrow("description");
    await expect(session.createSkill({ ...SKILL, body: "长".repeat(30_000) })).rejects.toThrow("太长");
    expect(submitted).toEqual([]);

    let id = await createCollection("owner");
    await session.createSkill({ ...SKILL, collectionId: id });
    await actions.apply(last().id);
    await expect(session.createSkill({ ...SKILL, collectionId: id })).rejects.toThrow("updateSkill");
  });

  it("fails the save when access is lost before approval", async () => {
    let { session, actions, last } = agentSession("editor");
    let id = await createCollection("owner");
    await collection(id).share("owner", [{ accountId: "editor", displayName: "Editor" }], "editor");
    await session.createSkill({ ...SKILL, collectionId: id });

    await collection(id).removeMember("owner", "editor");
    await expect(actions.apply(last().id)).rejects.toThrow("编辑权限");
    expect(await skills(id)).toEqual([]);
  });

  it("stores nothing for a rejected save", async () => {
    let { session, actions, last } = agentSession("owner");
    await session.createSkill(SKILL);
    await actions.reject(last().id);
    expect(await defaultCollectionId("owner")).toBe("");
    expect(await library("owner").listLibrary(domain, "owner")).toEqual([]);
  });
});

describe("updateSkill", () => {
  it("replaces the description and body, keeping the name and other frontmatter", async () => {
    let { session, actions, last } = agentSession("owner");
    let id = await createCollection("owner");
    await collection(id).createContextSkill("baokuan-chaiju/SKILL.md", {
      description: "old",
      body: "---\nname: baokuan-chaiju\ndescription: old\nlicense: MIT\n---\n\nold body\n",
    });

    await session.updateSkill(`${id}/baokuan-chaiju/SKILL.md`, { description: "new", body: "new body\n" });
    expect(last().description).toMatchObject({
      title: "修改技能：baokuan-chaiju",
      autoApprovable: false,
      actionKind: { tag: "context.updateSkill", label: "修改技能" },
    });
    expect((await collection(id).getContextDocument("baokuan-chaiju/SKILL.md"))?.body).toContain("old body");

    await actions.apply(last().id);
    expect((await collection(id).getContextDocument("baokuan-chaiju/SKILL.md"))?.body).toBe(
      "---\nname: baokuan-chaiju\ndescription: new\nlicense: MIT\n---\n\nnew body\n");
  });

  it("refuses documents that are not a skill the account can edit", async () => {
    let { session, submitted } = agentSession("owner");
    let id = await createCollection("owner");
    await expect(session.updateSkill(`${id}/notes.md`, { description: "d", body: "b" }))
      .rejects.toThrow("SKILL.md");
    await expect(session.updateSkill(`${id}/missing/SKILL.md`, { description: "d", body: "b" }))
      .rejects.toThrow("没有找到");
    await expect(session.updateSkill("missing/x/SKILL.md", { description: "d", body: "b" }))
      .rejects.toThrow("编辑权限");
    expect(submitted).toEqual([]);
  });
});

describe("list", () => {
  it("marks the collections createSkill can save to", async () => {
    let { session } = agentSession("owner");
    let own = await createCollection("owner");
    let viewed = await createCollection("other");
    await collection(viewed).share("other", [{ accountId: "owner", displayName: "Owner" }], "viewer");

    let listing = await session.list();
    let writable = Object.fromEntries(listing.entries.map(entry =>
      entry.type === "collection" ? [entry.id, entry.writable] : []));
    expect(writable).toEqual({ [own]: true, [viewed]: false });
  });
});
