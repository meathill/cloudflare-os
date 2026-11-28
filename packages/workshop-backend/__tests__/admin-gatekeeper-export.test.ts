import {describe, expect, it} from "vitest";
import {env} from "cloudflare:workers";
import {runInDurableObject} from "cloudflare:test";
import type {Fetcher} from "@cloudflare/workers-types";
import {ADMIN_ACCESS_ERROR_CODES, getAdminAccessErrorCode} from "@gadgets/workshop-shared/api";
import type {GatekeeperUser} from "@gadgets/workshop-shared/gatekeeper";
import type {UserDurableObject} from "../src/user";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_USER: DurableObjectNamespace<UserDurableObject>;
  }
}

type UserInternals = UserDurableObject & {
  storage: {
    created: { get(): boolean; put(value: boolean): void };
    connectedAccounts: { put(record: unknown): void };
    nextAccountId: { put(n: number): void };
  };
};

const FILES = [
  { path: "c1/_collection.json", contentType: "application/json", body: "{}" },
  { path: "c1/skill/SKILL.md", contentType: "text/markdown", body: "# Skill" },
];

function freshUser() {
  const stub = env.TEST_USER.getByName(`export-${crypto.randomUUID()}`);
  return {
    inDo<T>(f: (user: UserInternals) => Promise<T>): Promise<T> {
      return runInDurableObject(stub, (instance: UserDurableObject) => f(instance as UserInternals));
    },
  };
}

function fakeAccount(user: UserInternals, name: string, props: object = {}) {
  return user.ctx.exports.FakeGatekeeperAccount({props: {name, ...props}}) as
    unknown as Fetcher<GatekeeperUser>;
}

async function rejection(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to reject.");
}

describe("UserDurableObject.exportGatekeeperContentForAdmin", () => {
  it("refuses an account that was never created", async () => {
    const {inDo} = freshUser();
    const error = await rejection(inDo(user => user.exportGatekeeperContentForAdmin("context")));
    expect(getAdminAccessErrorCode(error)).toBe(ADMIN_ACCESS_ERROR_CODES.userNotFound);
  });

  it("exports each account of the vendor, and nothing of other vendors", async () => {
    const {inDo} = freshUser();
    const result = await inDo(async user => {
      user.storage.created.put(true);
      user.storage.nextAccountId.put(3);
      user.storage.connectedAccounts.put({
        id: 0, account: fakeAccount(user, "ctx-one", {exportFiles: FILES}), vendorId: "context",
        description: {displayName: "ctx-one"},
      });
      user.storage.connectedAccounts.put({
        id: 1, account: fakeAccount(user, "other-vendor", {exportFiles: FILES}), vendorId: "custom",
        description: {displayName: "other-vendor"},
      });
      user.storage.connectedAccounts.put({
        id: 2, account: fakeAccount(user, "ctx-two", {exportFiles: FILES.slice(1)}),
        vendorId: "context", description: {displayName: "ctx-two"},
      });
      return user.exportGatekeeperContentForAdmin("context");
    });
    expect(result).toEqual([
      { accountId: 0, files: FILES },
      { accountId: 2, files: FILES.slice(1) },
    ]);
  });

  it("returns an empty list when the user has no account of the vendor", async () => {
    const {inDo} = freshUser();
    const result = await inDo(async user => {
      user.storage.created.put(true);
      user.storage.nextAccountId.put(1);
      user.storage.connectedAccounts.put({
        id: 0, account: fakeAccount(user, "other-vendor"), vendorId: "custom",
        description: {displayName: "other-vendor"},
      });
      return user.exportGatekeeperContentForAdmin("context");
    });
    expect(result).toEqual([]);
  });

  it("fails as unsupported when the account does not implement the export", async () => {
    const {inDo} = freshUser();
    const error = await rejection(inDo(async user => {
      user.storage.created.put(true);
      user.storage.nextAccountId.put(1);
      user.storage.connectedAccounts.put({
        id: 0, account: fakeAccount(user, "no-export", {exportUnsupported: true}),
        vendorId: "context", description: {displayName: "no-export"},
      });
      return user.exportGatekeeperContentForAdmin("context");
    }));
    expect(String(error)).toContain("该账号不支持导出");
  });

  it("passes a real failure through", async () => {
    const {inDo} = freshUser();
    const error = await rejection(inDo(async user => {
      user.storage.created.put(true);
      user.storage.nextAccountId.put(1);
      user.storage.connectedAccounts.put({
        id: 0, account: fakeAccount(user, "broken", {exportError: "storage exploded"}),
        vendorId: "context", description: {displayName: "broken"},
      });
      return user.exportGatekeeperContentForAdmin("context");
    }));
    expect(String(error)).toContain("storage exploded");
  });
});

