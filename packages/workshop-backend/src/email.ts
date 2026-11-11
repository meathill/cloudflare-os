// Transactional email through Cloudflare Email Sending (the INVITE_EMAIL binding). Deployments
// without the binding, or without a public origin to build links and a sender from, simply send
// nothing: every caller's own work must succeed whether or not email is configured.

import { createWorkshopLogger } from "./observability";

const logger = createWorkshopLogger("workshop.email");

export type TransactionalEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/** The deployment's public origin, or undefined when PUBLIC_BASE_URL is unset or invalid. */
export function publicBaseUrl(env: Cloudflare.Env): URL | undefined {
  if (!env.PUBLIC_BASE_URL) return undefined;
  try {
    return new URL(env.PUBLIC_BASE_URL);
  } catch {
    return undefined;
  }
}

/** The product's verified sending address; other deployments override with INVITE_EMAIL_FROM. */
const DEFAULT_FROM = "no-reply@xiaoniaoshuo.com";

/** The address a deployment sends from: INVITE_EMAIL_FROM when set, else the product's own. */
function senderAddress(env: Cloudflare.Env): string {
  return env.INVITE_EMAIL_FROM || DEFAULT_FROM;
}

/** Whether this deployment can send email at all (the Email Sending binding is configured). */
export function emailEnabled(env: Cloudflare.Env): boolean {
  return Boolean(env.INVITE_EMAIL);
}

/**
 * Send one transactional email. Returns false when email is not configured or the provider
 * refuses the message; never throws, so a caller's own work is not failed by email.
 */
export async function sendEmail(
    env: Cloudflare.Env, message: TransactionalEmail): Promise<boolean> {
  if (!env.INVITE_EMAIL) return false;
  try {
    await env.INVITE_EMAIL.send({
      to: message.to,
      from: senderAddress(env),
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return true;
  } catch (error) {
    // Never log the recipient, subject or body: invitations and codes are private to the user.
    logger.warn("failed to send email", { event: "email.send.failed", error });
    return false;
  }
}

/** Escape a value interpolated into the email HTML. */
export function escapeHtml(text: string): string {
  return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
}
