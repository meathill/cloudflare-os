import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import {
  EMAIL_OTP_IP_LIMIT, EMAIL_OTP_IP_WINDOW_MS, EMAIL_OTP_MAX_ATTEMPTS,
  EMAIL_OTP_RESEND_COOLDOWN_MS, EMAIL_OTP_TTL_MS,
  type EmailOtp,
} from "../src/email-otp.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_EMAIL_OTP: DurableObjectNamespace<EmailOtp>;
  }
}

let counter = 0;
const fresh = () => env.TEST_EMAIL_OTP.getByName(`email-otp-${++counter}`);

// Report refusals as values: a native RPC promise left to `.rejects` is also flagged as an
// unhandled rejection by the pool.
async function request(stub: DurableObjectStub<EmailOtp>, codeHash: string): Promise<string> {
  try {
    await stub.request(codeHash);
    return "ok";
  } catch (err) {
    return `error:${(err as Error).message}`;
  }
}

// Age the staged record: `expiresAt` is the code's deadline, and the resend cooldown counts from
// `expiresAt - TTL`, so moving it forward moves both.
const age = (stub: DurableObjectStub<EmailOtp>, keepLiveForMs: number) =>
  runInDurableObject(stub, async (instance: EmailOtp) => {
    const [[key, stored]] = [...instance.ctx.storage.kv.list()] as [string, { expiresAt: number }][];
    instance.ctx.storage.kv.put(key, { ...stored, expiresAt: Date.now() + keepLiveForMs });
  });

describe("EmailOtp", () => {
  it("accepts a live code once and consumes it", async () => {
    const stub = fresh();
    expect(await request(stub, "hash-1")).toBe("ok");
    await runInDurableObject(stub, async (instance: EmailOtp) => {
      expect(await instance.ctx.storage.getAlarm()).toBeGreaterThan(Date.now());
      expect(await instance.ctx.storage.getAlarm()).toBeLessThanOrEqual(
          Date.now() + EMAIL_OTP_TTL_MS);
    });

    expect(await stub.verify("hash-1")).toBe(true);
    // Single use: the entry and its alarm are gone with the success.
    expect(await stub.verify("hash-1")).toBe(false);
    await runInDurableObject(stub, async (instance: EmailOtp) => {
      expect([...instance.ctx.storage.kv.list()]).toEqual([]);
      expect(await instance.ctx.storage.getAlarm()).toBeNull();
    });
  });

  it("refuses a wrong code and retires it after too many attempts", async () => {
    const stub = fresh();
    await request(stub, "hash-1");

    for (let attempt = 1; attempt < EMAIL_OTP_MAX_ATTEMPTS; attempt++) {
      expect(await stub.verify("wrong")).toBe(false);
    }
    expect(await stub.verify("wrong")).toBe(false);
    // The right code no longer works once the attempts are spent.
    expect(await stub.verify("hash-1")).toBe(false);
  });

  it("refuses a resend inside the cooldown and allows one after it", async () => {
    const stub = fresh();
    expect(await request(stub, "hash-1")).toBe("ok");
    const retried = await request(stub, "hash-2");
    expect(retried).toContain("刚刚发送过");

    // Move the deadline so the cooldown has passed while the staged code is still live.
    await age(stub, EMAIL_OTP_TTL_MS - EMAIL_OTP_RESEND_COOLDOWN_MS - 1);
    expect(await request(stub, "hash-2")).toBe("ok");
    // The newer code is the only live one.
    expect(await stub.verify("hash-1")).toBe(false);
    expect(await stub.verify("hash-2")).toBe(true);
  });

  it("refuses an expired code even if the alarm has not fired", async () => {
    const stub = fresh();
    await request(stub, "hash-1");
    await age(stub, -1);
    expect(await stub.verify("hash-1")).toBe(false);
  });

  it("wipes the code from the alarm", async () => {
    const stub = fresh();
    await request(stub, "hash-1");
    await runInDurableObject(stub, (instance: EmailOtp) => instance.alarm());
    expect(await stub.verify("hash-1")).toBe(false);
    await runInDurableObject(stub, async (instance: EmailOtp) => {
      expect([...instance.ctx.storage.kv.list()]).toEqual([]);
    });
  });

  it("throttles a client to a fixed number of requests per window", async () => {
    const stub = fresh();
    const throttle = (now: number) => runInDurableObject(stub, async (instance: EmailOtp) => {
      try {
        await instance.throttle(now);
        return "ok";
      } catch (err) {
        return `error:${(err as Error).message}`;
      }
    });
    const start = Date.now();
    for (let i = 0; i < EMAIL_OTP_IP_LIMIT; i++) expect(await throttle(start)).toBe("ok");
    expect(await throttle(start + 1)).toContain("过于频繁");
    // A new window starts afresh.
    expect(await throttle(start + EMAIL_OTP_IP_WINDOW_MS)).toBe("ok");
  });

  it("stores only the hash it is given", async () => {
    const stub = fresh();
    await request(stub, "hash-1");
    await runInDurableObject(stub, async (instance: EmailOtp) => {
      expect(JSON.stringify([...instance.ctx.storage.kv.list()])).toContain("hash-1");
    });
  });
});
