// A user's verified emails: bound through a code, held by one account deployment-wide, and the only
// addresses their commit email may be.

import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { EmailOtp } from "../src/email-otp.js";
import { UserDurableObject } from "../src/user.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_USER: DurableObjectNamespace<UserDurableObject>;
    TEST_EMAIL_OTP: DurableObjectNamespace<EmailOtp>;
  }
}

const CLAIMED = /该邮箱已绑定其他账号/;
let counter = 0;
const unique = (prefix: string) => `${prefix}${++counter}${crypto.randomUUID().slice(0, 8)}`;
const address = (prefix: string) => `${unique(prefix)}@example.com`;

// Calls go through runInDurableObject rather than the stub's RPC, whose rejections workerd reports
// as uncaught exceptions even once the test has handled them.
function userNamed(name: string) {
  const stub = env.TEST_USER.getByName(name);
  return <T>(f: (user: UserDurableObject) => Promise<T>) => runInDurableObject(stub, f);
}

async function passwordAccount() {
  const name = unique("pw");
  const inDo = userNamed(name);
  await inDo(u => u.createAccount(name, name, new Uint8Array([1, 2, 3])));
  return { name, inDo };
}

async function emailAccount(email: string) {
  const inDo = userNamed(email);
  await inDo(u => u.loginOrCreateViaEmailOtp(email, true));
  return inDo;
}

const ownerOf = (email: string) => env.TEST_EMAIL_OTP.getByName(email).getOwner();

describe("UserDurableObject verified emails", () => {
  it("lists a password account's emails as none, and an email account's login address", async () => {
    const { inDo } = await passwordAccount();
    expect(await inDo(u => u.getOwnEmails())).toEqual({ loginEmail: null, emails: [] });

    const email = address("login");
    const emailUser = await emailAccount(email);
    expect(await emailUser(u => u.getOwnEmails())).toEqual({ loginEmail: email, emails: [email] });
    expect(await ownerOf(email)).toBe(email);
  });

  it("binds an address to the account and records it as the address's owner", async () => {
    const { name, inDo } = await passwordAccount();
    const email = address("bind");
    await inDo(u => u.addVerifiedEmail(email.toUpperCase()));

    expect((await inDo(u => u.getOwnEmails())).emails).toEqual([email]);
    expect(await ownerOf(email)).toBe(name);
  });

  it("refuses an address another account holds", async () => {
    const email = address("shared");
    const first = await passwordAccount();
    const second = await passwordAccount();
    await first.inDo(u => u.addVerifiedEmail(email));

    await expect(second.inDo(u => u.addVerifiedEmail(email))).rejects.toThrow(CLAIMED);
    await expect(second.inDo(u => u.checkEmailAvailable(email))).rejects.toThrow(CLAIMED);
    expect((await second.inDo(u => u.getOwnEmails())).emails).toEqual([]);
  });

  it("refuses an address that already names an email account, even one with no claim yet", async () => {
    const email = address("existing");
    await emailAccount(email);
    await env.TEST_EMAIL_OTP.getByName(email).release(email);

    const { inDo } = await passwordAccount();
    await expect(inDo(u => u.addVerifiedEmail(email))).rejects.toThrow(CLAIMED);
  });

  it("refuses to create an email account for an address a password account holds", async () => {
    const email = address("held");
    const { inDo } = await passwordAccount();
    await inDo(u => u.addVerifiedEmail(email));

    const claimant = userNamed(email);
    await expect(claimant(u => u.loginOrCreateViaEmailOtp(email, true))).rejects.toThrow(CLAIMED);
    await expect(claimant(u => u.authenticateFromCfAccess(email, true))).rejects.toThrow(CLAIMED);
    expect(await claimant(u => u.whoamiIfExists())).toBeNull();
  });

  it("lets an existing email account sign in again, and claims a login address it never claimed", async () => {
    const email = address("legacy");
    const inDo = await emailAccount(email);
    await env.TEST_EMAIL_OTP.getByName(email).release(email);
    await runInDurableObject(env.TEST_USER.getByName(email), async (_instance, state) => {
      state.storage.kv.put("loginEmailClaimed", false);
    });

    await inDo(u => u.loginOrCreateViaEmailOtp(email, false));
    expect(await ownerOf(email)).toBe(email);
  });

  it("releases an address on removal, and keeps the login address", async () => {
    const { inDo } = await passwordAccount();
    const email = address("remove");
    await inDo(u => u.addVerifiedEmail(email));
    await inDo(u => u.removeOwnEmail(email));
    expect(await ownerOf(email)).toBeNull();
    expect((await inDo(u => u.getOwnEmails())).emails).toEqual([]);

    const login = address("keep");
    const emailUser = await emailAccount(login);
    await expect(emailUser(u => u.removeOwnEmail(login))).rejects.toThrow("登录邮箱不能移除");
    expect(await ownerOf(login)).toBe(login);
  });
});

describe("UserDurableObject commit email", () => {
  it("accepts only an address the account has verified", async () => {
    const { inDo } = await passwordAccount();
    const email = address("commit");
    await expect(inDo(u => u.setOwnCommitEmail(email))).rejects.toThrow("先验证这个邮箱");

    await inDo(u => u.addVerifiedEmail(email));
    await inDo(u => u.setOwnCommitEmail(email.toUpperCase()));
    expect((await inDo(u => u.whoami())).commitEmail).toBe(email);

    await inDo(u => u.setOwnCommitEmail(null));
    expect(await inDo(u => u.whoami())).not.toHaveProperty("commitEmail");
  });

  it("accepts an email account's login address", async () => {
    const email = address("logincommit");
    const inDo = await emailAccount(email);
    await inDo(u => u.setOwnCommitEmail(email));
    expect((await inDo(u => u.whoami())).commitEmail).toBe(email);
  });

  it("clears the commit email when its address is removed", async () => {
    const { inDo } = await passwordAccount();
    const email = address("cleared");
    await inDo(u => u.addVerifiedEmail(email));
    await inDo(u => u.setOwnCommitEmail(email));
    await inDo(u => u.removeOwnEmail(email));
    expect(await inDo(u => u.whoami())).not.toHaveProperty("commitEmail");
  });

  it("adopts a commit email set before verification existed, for the first account to wake", async () => {
    const email = address("legacy");
    const wake = async (name: string) => {
      await runInDurableObject(env.TEST_USER.getByName(name), async (instance, state) => {
        const profile = await instance.whoami();
        state.storage.kv.put("profile", { ...profile, commitEmail: email });
        expect(new UserDurableObject(state, env)).toBeInstanceOf(UserDurableObject);
      });
      // The adoption holds the object's gate; a call that returns has waited for it.
      return userNamed(name);
    };
    const first = await passwordAccount();
    const second = await passwordAccount();

    const firstInDo = await wake(first.name);
    await vi.waitFor(async () => expect(await ownerOf(email)).toBe(first.name));
    expect(await firstInDo(u => u.getOwnEmails())).toEqual({ loginEmail: null, emails: [email] });
    expect((await firstInDo(u => u.whoami())).commitEmail).toBe(email);

    const secondInDo = await wake(second.name);
    await vi.waitFor(async () =>
        expect(await secondInDo(u => u.whoami())).not.toHaveProperty("commitEmail"));
    expect((await secondInDo(u => u.getOwnEmails())).emails).toEqual([]);
    expect(await ownerOf(email)).toBe(first.name);
  });
});
