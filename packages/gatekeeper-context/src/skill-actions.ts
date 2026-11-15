// Agent-written skills. The agent's SKILL.md reaches a collection only through the approval queue,
// and only a private, web-managed collection this account owns or edits. Each action carries the
// complete manifest, so the approver reads exactly what will be stored.

import { parseDocument, stringify as stringifyYaml } from "yaml";
import { ActionApplyError, defineActions } from "@gadgets/gatekeeper-kit/actions";
import { buildDescription, sanitizeTitle } from "@gadgets/gatekeeper-kit/action-description";
import { parseSkillManifest } from "./agent-skill.js";
import { collectionPermissions, type CollectionAccess } from "./collection-access.js";
import { initializeCollection, newCollectionMetadata } from "./collection-create.js";
import type { ContextCollectionDurableObject } from "./context-collection.js";
import { VENDOR_ID, type ContextCollectionMetadata } from "./context-types.js";
import { joinFrontmatter, splitFrontmatter } from "./description-extractors.js";
import type { UserLibraryDurableObject } from "./user-library.js";

/** The collection agent-saved skills go to when the agent names none. */
export const DEFAULT_SKILL_COLLECTION = {
  title: "我的技能",
  description: "在对话里让智能体保存的技能。",
};

/** Largest SKILL.md body an agent may save, so the approval card can show all of it. */
export const MAX_SKILL_BODY_BYTES = 64 * 1024;

/** What skill actions reach: this account's view of its collections and library. */
export type SkillHost = {
  domain: string;
  accountId: string;
  collection(id: string): DurableObjectStub<ContextCollectionDurableObject>;
  userLibrary(): DurableObjectStub<UserLibraryDurableObject>;
};

/** One SKILL.md write, exactly as the approver sees it. */
export type SkillWrite = {
  /** Absent for the default collection, which apply creates when it no longer exists. */
  collectionId?: string;
  /** The target's title, shown to the approver. */
  collectionTitle: string;
  /** The manifest path, `<name>/SKILL.md`. */
  path: string;
  name: string;
  /** The skill's description, also used as the document's listing description. */
  description: string;
  manifest: string;
};

export type WritableCollection = { metadata: ContextCollectionMetadata; access: CollectionAccess };

/** Agents save skills only to private, web-managed collections the account owns or edits. */
export function canSaveSkills(access: CollectionAccess, metadata: ContextCollectionMetadata): boolean {
  return access.visibility === "private" && collectionPermissions(access, false).canEdit
    && metadata.content.source === "web";
}

/** The collection, if this account may write skills into it; null otherwise. */
export async function writableCollection(
    host: SkillHost, collectionId: string): Promise<WritableCollection | null> {
  let collection = host.collection(collectionId);
  let [access, metadata] = await Promise.all([
    collection.getAccess(host.accountId), collection.getMetadata(),
  ]);
  return canSaveSkills(access, metadata) ? { metadata, access } : null;
}

/** The default skill collection, if it exists and is still writable. */
export async function currentDefaultCollection(
    host: SkillHost): Promise<{ id: string; target: WritableCollection | null }> {
  let id = await host.userLibrary().getDefaultSkillCollectionId();
  return { id, target: id ? await writableCollection(host, id) : null };
}

function assertBodySize(body: string): void {
  let bytes = new TextEncoder().encode(body).byteLength;
  if (bytes > MAX_SKILL_BODY_BYTES) {
    throw new Error(`技能正文太长（${bytes} 字节，上限 ${MAX_SKILL_BODY_BYTES}）。请精简或拆成多个技能。`);
  }
}

/** A new manifest: frontmatter from `name` and `description`, then `body`. Throws if invalid. */
export function composeSkillManifest(name: string, description: string, body: string): string {
  assertBodySize(body);
  let manifest = joinFrontmatter(stringifyYaml({ name, description }).trimEnd(), body);
  parseSkillManifest(`${name}/SKILL.md`, manifest);
  return manifest;
}

/**
 * An existing manifest with a new description and body. Other frontmatter keys, the name among them,
 * are kept as they were. Throws if the result is not a valid manifest.
 */
export function updateSkillManifest(
    path: string, existing: string, description: string, body: string): string {
  assertBodySize(body);
  let { frontmatter } = splitFrontmatter(existing);
  if (frontmatter === null) throw new Error("Skill manifest must start with YAML frontmatter.");
  let document = parseDocument(frontmatter);
  if (document.errors.length > 0) throw new Error("Skill frontmatter is not valid YAML.");
  document.set("description", description);
  let manifest = joinFrontmatter(document.toString().trimEnd(), body);
  parseSkillManifest(path, manifest);
  return manifest;
}

