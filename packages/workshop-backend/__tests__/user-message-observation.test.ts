import {describe, expect, it, vi} from "vitest";
import {env} from "cloudflare:workers";
import {runInDurableObject} from "cloudflare:test";
import type {Fetcher} from "@cloudflare/workers-types";
import type {GatekeeperUser} from "@gadgets/workshop-shared/gatekeeper";
import type {OverseerDurableObject} from "../src/overseer";
import type {UserDurableObject} from "../src/user";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
    TEST_USER: DurableObjectNamespace<UserDurableObject>;
  }
}

type UserInternals = UserDurableObject & {
  storage: {
    connectedAccounts: { get(id: number): Record<string, unknown> | undefined; put(record: unknown): void };
    nextAccountId: { get(): number; put(n: number): void };
  };
};
type Impl = OverseerDurableObject["impl"];

const USER = {type: "user" as const, id: "test-user", name: "Test"};
const AGENT = {type: "agent" as const, id: "test-agent", name: "Agent"};

function freshUser() {
  const stub = env.TEST_USER.getByName(`observe-${crypto.randomUUID()}`);
  return {
    stub,
    inDo<T>(f: (user: UserInternals) => Promise<T>): Promise<T> {
      return runInDurableObject(stub, (instance: UserDurableObject) => f(instance as UserInternals));
    },
  };
}

function fakeAccount(user: UserInternals, name: string) {
  return user.ctx.exports.FakeGatekeeperAccount({props: {name}}) as unknown as Fetcher<GatekeeperUser>;
}

async function inOverseer<T>(name: string, f: (impl: Impl) => Promise<T>): Promise<T> {
  return runInDurableObject(env.TEST_OVERSEER.getByName(name), instance => f(instance.impl));
}

// sendChatMessage 的 clientUser：这里只需要 id 和 forwardOwnChatMessage。
// 测试进程里所有 DO 同处一个 isolate，把测试上下文创建的 DO stub 传进另一个 DO 调 RPC 会被
// workerd 拒（Cannot perform I/O on behalf of a different Durable Object）；生产各 DO 独立
// isolate 不受此限，所以转发路径用假 stub 验证参数，真实连通性由 forwardOwnChatMessage 的
// DO 级测试覆盖。
function fakeClientUser() {
  const forwardOwnChatMessage = vi.fn<(text: string, sentAt: number) => Promise<void>>(
    async () => {});
  const stub = {
    id: { toString: () => "fake-user" },
    forwardOwnChatMessage,
  } as unknown as DurableObjectStub<UserDurableObject>;
  return { stub, forwardOwnChatMessage };
}

describe("forwardOwnChatMessage", () => {
  it("delivers the message only to accounts declaring observesUserMessages", async () => {
    const {inDo} = freshUser();
    const observing = `observing-${crypto.randomUUID()}`;
    const plain = `plain-${crypto.randomUUID()}`;
    const {observed, skipped} = await inDo(async user => {
      user.storage.nextAccountId.put(2);
      user.storage.connectedAccounts.put({
        id: 0, account: fakeAccount(user, observing), vendorId: "custom",
        description: {displayName: observing, observesUserMessages: true as const},
      });
      user.storage.connectedAccounts.put({
        id: 1, account: fakeAccount(user, plain), vendorId: "custom",
        description: {displayName: plain},
      });
      await user.forwardOwnChatMessage("每集结尾要留钩子", 1_700_000_000_000);
      return {
        observed: await (user.ctx.exports.FakeGatekeeperAccount({props: {name: observing}}) as
          unknown as {calls(): Promise<string[]>}).calls(),
        skipped: await (user.ctx.exports.FakeGatekeeperAccount({props: {name: plain}}) as
          unknown as {calls(): Promise<string[]>}).calls(),
      };
    });
    expect(observed).toEqual(["observe(每集结尾要留钩子:1700000000000)"]);
    expect(skipped).toEqual([]);
  });
});

describe("sendChatMessage forwarding", () => {
  it("forwards a plain user text message, but not slash commands or non-user authors", async () => {
    const {stub: clientUser, forwardOwnChatMessage} = fakeClientUser();
    const overseer = crypto.randomUUID();

    const chatId = await inOverseer(overseer, impl =>
      impl.newChat(clientUser, {profile: USER}, "先聊聊"));
    expect(forwardOwnChatMessage).not.toHaveBeenCalled();

    await inOverseer(overseer, impl =>
      impl.sendChatMessage(clientUser, {profile: USER}, chatId, "每集开头三秒要出冲突"));
    expect(forwardOwnChatMessage).toHaveBeenCalledTimes(1);
    expect(forwardOwnChatMessage).toHaveBeenCalledWith("每集开头三秒要出冲突", expect.any(Number));

    // 内置斜杠命令（/compact）不转发。
    await inOverseer(overseer, impl =>
      impl.sendChatMessage(clientUser, {profile: USER}, chatId,
        {id: {builtin: true, commandId: "compact"}, args: ""}));
    expect(forwardOwnChatMessage).toHaveBeenCalledTimes(1);

    // AI 作者不转发。
    await inOverseer(overseer, impl =>
      impl.sendChatMessage(clientUser, {profile: AGENT}, chatId, "agent says"));
    expect(forwardOwnChatMessage).toHaveBeenCalledTimes(1);
  });
});
