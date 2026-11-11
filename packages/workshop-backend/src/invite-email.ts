// The workspace invitation email: the one notification an owner or collaborator's direct grant
// sends. Upstream sharing has no in-product notification on purpose (docs/sharing.md: the sharer
// is expected to send the link out of band); this email is our deliberate extension, and it never
// changes the permission model -- opening the emailed link is still what creates the listing.

import { escapeHtml, publicBaseUrl, sendEmail } from "./email";

export type WorkspaceInvite = {
  /** The invitee's account email (profile.id of a user account). */
  to: string;
  /** The inviting user's display name. */
  inviterName: string;
  workspaceTitle: string;
  workspaceId: string;
};

/**
 * Send the invitation for a first-time collaborator. Returns false when email is not configured
 * or the provider refuses it; the invitation itself has already landed by then.
 */
export async function sendWorkspaceInviteEmail(
    env: Cloudflare.Env, invite: WorkspaceInvite): Promise<boolean> {
  let base = publicBaseUrl(env);
  if (!base) return false;
  let url = new URL(`/workspace/${invite.workspaceId}`, base).toString();
  let inviter = escapeHtml(invite.inviterName);
  let title = escapeHtml(invite.workspaceTitle);
  let text = [
    `${invite.inviterName} 邀请你协作工作区「${invite.workspaceTitle}」。`,
    "",
    `打开工作区：${url}`,
    "",
    "用收到邀请的账号登录后打开链接，工作区就会出现在你的工作区列表里。",
    "如果这不是你认识的邀请人，可以忽略这封邮件。",
  ].join("\n");
  let html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;` +
      `max-width:480px;margin:0 auto;padding:32px 24px;color:#14110f">` +
      `<h1 style="font-size:18px;line-height:26px;margin:0 0 16px">${inviter} 邀请你协作「${title}」</h1>` +
      `<p style="font-size:14px;line-height:22px;margin:0 0 24px;color:#525256">` +
      `用收到邀请的账号登录后打开下面的链接，工作区就会出现在你的工作区列表里。</p>` +
      `<a href="${escapeHtml(url)}" style="display:inline-block;background:#d97706;color:#fff;` +
      `text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">` +
      `打开工作区</a>` +
      `<p style="font-size:12px;line-height:18px;margin:24px 0 0;color:#8a8a8e">` +
      `如果这不是你认识的邀请人，可以忽略这封邮件。</p></div>`;
  return sendEmail(env, {
    to: invite.to,
    subject: `${invite.inviterName} 邀请你协作「${invite.workspaceTitle}」`,
    text,
    html,
  });
}