describe("UserDurableObject.deleteGatekeeperContentForAdmin", () => {
  const IDS = ["coll-a", "coll-b"];

  it("refuses an account that was never created", async () => {
    const {inDo} = freshUser();
    const error = await rejection(inDo(user => user.deleteGatekeeperContentForAdmin("context", IDS)));
    expect(getAdminAccessErrorCode(error)).toBe(ADMIN_ACCESS_ERROR_CODES.userNotFound);
  });

  it("deletes on each account of the vendor, and nothing of other vendors", async () => {
    const {inDo} = freshUser();
    const result = await inDo(async user => {
      user.storage.created.put(true);
      user.storage.nextAccountId.put(3);
      user.storage.connectedAccounts.put({
        id: 0, account: fakeAccount(user, "ctx-one", {deletedIds: ["coll-a"]}), vendorId: "context",
        description: {displayName: "ctx-one"},
      });
      user.storage.connectedAccounts.put({
        id: 1, account: fakeAccount(user, "other-vendor", {deletedIds: IDS}), vendorId: "custom",
        description: {displayName: "other-vendor"},
      });
      user.storage.connectedAccounts.put({
        id: 2, account: fakeAccount(user, "ctx-two", {deletedIds: ["coll-b"]}),
        vendorId: "context", description: {displayName: "ctx-two"},
      });
      const deletions = await user.deleteGatekeeperContentForAdmin("context", IDS);
      // The vendor-mismatched account was never asked to delete.
      const other = fakeAccount(user, "other-vendor");
      expect(await (other as unknown as { calls(): Promise<string[]> }).calls())
        .not.toContain(`deleteForAdmin(${IDS.join(",")})`);
      return deletions;
    });
    expect(result).toEqual([
      { accountId: 0, deleted: ["coll-a"] },
      { accountId: 2, deleted: ["coll-b"] },
    ]);
  });

  it("returns an empty list when the user has no account of the vendor", async () => {
    const {inDo} = freshUser();
    const result = await inDo(async user => {
      user.storage.created.put(true);
      user.storage.nextAccountId.put(1);
      user.storage.connectedAccounts.put({
        id: 0, account: fakeAccount(user, "other-vendor"), vendorId: "custom",
        description: {displayName: "other-vendor"},
      });
      return user.deleteGatekeeperContentForAdmin("context", IDS);
    });
    expect(result).toEqual([]);
  });

  it("fails as unsupported when the account does not implement the deletion", async () => {
    const {inDo} = freshUser();
    const error = await rejection(inDo(async user => {
      user.storage.created.put(true);
      user.storage.nextAccountId.put(1);
      user.storage.connectedAccounts.put({
        id: 0, account: fakeAccount(user, "no-delete", {deleteUnsupported: true}),
        vendorId: "context", description: {displayName: "no-delete"},
      });
      return user.deleteGatekeeperContentForAdmin("context", IDS);
    }));
    expect(String(error)).toContain("该账号不支持删除");
  });

  it("passes a real failure through", async () => {
    const {inDo} = freshUser();
    const error = await rejection(inDo(async user => {
      user.storage.created.put(true);
      user.storage.nextAccountId.put(1);
      user.storage.connectedAccounts.put({
        id: 0, account: fakeAccount(user, "broken", {deleteError: "storage exploded"}),
        vendorId: "context", description: {displayName: "broken"},
      });
      return user.deleteGatekeeperContentForAdmin("context", IDS);
    }));
    expect(String(error)).toContain("storage exploded");
  });
});
