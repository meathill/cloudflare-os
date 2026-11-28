// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import type * as Kumo from "@cloudflare/kumo";
import type { OwnEmails } from "@gadgets/workshop-shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountEmails } from "./AccountEmails";

type Api = {
  getOwnEmails: () => Promise<OwnEmails>;
  requestEmailVerification: (email: string) => Promise<void>;
  confirmEmailVerification: (email: string, code: string) => Promise<void>;
  removeOwnEmail: (email: string) => Promise<void>;
  setOwnCommitEmail: (email: string | null) => Promise<void>;
};

const toast = vi.hoisted(() => vi.fn<(toast: { title: string }) => void>());
let api: Api;

vi.mock("@cloudflare/kumo", async (importOriginal) => ({
  ...(await importOriginal<typeof Kumo>()),
  useKumoToastManager: () => ({ add: toast }),
}));
vi.mock("../../AuthContext", () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }));

let container: HTMLDivElement;
let root: Root;

const buttonNamed = (name: string) =>
  [...container.querySelectorAll("button")].find(button => button.textContent === name || button.ariaLabel === name);

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const click = (name: string) => act(async () => buttonNamed(name)!.click());

beforeEach(() => {
  toast.mockReset();
  api = {
    getOwnEmails: vi.fn<Api["getOwnEmails"]>(async () => ({ loginEmail: null, emails: ["me@example.com"] })),
    requestEmailVerification: vi.fn<Api["requestEmailVerification"]>(async () => {}),
    confirmEmailVerification: vi.fn<Api["confirmEmailVerification"]>(async () => {}),
    removeOwnEmail: vi.fn<Api["removeOwnEmail"]>(async () => {}),
    setOwnCommitEmail: vi.fn<Api["setOwnCommitEmail"]>(async () => {}),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = (commitEmail?: string) => act(async () => root.render(<AccountEmails commitEmail={commitEmail} />));

it("keeps the login email, which names the account, from being removed", async () => {
  api.getOwnEmails = async () => ({ loginEmail: "me@example.com", emails: ["me@example.com", "work@example.com"] });
  await render();

  expect(container.textContent).toContain("登录邮箱");
  expect(buttonNamed("移除 me@example.com")).toBeUndefined();
  await click("移除 work@example.com");
  expect(api.removeOwnEmail).toHaveBeenCalledWith("work@example.com");
});

it("chooses the commit email among the held addresses, and clears it again", async () => {
  await render();
  await click("用于提交");
  expect(api.setOwnCommitEmail).toHaveBeenCalledWith("me@example.com");
  expect(container.textContent).toContain("提交邮箱");

  await click("不再用于提交");
  expect(api.setOwnCommitEmail).toHaveBeenLastCalledWith(null);
});

it("adds an address only after its code is confirmed", async () => {
  await render();
  await click("添加邮箱");
  await type(container.querySelector<HTMLInputElement>('input[type="email"]')!, "New@Example.com");
  await click("发送验证码");
  expect(api.requestEmailVerification).toHaveBeenCalledWith("new@example.com");
  expect(api.confirmEmailVerification).not.toHaveBeenCalled();

  api.getOwnEmails = async () => ({ loginEmail: null, emails: ["me@example.com", "new@example.com"] });
  await type(container.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!, " 123456 ");
  await click("验证并添加");

  expect(api.confirmEmailVerification).toHaveBeenCalledWith("new@example.com", "123456");
  expect(container.textContent).toContain("new@example.com");
  expect(buttonNamed("发送验证码")).toBeUndefined();
});

it("shows why an address cannot be added, such as another account holding it", async () => {
  api.requestEmailVerification = async () => { throw new Error("该邮箱已绑定其他账号，请用原账号登录。"); };
  await render();
  await click("添加邮箱");
  await type(container.querySelector<HTMLInputElement>('input[type="email"]')!, "taken@example.com");
  await click("发送验证码");

  expect(container.textContent).toContain("该邮箱已绑定其他账号");
  expect(container.querySelector('input[autocomplete="one-time-code"]')).toBeNull();
});

it("refuses a malformed address before asking the server", async () => {
  await render();
  await click("添加邮箱");
  await type(container.querySelector<HTMLInputElement>('input[type="email"]')!, "not-an-email");
  await click("发送验证码");

  expect(api.requestEmailVerification).not.toHaveBeenCalled();
  expect(container.textContent).toContain("name@example.com");
});
