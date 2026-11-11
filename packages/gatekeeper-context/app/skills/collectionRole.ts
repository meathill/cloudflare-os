import type { ContextCollectionRole } from "../../src/context-types";

export const COLLECTION_ROLE_LABELS: Record<ContextCollectionRole, string> = {
  viewer: "查看者",
  editor: "编辑者",
  owner: "所有者",
};