// Creates the default collection when the stored one is gone or no longer writable. Concurrent saves
// race through the library's compare-and-set; a loser deletes its own collection and uses the winner's.
async function ensureDefaultCollection(host: SkillHost): Promise<string> {
  let { id: current, target } = await currentDefaultCollection(host);
  if (target) return current;
  let library = host.userLibrary();
  let metadata = newCollectionMetadata(
    DEFAULT_SKILL_COLLECTION.title, DEFAULT_SKILL_COLLECTION.description, "private", undefined, "web");
  let collection = host.collection(metadata.id);
  let deleter = { accountId: host.accountId, isAdmin: false };
  await initializeCollection(collection, metadata, host.domain, host.accountId,
    created => library.createOwnedCollection(created.id), deleter);
  let winner = await library.claimDefaultSkillCollection(metadata.id, current);
  if (winner === metadata.id) return winner;
  await collection.deleteSelf(deleter.accountId, deleter.isAdmin);
  if (!await writableCollection(host, winner)) {
    throw new ActionApplyError("默认技能集合刚刚变了，请重新保存。");
  }
  return winner;
}

async function requireWritable(host: SkillHost, collectionId: string): Promise<void> {
  if (!await writableCollection(host, collectionId)) {
    throw new ActionApplyError("这个集合已不存在，或你已没有编辑权限。");
  }
}

async function applyCreate(write: SkillWrite, host: SkillHost): Promise<void> {
  let collectionId = write.collectionId;
  if (collectionId) await requireWritable(host, collectionId);
  else collectionId = await ensureDefaultCollection(host);
  let collection = host.collection(collectionId);
  let existing = await collection.getContextDocument(write.path);
  if (existing) {
    // A retry of an apply that already stored it.
    if (existing.body === write.manifest) return;
    throw new ActionApplyError(`集合里已有同名技能：${write.name}。`);
  }
  await collection.createContextSkill(write.path, { description: write.description, body: write.manifest });
}

function describeCreate(write: SkillWrite, shared: boolean) {
  let intro = write.collectionId
    ? "把智能体写的技能保存到技能库。"
    : `把智能体写的技能保存到技能库的「${DEFAULT_SKILL_COLLECTION.title}」集合；集合不存在时会新建。`;
  if (shared) intro += "这个集合已共享，其他成员也会看到这个技能。";
  return {
    title: sanitizeTitle(`保存技能：${write.name}`),
    ...buildDescription(intro)
      .inline("集合", write.collectionTitle)
      .inline("路径", write.path)
      .verbatim("SKILL.md", write.manifest, "markdown")
      .finish(),
    implementsRevert: false,
  };
}

const SAVE_SKILL = { tag: "context.saveSkill", label: "保存技能" };

/** Skill writes: `createSharedSkill` is `createSkill` into a collection someone else can read. */
export const SKILL_ACTIONS = defineActions<SkillHost, {
  createSkill: SkillWrite;
  createSharedSkill: SkillWrite;
  updateSkill: SkillWrite;
}>({
  createSkill: {
    kind: SAVE_SKILL,
    autoApprovable: true,
    delivery: "await-decision",
    describe: write => describeCreate(write, false),
    apply: applyCreate,
  },
  createSharedSkill: {
    kind: SAVE_SKILL,
    // Rule 2: the skill reaches the collection's other members.
    autoApprovable: false,
    delivery: "await-decision",
    describe: write => describeCreate(write, true),
    apply: applyCreate,
  },
  updateSkill: {
    kind: { tag: "context.updateSkill", label: "修改技能" },
    // Rule 1: replaces the skill's previous instructions.
    autoApprovable: false,
    delivery: "await-decision",
    describe: write => ({
      title: sanitizeTitle(`修改技能：${write.name}`),
      ...buildDescription("用下面的内容整体替换这个技能的 SKILL.md，原有内容会被覆盖。")
        .inline("集合", write.collectionTitle)
        .inline("路径", write.path)
        .verbatim("SKILL.md", write.manifest, "markdown")
        .finish(),
      implementsRevert: false,
    }),
    async apply(write, host) {
      if (!write.collectionId) throw new ActionApplyError("缺少要修改的集合。");
      await requireWritable(host, write.collectionId);
      let collection = host.collection(write.collectionId);
      if (!await collection.getContextDocument(write.path)) {
        throw new ActionApplyError("要修改的技能已不存在。");
      }
      await collection.putContextDocument(write.path, {
        description: write.description, body: write.manifest,
      });
    },
  },
}, { fence: "none", vendorId: VENDOR_ID });
