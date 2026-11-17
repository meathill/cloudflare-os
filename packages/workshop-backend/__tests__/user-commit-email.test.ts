import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { UserDurableObject } from "../src/user.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_USER: DurableObjectNamespace<UserDurableObject>;
  }
}

let userCounter = 0;
async function freshUser() {
  const name = `usercommitemail${++userCounter}`;
  const stub = env.TEST_USER.getByName(name);
  // Calls go through runInDurableObject rather than the stub's RPC, whose rejections workerd
  // reports as uncaught exceptions even once the test has handled them.
  const inDo = <T>(f: (user: UserDurableObject) => Promise<T>) => runInDurableObject(stub, f);
  await inDo(u => u.createAccount(name, name, new Uint8Array([1])));
  return inDo;
}

describe("UserDurableObject.addVerifiedEmail", () => {
  it("rejects addresses that could break out of a commit header", async () => {
    const inDo = await freshUser();
    await inDo(u => u.addVerifiedEmail("me@example.com"));
    await inDo(u => u.setOwnCommitEmail("me@example.com"));
    for (const bad of ["me@example.com>\ncommitter x", "a <b@c>", "no-at-sign", "", "x@"]) {
      await expect(inDo(u => u.addVerifiedEmail(bad))).rejects.toThrow(/Invalid commit email/);
    }
    expect((await inDo(u => u.whoami())).commitEmail).toBe("me@example.com");
  });
});
