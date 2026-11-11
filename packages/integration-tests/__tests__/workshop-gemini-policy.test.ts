import { afterAll, beforeAll, expect, it } from "vitest";
import { type Harness, startHarness } from "../src/harness.js";
import { NetworkInterceptor } from "../src/network-interceptor.js";
import { connect, nextUsernames, signUp, waitForIdleChat } from "../src/rpc-client.js";

let harness: Harness;
const network = new NetworkInterceptor({ handlers: [] });

beforeAll(async () => {
  network.install();
  harness = await startHarness({
    gatekeepers: [],
    patchWorkshop(config) {
      config.vars = { ...config.vars, GEMINI_ONLY: "true" };
    },
  });
});

afterAll(async () => {
  try {
    await harness?.server.close();
    expect(network.getUnmockedCalls()).toEqual([]);
  } finally {
    network.uninstall();
  }
});

it("固定模式仅提供 Gemini，并保留不启动 Agent 的人工聊天", async () => {
  const [username] = nextUsernames("geminipolicy");
  using publicApi = connect(harness.url);
  using api = await signUp(publicApi, username);

  expect(await api.listModels()).toEqual([
    { type: "agent", id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
  ]);
  expect(await api.getPreferredModel()).toBe("gemini-3.8-flash");
  await expect(api.setPreferredModel("gemini-3.8-flash")).resolves.toBeUndefined();
  await expect(api.setPreferredModel("missing-model")).rejects.toThrow("No such model");

  using workspace = await api.newWorkspace();
  const chatId = await workspace.newChat("第一条人工消息", null);
  await waitForIdleChat(workspace, chatId);
  await workspace.sendChatMessage(chatId, "第二条人工消息", null);
  await waitForIdleChat(workspace, chatId);

  const history = await workspace.getChatHistory(chatId);
  expect(
    history.messages.map((message) =>
      message.type === "message" ? message.message : message.type,
    ),
  ).toEqual(["第一条人工消息", "第二条人工消息"]);
  expect((await workspace.listChats())[0]?.activeAgent).toBeUndefined();
});
