// Binding an email to an account through the API: the code mailed to the address is the proof, an
// address belongs to one account, and a verified address is what makes a password account an admin.

import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { AuthenticatedApi, PublicApi } from "@gadgets/workshop-shared/api";
import type { EmailOtp } from "../src/email-otp.js";
import { describe, expect, it, vi } from "vitest";
import server from "../src/server.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_EMAIL_OTP: DurableObjectNamespace<EmailOtp>;
  }
}

const ORIGIN = "https://workshop.example";
const BLUEPRINTS = { get: async () => null } as unknown as KVNamespace;
const CLAIMED = /该邮箱已绑定其他账号/;

const unique = (prefix: string) => prefix + crypto.randomUUID().replaceAll("-", "");
const address = (prefix: string) => `${unique(prefix)}@example.com`;

/** A deployment that mails through `sent`, with `admins` as ADMINS. */
function deployment(admins: string[] = []) {
  const sent: { to: string; text: string }[] = [];
  const mail = { send: vi.fn(async (message: { to: string; text: string }) => { sent.push(message); }) };
  const config = {
    ...env, BLUEPRINTS, ADMINS: admins, EMAIL_OTP_ENABLED: "true", INVITE_EMAIL: mail,
  } as unknown as Cloudflare.Env;
  /** The code the latest message to `to` carries. */
  const codeSentTo = (to: string) => {
    const message = sent.findLast(candidate => candidate.to === to);
    if (!message) throw new Error(`No email went to ${to}.`);
    return /\d{6}/.exec(message.text)![0];
  };
  return { config, codeSentTo };
}

async function connect(config: Cloudflare.Env): Promise<RpcStub<PublicApi>> {
  const ctx = createExecutionContext();
  Object.defineProperty(ctx, "exports", { value: Object.create(ctx.exports, {
    AdminSettings: { value: { getByName: () => ({
      ensureBundledBlueprintsInstalled: async () => true,
      recordUserActivity: async () => {},
    }) } },
  }) });
  const response = await server.fetch(
      new Request(`${ORIGIN}/api`, { headers: { Upgrade: "websocket", Origin: ORIGIN } }), config, ctx);
  const socket = response.webSocket;
  if (!socket) throw new TypeError("Expected a WebSocket response.");
  socket.accept();
  return newWebSocketRpcSession<PublicApi>(socket);
}

async function signedUp(api: RpcStub<PublicApi>): Promise<RpcStub<AuthenticatedApi>> {
  const username = unique("user");
  const token = await api.createAccount(username, username, new Uint8Array([1, 2, 3]));
  if (token === null) throw new Error(`${username} was taken.`);
  return api.authenticate(token);
}

describe("binding an email to an account", () => {
  it("holds an address only after its code is entered", async () => {
    const { config, codeSentTo } = deployment();
    using api = await connect(config);
    using session = await signedUp(api);
    const email = address("bind");

    await session.requestEmailVerification(email);
    expect((await session.getOwnEmails()).emails).toEqual([]);
    await expect(session.confirmEmailVerification(email, "000000")).rejects.toThrow("验证码不正确或已过期");
    expect((await session.getOwnEmails()).emails).toEqual([]);

    await session.confirmEmailVerification(email, codeSentTo(email));
    expect(await session.getOwnEmails()).toEqual({ loginEmail: null, emails: [email] });
    await session.setOwnCommitEmail(email);
    expect((await session.whoami()).commitEmail).toBe(email);
  });

  it("refuses an address another account holds, at the request and at sign-in", async () => {
    const { config, codeSentTo } = deployment();
    using api = await connect(config);
    using first = await signedUp(api);
    using second = await signedUp(api);
    const email = address("taken");
    await first.requestEmailVerification(email);
    await first.confirmEmailVerification(email, codeSentTo(email));

    await expect(second.requestEmailVerification(email)).rejects.toThrow(CLAIMED);
    await expect(api.requestEmailOtp(email)).rejects.toThrow(CLAIMED);
    expect((await second.getOwnEmails()).emails).toEqual([]);
  });

  it("refuses a code that arrives after another account took the address", async () => {
    const { config, codeSentTo } = deployment();
    using api = await connect(config);
    using session = await signedUp(api);
    const email = address("raced");
    await session.requestEmailVerification(email);
    await env.TEST_EMAIL_OTP.getByName(email).claim("someone-else");

    await expect(session.confirmEmailVerification(email, codeSentTo(email))).rejects.toThrow(CLAIMED);
    expect((await session.getOwnEmails()).emails).toEqual([]);
  });

  it("refuses to bind the login address of an email account", async () => {
    const { config, codeSentTo } = deployment();
    using api = await connect(config);
    const email = address("member");
    await api.requestEmailOtp(email);
    if (await api.verifyEmailOtp(email, codeSentTo(email)) === null) throw new Error("Code refused.");

    using session = await signedUp(api);
    await expect(session.requestEmailVerification(email)).rejects.toThrow(CLAIMED);
  });

  it("makes a password account an admin once it holds an admin's address", async () => {
    const adminEmail = address("admin");
    const { config, codeSentTo } = deployment([adminEmail]);
    using api = await connect(config);
    using session = await signedUp(api);
    expect(await session.amIAdmin()).toBe(false);

    await session.requestEmailVerification(adminEmail);
    await session.confirmEmailVerification(adminEmail, codeSentTo(adminEmail));
    expect(await session.amIAdmin()).toBe(true);
    expect(await session.getAdminApi()).not.toBeNull();

    await session.removeOwnEmail(adminEmail);
    expect(await session.amIAdmin()).toBe(false);
  });
});
