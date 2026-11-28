// The agent's Context session: the read session, plus saving skills to the account's own collections
// through the approval queue. Checks here only fail early with a useful message; apply re-checks.

import { RpcTarget } from "capnweb";
import { validateRpc } from "capnweb-validate";
import type { ActionSubmitter, BoundActionSet } from "@gadgets/gatekeeper-kit/actions";
import { isSkillManifestPath, parseSkillManifest } from "./agent-skill.js";
import {
  ContextListing, ContextReadResult, ContextSearchResult, decodeDocId,
  type ContextLibrary, type ContextSkillInput, type ContextSkillUpdate,
} from "./context-types.js";
import type { LibraryReadSession } from "./library-read.js";
import {
  composeSkillManifest, currentDefaultCollection, DEFAULT_SKILL_COLLECTION, updateSkillManifest,
  writableCollection, type SkillHost, type SkillWrite,
} from "./skill-actions.js";

type SkillActions = BoundActionSet<{
  createSkill: SkillWrite;
  createSharedSkill: SkillWrite;
  updateSkill: SkillWrite;
}>;

const NOT_WRITABLE = "只能把技能保存到你有编辑权限的私有集合（不能是公共集合或 Git 集合）。";

@validateRpc()
export class LibrarySession extends RpcTarget implements ContextLibrary {
  constructor(
    private reader: LibraryReadSession,
    private queue: ActionSubmitter & Disposable,
    private actions: SkillActions,
    private host: SkillHost,
  ) {
    super();
  }

  /** Release the read session and this session's approval queue stub. */
  [Symbol.dispose](): void {
    this.reader[Symbol.dispose]();
    this.queue[Symbol.dispose]();
  }

  search(query: string, opts?: { collectionId?: string; limit?: number }): Promise<ContextSearchResult[]> {
    return this.reader.search(query, opts);
  }

  list(opts?: { collectionId?: string; path?: string }): Promise<ContextListing> {
    return this.reader.list(opts);
  }

  read(docId: string): Promise<ContextReadResult | null> {
    return this.reader.read(docId);
  }

  async createSkill(skill: ContextSkillInput): Promise<void> {
    let path = `${skill.name}/SKILL.md`;
    let manifest = composeSkillManifest(skill.name, skill.description, skill.body);
    let target = skill.collectionId
      ? { id: skill.collectionId, target: await writableCollection(this.host, skill.collectionId) }
      : await currentDefaultCollection(this.host);
    if (skill.collectionId && !target.target) throw new Error(NOT_WRITABLE);
    if (target.target) {
      let taken = await this.host.collection(target.id).listContextDocuments(`${skill.name}/`);
      if (taken.length > 0) {
        throw new Error(`集合里已有名为 ${skill.name} 的技能。要改它请用 updateSkill，或换一个 name。`);
      }
    }
    let write: SkillWrite = {
      collectionId: target.target ? target.id : undefined,
      collectionTitle: target.target?.metadata.title ?? DEFAULT_SKILL_COLLECTION.title,
      path,
      name: skill.name,
      description: skill.description.trim(),
      manifest,
    };
    await this.actions.submit(
      this.queue, target.target?.access.shared ? "createSharedSkill" : "createSkill", write);
  }

  async updateSkill(docId: string, skill: ContextSkillUpdate): Promise<void> {
    let decoded = decodeDocId(docId);
    if (!decoded || !isSkillManifestPath(decoded.path)) {
      throw new Error("docId 必须指向一个技能的 SKILL.md。");
    }
    let target = await writableCollection(this.host, decoded.collectionId);
    if (!target) throw new Error(NOT_WRITABLE);
    let existing = await this.host.collection(decoded.collectionId).getContextDocument(decoded.path);
    if (!existing) throw new Error("没有找到这个技能。");
    let { name } = parseSkillManifest(decoded.path, existing.body);
    await this.actions.submit(this.queue, "updateSkill", {
      collectionId: decoded.collectionId,
      collectionTitle: target.metadata.title,
      path: decoded.path,
      name,
      description: skill.description.trim(),
      manifest: updateSkillManifest(decoded.path, existing.body, skill.description, skill.body),
    });
  }
}
