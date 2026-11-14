// One email address's pending login code. An instance per normalized email; the code itself is
// never stored, only its hash. A code lives for ten minutes, a resend waits a minute after the
// previous send, and five wrong guesses retire it -- after which a new code must be requested.

import { DurableObject } from "cloudflare:workers";

const CODE_KEY = "code";
/** How long a code stays usable. */
export const EMAIL_OTP_TTL_MS = 10 * 60 * 1000;
/** How long after a send the same address must wait before another. */
export const EMAIL_OTP_RESEND_COOLDOWN_MS = 60 * 1000;
/** Wrong guesses allowed before the code is retired. */
export const EMAIL_OTP_MAX_ATTEMPTS = 5;

const THROTTLE_KEY = "throttle";
/** Codes one client IP may request per window, across every address it asks for. */
export const EMAIL_OTP_IP_LIMIT = 10;
/** The window EMAIL_OTP_IP_LIMIT counts over. */
export const EMAIL_OTP_IP_WINDOW_MS = 60 * 60 * 1000;

type OtpRecord = {
  codeHash: string;
  expiresAt: number;
  attempts: number;
};

type ThrottleRecord = {
  windowStart: number;
  count: number;
};

/** The instance name that throttles one client IP, kept apart from the per-email names. */
export function emailOtpIpThrottleName(ip: string): string {
  return `ip:${ip}`;
}

export class EmailOtp extends DurableObject<Cloudflare.Env> {
  /**
   * Count one request against a fixed window on an instance named by emailOtpIpThrottleName().
   * Throws once the window's limit is spent, so a single client cannot spray codes at many inboxes.
   */
  async throttle(now: number = Date.now()): Promise<void> {
    let record = this.ctx.storage.kv.get<ThrottleRecord>(THROTTLE_KEY);
    if (!record || now - record.windowStart >= EMAIL_OTP_IP_WINDOW_MS) {
      record = { windowStart: now, count: 0 };
    }
    if (record.count >= EMAIL_OTP_IP_LIMIT) {
      throw new Error("请求验证码过于频繁，请稍后再试。");
    }
    record.count += 1;
    this.ctx.storage.kv.put(THROTTLE_KEY, record);
    await this.ctx.storage.setAlarm(record.windowStart + EMAIL_OTP_IP_WINDOW_MS);
  }

  /**
   * Stage a freshly minted code for this address. Throws while the previous send is still in its
   * resend cooldown, so an endpoint cannot be used to flood one inbox.
   */
  async request(codeHash: string): Promise<void> {
    let now = Date.now();
    let record = this.ctx.storage.kv.get<OtpRecord>(CODE_KEY);
    if (record) {
      let sentAt = record.expiresAt - EMAIL_OTP_TTL_MS;
      if (now < sentAt + EMAIL_OTP_RESEND_COOLDOWN_MS) {
        throw new Error("验证码刚刚发送过，请稍后再试。");
      }
    }
    this.ctx.storage.kv.put<OtpRecord>(CODE_KEY, {
      codeHash,
      expiresAt: now + EMAIL_OTP_TTL_MS,
      attempts: 0,
    });
    await this.ctx.storage.setAlarm(now + EMAIL_OTP_TTL_MS);
  }

  /**
   * Spend one attempt against the staged code: true when it matches and was live, in which case it
   * is consumed. A wrong guess that exhausts the attempts retires the code too.
   */
  async verify(codeHash: string): Promise<boolean> {
    let record = this.ctx.storage.kv.get<OtpRecord>(CODE_KEY);
    if (!record || Date.now() >= record.expiresAt) {
      await this.#clear();
      return false;
    }
    if (record.attempts >= EMAIL_OTP_MAX_ATTEMPTS) {
      await this.#clear();
      return false;
    }
    if (record.codeHash !== codeHash) {
      record.attempts += 1;
      this.ctx.storage.kv.put(CODE_KEY, record);
      if (record.attempts >= EMAIL_OTP_MAX_ATTEMPTS) await this.#clear();
      return false;
    }
    await this.#clear();
    return true;
  }

  async #clear(): Promise<void> {
    this.ctx.storage.kv.delete(CODE_KEY);
    await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    this.ctx.storage.kv.delete(CODE_KEY);
    this.ctx.storage.kv.delete(THROTTLE_KEY);
  }
}
