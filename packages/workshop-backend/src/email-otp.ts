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

type OtpRecord = {
  codeHash: string;
  expiresAt: number;
  attempts: number;
};

export class EmailOtp extends DurableObject<Cloudflare.Env> {
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
  }
}
