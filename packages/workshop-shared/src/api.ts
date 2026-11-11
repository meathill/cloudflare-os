// This file defines the API spoken between the Gadgets Workshop service and the front-end UI.
//
// The UI is a good old "fat client" SPA. Why not use SSR? Because:
// - Users of this UI are likely to have it open often, maybe even all the time. Startup time is
//   less of a concern than with sites you visit only briefly, and assets are likely to be in cache
//   in any case.
// - The Gadgets themselves are sandboxed on the client side in addition to the server side. This
//   sandboxing requires running code in the browser. It is not plausible to server-side render
//   a Gadget itself.
// - By providing a really clean API boundary between client and server, we make it easier to build
//   alternative clients.
// - SPA is just easier to think about.
//
// The entire API between the client and server is an RPC API, using Cloudflare's JavaScript RPC,
// which essentially allows natural JavaScript / TypeScript interfaces to be exposed over the
// network.
//
// The RPC interface operates over a WebSocket, which the client starts immediately at startup and
// keeps open for the entire lifetime of the session, reconnecting if needed.
//
// Gadgets run inside a sandboxed iframe which has no ability to talk to the outside world at all,
// except postMessage() to the parent frame. Through postMessage() exchanges, the Gadget can speak
// RPC to the Workshop. Among other things, through this interface, the Workshop provides the
// Gadget a stub pointing to the Gadget's server-side Durable Object interface.

import { RpcCompatible, RpcStub, RpcTarget } from "capnweb";
import { AccountDescription, ActionKind, ActionDescription, AgentCatalog, AvatarImage, GatekeeperUiFrame, GatekeeperUserSelection, ObservationDescription, ResourceDescription, ResourceConfiguratorFrame, SupportedResource, VendorDescription, HookDescription } from "./gatekeeper.js";
import type { BytesRef, CodeChange } from "./code-change.js";
import type { GitOid } from "./gatekeeper.js";
import type { UiFeatureFlags } from "./feature-flags.js";

export const SERVICE_SALT = new Uint8Array([
  0xd9, 0x4e, 0x54, 0x1d, 0x29, 0xc1, 0x03, 0x74, 0x73, 0x7e, 0xb3, 0xe3, 0x34, 0x6d, 0x8f, 0x21
]);

/**
 * How a connect, reconnect, ensure-resources or sign-in flow starts, as returned by
 * `AuthenticatedApi.connectAccount()` and its siblings. `url` is the gatekeeper's flow URL, which
 * the Workshop opens as a disowned popup. `nonce` is a 64-lowercase-hex secret minted for this
 * flow, which the Workshop writes into that popup's own sessionStorage before navigating it and
 * nowhere else: sessionStorage is per top-level browsing context and per origin, so it survives the
 * trip through the gatekeeper and the provider and is readable again once the popup is back on the
 * Workshop's origin. When the flow finishes, the popup lands on the Workshop's /connect/handoff
 * page, which presents the ticket from its URL fragment together with the nonce
 * (`AuthenticatedApi.completeConnectHandoff()` / `PublicApi.confirmLogin()`). A handoff page opened
 * any other way holds no nonce and redeems nothing. The nonce is single-use and dies with the flow:
 * a connect's after CONNECT_FLOW_LIFETIME_MS (30 minutes, server-side), a sign-in's with its
 * `PendingLogin` attempt.
 */
export type ConnectFlowStart = { url: string; nonce: string };

/**
 * A pending gatekeeper sign-in attempt, returned by `PublicApi.startGatekeeperLogin()`. Holding this
 * stub is the capability to receive the resulting session token; dispose it to abandon the attempt.
 */
export interface LoginAttempt extends RpcTarget {
  /**
   * The session token (same format as `login()`; store it and pass it to `authenticate()`) once the
   * sign-in popup has confirmed the attempt's ticket via `PublicApi.confirmLogin()`; null until
   * then, so the caller polls. Throws with a user-facing message once the attempt has expired, the
   * gatekeeper reported a failure, or the token was already received. Holding this stub alone never
   * yields a token: the sign-in URL is a bearer capability, and only the popup this browser opened
   * holds the nonce that confirms it.
   */
  receive(): Promise<string | null>;
}

/** Public API exposed to the internet. */
export interface PublicApi extends RpcTarget {
  /** Confirms that the RPC connection can round-trip without performing application work. */
  ping(): Promise<void>;

  /**
   * Returns deployment-level configuration the client needs at boot (auth mode, available sign-in
   * vendors, whether the Cloudflare limits flow is enabled). Contains no secrets.
   */
  getServerConfig(): Promise<ServerConfig>;

  /**
   * Begin a sign-in via an authentication gatekeeper (e.g. "google", "github", "cloudflare").
   * Returns the `url` the client opens as a disowned popup, the `nonce` it writes into that popup's
   * sessionStorage before navigating it (see `ConnectFlowStart`), and an `attempt` stub the client
   * polls with `receive()` for the session token. When the flow finishes, the popup lands on the
   * Workshop's own /connect/handoff page, which calls `confirmLogin(ticket, nonce)`. The vendor must
   * be auth-capable and allowlisted (see ServerConfig.authVendors); throws otherwise.
   *
   * Dispose `attempt` to abandon the sign-in (e.g. the user closed the popup). Nothing is cancelled
   * server-side: the browser just stops polling, and an unreceived token expires on its own.
   */
  startGatekeeperLogin(vendorId: string): Promise<{ url: string; nonce: string; attempt: RpcStub<LoginAttempt> }>;

  /**
   * Confirm a finished sign-in flow. Called by the /connect/handoff page in the sign-in popup, which
   * has no session: `ticket` is the handoff ticket from the page's URL fragment and `nonce` the one
   * `startGatekeeperLogin()` returned for the same flow, read from the popup's own sessionStorage.
   * Marks the attempt's delivered result as confirmed, so that `LoginAttempt.receive()` releases the
   * token to whoever holds the attempt stub; the popup itself never sees a token. Throws with a
   * user-facing message when the attempt is unknown, expired, or failed, or the ticket is not the
   * attempt's.
   */
  confirmLogin(ticket: string, nonce: string): Promise<void>;

  /** Authenticates the user using an auth token (typically stored in localStorage). */
  authenticate(token: string): Promise<AuthenticatedApi>;

  /**
   * Like authenticate() but the server is expected to be sitting behind Cloudflare Access, and the
   * client is expected to have already authenticated with Access (before they could load the
   * application in their browser at all). The credentials from the Cloudflare Access session will
   * be used to authenticate the user.
   */
  authenticateFromCfAccess(): Promise<AuthenticatedApi>;

  /**
   * Login with username and password.
   *
   * Returns a token to store in local storage and pass to `authenticate()` in the future.
   *
   * Returns null if login failed (no such user or wrong password).
   *
   * `passwordHash` is derived from the user's password as follows:
   *
   *     argon2id({
   *       password,
   *       salt: SERVICE_SALT + encode(username, 'utf8'),
   *       parallelism: 1,
   *       iterations: 3,
   *       memorySize: 64MiB,
   *       hashLength: 32,
   *     });
   *
   * Note that the `passwordHash` itself is NOT stored plaintext by the server -- additional
   * hashing is performed server-side. The overall scheme achieves roughly the same security
   * guarantees as traditional server-side password hashing, but with the added benefit that the
   * server never sees the user's password at all, and also the benefit of performing the expensive
   * hash on the client which tends to have more resources available than a busy server.
   *
   * This API may be disabled when the server uses SSO for authentication.
   */
  login(username: string, passwordHash: Uint8Array): Promise<string | null>;

  /**
   * Create a new account. Returns a token to store in local storage and pass to `authenticate()`
   * in the future.
   *
   * Returns null if the username already exists. (Other kinds of errors may throw exceptions.)
   *
   * See login() (above) for an explanation of the password hashing algorithm.
   *
   * This API may be disabled when the server uses SSO for authentication.
   */
  createAccount(username: string, displayName: string, passwordHash: Uint8Array)
      : Promise<string | null>;

  /**
   * Fetch blueprint metadata by ID, whose current release says if an update is available. A gadget
   * following the blueprint has one when that release differs from the release it last took (see
   * GadgetUpstream). Returns null if the blueprint doesn't exist. No authentication required
   * (knowing the ID is sufficient, since a blueprint is "just data").
   */
  getBlueprint(id: string): Promise<BlueprintPublicInfo | null>;

  /**
   * Export a blueprint: download it as a `.gadget` archive stream. Another Workshop instance takes
   * the archive in with AuthenticatedApi.importBlueprint(). It contains only BlueprintMetadata plus
   * the current blueprint code snapshot, not the full KV record.
   */
  downloadBlueprint(id: string): Promise<ReadableStream<Uint8Array>>;
}

/** Subscription callback for AuthenticatedApi.subscribeConnectedAccounts(). */
export interface ConnectedAccountsSubscriber {
  /**
   * If `credentialsValid` is false, the account's credentials are known to be expired, and the
   * UI should call reconnectAccount() to fix this if the user tries to select this account.
   */
  add(id: number, description: AccountDescription, vendor: VendorDescription,
      supportedResources: SupportedResource[], credentialsValid: boolean, vendorId: string): void;
  remove(id: number): void;

  /** Called after add() has been called for all accounts known so far. */
  ready(): void;
}

/** A notification delivered to one authenticated user. */
export type UserNotification = {
  /** Stable identifier shared by the live and push delivery attempts. */
  id: string;

  /** Whether the task finished or is paused on a connection or action-approval prompt. */
  kind: "taskCompleted" | "permissionRequested";

  /** Workspace containing the task. */
  workspaceId: string;

  /** Chat containing the task. */
  chatId: number;

  /** Current human-readable chat title. */
  chatTitle: string;
};

/** A browser's Web Push subscription: the endpoint its push service issued, and the keys that encrypt pushes to it. */
export type WebPushSubscription = {
  /** Push service URL the browser issued for this subscription. */
  endpoint: string;
  /** The browser's encryption keys, base64url-encoded as `PushSubscription.toJSON()` returns them. */
  keys: { p256dh: string; auth: string };
};

/** How long a workspace's notifications stay muted: until a time, or until the user unmutes it. */
export type NotificationMute = { until: Date, indefinite?: never } | { indefinite: true, until?: never };

/** Callback used by `AuthenticatedApi.subscribeToNotifications()`. */
export interface NotificationSubscriber extends RpcTarget {
  /**
   * Present a notification to the active user. Resolve only once the user has seen it, or is
   * already viewing its chat; if no subscriber resolves promptly, the backend falls back to push to
   * the user's registered devices and browsers.
   */
  notify(notification: UserNotification): Promise<void>;
}

// Unread tracking
//
// Every user has their own private read position in each chat; other users never see it. Unread
// counts include only "visible" messages, meaning chat messages with text or attachments, from a
// person or the agent. Tool calls, reasoning-only records, slash-command expansions and other
// internal activity are never counted.
//
// Read positions are timeline sequence numbers (the same numbers as `AiChatMessage.sequence`), so
// a client can pass the sequence of a message it is displaying. Messages written before unread
// tracking was introduced always count as read.
//
// Unread state is tracked only for workspaces the user owns or can build in, not for use-only
// workspaces. It is stored with the user's account and kept up to date by each workspace as
// messages arrive. So the unread queries and subscriptions on `AuthenticatedApi` are cheap and
// never need to open a workspace. Marking a single chat read or unread goes through that
// workspace's `Overseer` session (`markChatRead()` / `markChatUnread()`), because only the
// workspace can turn a sequence number into a count of visible messages. See
// docs/user-unread-state.md for the full design.

/** The current user's read state for one chat. */
export type ChatReadState = {
  /** Workspace containing the chat. */
  workspaceId: string;
  /** The chat's ID within its workspace. */
  chatId: number;
  /** Visible messages the user hasn't read, including in muted chats. Zero means fully read once catch-up completes. */
  unreadMessageCount: number;
  /**
   * Sequence of the last timeline record the user has read, inclusive: any visible messages after
   * it are unread. -1 means the user hasn't read anything in this chat yet. Use this, for example,
   * to place a "new messages" divider, once `readStatePending` clears.
   */
  readThroughSequence: number;
  /**
   * True while initial enrollment catch-up is pending. Preferences and one-off approvals can
   * create a row before ordinary updates are enrolled. Wait for catch-up before acknowledging
   * the viewport. Absent after catch-up, an explicit read command, and on older servers.
   */
  readStatePending?: true;
  /**
   * Whether this chat appears in the unread inbox and contributes badges and completion alerts
   * for this user. Approval alerts bypass the default-off state, but honor an explicit mute.
   * Absent on older servers.
   */
  notificationsEnabled?: boolean;
  /**
   * The user's explicit notification preference. Absent when using the participation default,
   * or on older servers. A false override suppresses approval alerts as well as completion alerts.
   */
  notificationsEnabledOverride?: boolean;
};

/**
 * What a chat's most recent visible message looks like, used to display the chat in a list such as
 * the unread inbox. It's the same for every user, regardless of what they've read.
 */
export type ChatTimelineHead = {
  /** The chat's current title. */
  chatTitle: string;
  /** Sequence of the chat's latest visible message, or -1 if the chat has none. */
  latestSequence: number;
  /**
   * Snippet of the latest visible message: its first line of text, cut off at 240 characters
   * ("Attachment" if the message only has attachments). Empty if the chat has no visible messages.
   * Absent when the server is older than this field.
   */
  latestMessagePreview?: string;
  /**
   * When the latest visible message was sent. Absent if the chat has no visible messages, or when
   * the server is older than this field.
   */
  latestActivityAt?: Date;
};

/**
 * One row of the user's unread inbox: a chat with notifications enabled and unread messages,
 * plus what's needed to display it.
 * Returned by `AuthenticatedApi.getUnreadThreads()`.
 */
export interface UnreadThread extends ChatReadState, ChatTimelineHead {}

/** Unread totals excluding muted chats, e.g. for a badge next to a workspace. */
export type WorkspaceUnreadSummary = {
  /** The workspace these totals are for. */
  workspaceId: string;
  /** Number of unmuted chats in the workspace with at least one unread message. */
  unreadChatCount: number;
  /** Total unread messages in the workspace's unmuted chats. */
  unreadMessageCount: number;
};

/** Unread badge totals excluding muted chats: overall and per workspace, without per-chat details. */
export type UserUnreadSummary = {
  /** Number of unmuted chats with unread messages across all of the user's workspaces. */
  unreadChatCount: number;
  /** Total unread messages in unmuted chats across all of the user's workspaces. */
  unreadMessageCount: number;
  /**
   * Totals for each workspace with unread messages in unmuted chats. Workspaces with only muted
   * unread chats or no unread messages are left out.
   */
  workspaces: WorkspaceUnreadSummary[];
};

/**
 * Updated unread totals, sent to live subscribers when something changes. To keep updates small,
 * this has the new overall totals but only the one workspace whose totals changed, not all of them.
 */
export type UnreadSummaryUpdate = {
  /** Number of unmuted chats with unread messages across all of the user's workspaces. */
  unreadChatCount: number;
  /** Total unread messages in unmuted chats across all of the user's workspaces. */
  unreadMessageCount: number;
  /**
   * New totals for the workspace that changed; replace your copy of that workspace's totals with
   * these. Zero counts mean there are no unread messages in unmuted chats; drop the workspace
   * from your `UserUnreadSummary.workspaces` list.
   */
  workspace: WorkspaceUnreadSummary;
};

/**
 * Which chats an `AuthenticatedApi.subscribeToUnreadState()` subscription receives per-chat
 * updates for. Every scope receives the overall and per-workspace totals. The scope only controls
 * which chat rows are sent:
 * - `"summary"`: no chats, only totals (e.g. for badges).
 * - `"unread"`: chats with unread messages and notifications enabled (e.g. for the unread inbox).
 * - `{workspaceId}`: the chats in one workspace, read or unread (e.g. for that workspace's chat
 *   list).
 */
export type UnreadStateScope = "summary" | "unread" | {
  /** The workspace whose chats to send. */
  workspaceId: string;
};

/** A full snapshot for an unread-state subscription: the totals, plus the chats its scope asks for. */
export interface UserUnreadState extends UserUnreadSummary {
  /**
   * The chats in the subscription's scope (see `UnreadStateScope`): none for `"summary"`, chats
   * with unread messages for `"unread"`, or one workspace's chats for a workspace scope. Chats in
   * that workspace that aren't listed have nothing unread.
   */
  chats: ChatReadState[];
}

/** Callback used by `AuthenticatedApi.subscribeToUnreadState()`. */
export interface UnreadStateSubscriber extends RpcTarget {
  /**
   * Replace everything you have with this full snapshot. Called once right after subscribing, and
   * again after changes that affect many chats at once (such as "mark all read", or losing access
   * to a workspace).
   */
  updated(state: UserUnreadState): Promise<void>;
  /**
   * The totals changed because of a chat outside this subscription's scope. Apply the new totals;
   * no chat rows are affected.
   */
  summaryUpdated(summary: UnreadSummaryUpdate): Promise<void>;
  /**
   * One chat in this subscription's scope changed. Replace your row for it with `chat`, or remove
   * the row if `chat` is null (the chat was deleted, or, for the `"unread"` scope, it's now fully
   * read). `summary` has the updated totals, just like `summaryUpdated()`.
   */
  chatUpdated(workspaceId: string, chatId: number, chat: ChatReadState | null,
    summary: UnreadSummaryUpdate): Promise<void>;
}

/**
 * When listing gatekeeper vendors or connected accounts, you can filter to only vendors/accounts
 * that support certain features. This type specifies the filter.
 */
export type GatekeeperVendorFilter = {
  /** Filter for vendors that can connect to the given resource. */
  resourceUrl?: string,
};

/** Options for subscribing to connected accounts. */
export type ConnectedAccountsFilter = GatekeeperVendorFilter & {
  /** Ensure and include auto-provisioned accounts forced by deployment policy. */
  includeForcedAutoProvisionedAccounts?: boolean;
};

/**
 * Identifies a workpiece within a workspace. A workpiece is a numbered thing the user (or agent)
 * is working on inside the workspace -- currently a gadget or a gatekeeper (connection), with
 * more types expected later. All workpiece types share one sequential per-workspace ID namespace,
 * so a bare number unambiguously identifies a workpiece of any type, and derived names (facet
 * names) can never collide across types.
 */
export type WorkpieceId = number;

// Matches an ASCII JavaScript identifier, excluding `$`. Deliberately conservative: binding
// names are typed by agents and rendered as `env.NAME`, so full Unicode identifier support buys
// nothing; and while `$` is technically legal in identifiers, it is conventionally reserved for
// special circumstances like code generators, so agents shouldn't be using it.
const IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ECMAScript reserved words (including strict-mode reservations and literals), which are valid
// per IDENTIFIER_REGEX but cannot follow `.` in all contexts and would confuse both agents and
// humans as binding names.
const RESERVED_WORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
  "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "import",
  "in", "instanceof", "new", "null", "return", "super", "switch", "this", "throw", "true", "try",
  "typeof", "var", "void", "while", "with",
  // Strict-mode / contextual reservations.
  "await", "implements", "interface", "let", "package", "private", "protected", "public",
  "static", "yield",
]);

/**
 * Validates a binding name, throwing a descriptive Error if it is unacceptable. This is the one
 * shared validator applied at every chokepoint that writes a binding name (gadget binding edges,
 * the workspace default binding list, chat binding maps, spawner env configs, and the agent
 * tools), wherever the map is keyed.
 *
 * A valid name is a JavaScript identifier (see IDENTIFIER_REGEX; reserved words excluded) that is
 * not a dangerous or confusing property name: anything that exists on `Object.prototype`
 * (`__proto__`, `constructor`, `hasOwnProperty`, `toString`, etc.) or `prototype` is rejected,
 * since binding maps are used as plain objects where such names would collide with inherited
 * members -- or worse, mutate the prototype chain.
 *
 * ALL_CAPS_WITH_UNDERSCORES is style guidance only (recommended in tool descriptions and used by
 * generated names), not enforced here.
 */
export function validateBindingName(name: string): void {
  if (!IDENTIFIER_REGEX.test(name)) {
    throw new Error(
        `Invalid binding name "${name}": binding names must be JavaScript identifiers ` +
        `(letters, digits, and '_', not starting with a digit).`);
  }
  if (RESERVED_WORDS.has(name)) {
    throw new Error(`Invalid binding name "${name}": this is a reserved word in JavaScript.`);
  }
  if (name === "prototype" || name in Object.prototype) {
    throw new Error(
        `Invalid binding name "${name}": this name collides with a built-in object property.`);
  }
}

/**
 * Throws unless `email` is acceptable as `AiChatAuthorInfo.commitEmail`: `local@domain`, at most
 * 254 characters, with no whitespace, control characters, or angle brackets. This is not full
 * address validation; it exists so the value cannot break out of a git `Name <email>` header.
 */
export function validateCommitEmail(email: string): void {
  if (email.length > 254 || !/^[^\p{Cc}\s<>@]+@[^\p{Cc}\s<>@]+$/u.test(email)) {
    throw new Error(`Invalid commit email: expected an address like name@example.com.`);
  }
}

/**
 * Why a previously-configured observer binding failed verification on this open attempt. Attached to
 * the ObserverBindingNeed the overseer re-prompts with, so the client can explain what went wrong
 * instead of dead-ending the open.
 */
export type ObserverBindingFailure = {
  /**
   * The account that was tried and rejected (a ConnectedAccountRecord id in the opening user's own
   * User DO). Re-authenticating it in place is usually the fix, so the client should pre-select it
   * and aim its re-authenticate affordance at it. May no longer exist, if the user disconnected it.
   */
  accountId: number;
  /**
   * Human-readable explanation for display: either the error the gatekeeper threw when it refused
   * the account, or a message the overseer authored itself for a cause it can see directly (e.g.
   * the chosen account is no longer connected). Free text: MUST NOT be parsed or matched on.
   */
  reason: string;
};

/**
 * Describes one connection a non-owner must verify using one of their own accounts. Passed to
 * ObserverConfigCallback.configure() when the opening user needs to choose an account; its result
 * echoes `gatekeeperId` in an ObserverAccountChoice.
 */
export type ObserverBindingNeed = {
  /** The overseer-assigned gatekeeper id (a workpiece id). */
  gatekeeperId: WorkpieceId;
  /**
   * The vendor the user must have a connected account for (e.g. "google"). The frontend filters
   * the user's connected accounts by this to find candidates.
   */
  vendorId: string;
  /** Human-readable resource title, for display in the configuration modal. */
  resourceTitle: string;
  /** Canonical resource URL, if known, for display. */
  resourceUrl?: string;
  /** Stable vendor-scoped type ID from the binding; authoritative over URL-based scope selection. */
  resourceTypeId?: string;
  /**
   * Set only when this binding was already configured but its chosen account failed verification on
   * this attempt (expired credentials, a revoked grant, an upstream outage, or a genuine denial).
   * Absent for a binding that has simply never been configured. Deliberately carries no
   * "credentials valid" flag: the client already has that live from subscribeConnectedAccounts, and
   * a copy on the wire would go stale while the modal is open across an OAuth round trip.
   */
  failure?: ObserverBindingFailure;
};

/**
 * The opening user's chosen account for a single gatekeeper binding. Returned from
 * ObserverConfigCallback.configure().
 */
export type ObserverAccountChoice = {
  /** Matches the ObserverBindingNeed.gatekeeperId being satisfied. */
  gatekeeperId: WorkpieceId;
  /** An account in the opening user's own User DO (a ConnectedAccountRecord id). */
  accountId: number;
};

/**
 * Provided by the client when opening a workspace, or a gadget within it (see
 * Overseer.getGadget()). Invoked by the overseer ONLY if the user must choose connected accounts
 * for one or more gatekeeper bindings before they can observe what they are opening. In the common
 * case (owner, or an already-configured observer) this is never called and the open resolves
 * without an extra round trip. The overseer does not resolve the open until this returns. If the
 * user cannot or will not provide the needed accounts, the callback should reject, and the
 * overseer denies the open.
 *
 * `configure()` may be called a second time within one open, for the subset of bindings that failed
 * verification (each carrying an ObserverBindingNeed.failure). This lets the user repair a binding --
 * typically by re-authenticating the account whose credentials expired -- without leaving the flow.
 * The overseer bounds the number of such re-prompts, so a client that resubmits an account that
 * keeps failing eventually gets a denial rather than an endless loop.
 */
export interface ObserverConfigCallback extends RpcTarget {
  configure(needs: ObserverBindingNeed[]): Promise<ObserverAccountChoice[]>;
}

/** Builds the create/read helpers for a family of expected errors carrying stable
 * machine-readable codes. The per-code messages double as the classification fallback for errors
 * from older deployments that lost the code in transit, so changing one is a compatibility break. */
function codedErrorFamily<Code extends string>(messages: Record<Code, string>) {
  const codes = new Set<unknown>(Object.keys(messages));
  return {
    create: (code: Code): Error & { code: Code } =>
        Object.assign(new Error(messages[code]), { code }),
    getCode: (error: unknown): Code | undefined => {
      const candidate = typeof error === "object" && error !== null && "code" in error
          ? error.code : undefined;
      return codes.has(candidate) ? candidate as Code : undefined;
    },
  };
}

/** Stable error codes attached to expected failures from `AuthenticatedApi.openWorkspace()`. */
export const OPEN_WORKSPACE_ERROR_CODES = {
  workspaceNotFound: "WORKSPACE_NOT_FOUND",
  workspaceAccessDenied: "WORKSPACE_ACCESS_DENIED",
  shareLinksDisabled: "SHARE_LINKS_DISABLED",
} as const;

/** An expected failure code from `AuthenticatedApi.openWorkspace()`. */
export type OpenWorkspaceErrorCode =
    typeof OPEN_WORKSPACE_ERROR_CODES[keyof typeof OPEN_WORKSPACE_ERROR_CODES];

const openWorkspaceErrors = codedErrorFamily<OpenWorkspaceErrorCode>({
  [OPEN_WORKSPACE_ERROR_CODES.workspaceNotFound]: "Workspace not found.",
  [OPEN_WORKSPACE_ERROR_CODES.workspaceAccessDenied]: "You don't have access to this workspace.",
  [OPEN_WORKSPACE_ERROR_CODES.shareLinksDisabled]:
      "Share links are disabled for this workspace because it contains sensitive data. " +
      "The owner must add each person directly.",
});

/** Creates an expected `openWorkspace()` error with a machine-readable code. */
export const createOpenWorkspaceError = openWorkspaceErrors.create;

/** Reads the machine-readable code from an expected `openWorkspace()` error. */
export const getOpenWorkspaceErrorCode = openWorkspaceErrors.getCode;

/** Stable error codes attached to authentication failures. */
export const AUTH_ERROR_CODES = {
  invalidSessionToken: "INVALID_SESSION_TOKEN",
  notAuthenticatedWithAccess: "NOT_AUTHENTICATED_WITH_ACCESS",
} as const;

/** An expected authentication failure code. */
export type AuthErrorCode = typeof AUTH_ERROR_CODES[keyof typeof AUTH_ERROR_CODES];

/** Messages for auth failures thrown without a surviving code; clients match these only as a
 * classification fallback. */
export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  [AUTH_ERROR_CODES.invalidSessionToken]: "invalid session token",
  [AUTH_ERROR_CODES.notAuthenticatedWithAccess]: "Not authenticated with Access.",
};

const authErrors = codedErrorFamily(AUTH_ERROR_MESSAGES);

/** Creates an authentication failure with a machine-readable code. */
export const createAuthError = authErrors.create;

/** Reads the machine-readable code from an authentication failure. */
export const getAuthErrorCode = authErrors.getCode;

/** Stable error codes attached to expected refusals to use a gatekeeper (connection). */
export const GATEKEEPER_ERROR_CODES = {
  /** Blocked until a scheduled workspace restart lands (e.g. after adding or binding it); the same
   * call on the replacement session succeeds. */
  pendingRestart: "GATEKEEPER_PENDING_RESTART",
} as const;

const gatekeeperErrors = codedErrorFamily({
  [GATEKEEPER_ERROR_CODES.pendingRestart]:
      "The workspace is restarting to apply a connection change. Please retry.",
});

/** Creates a gatekeeper refusal with a machine-readable code. */
export const createGatekeeperError = gatekeeperErrors.create;

/** Reads the machine-readable code from a gatekeeper refusal. */
export const getGatekeeperErrorCode = gatekeeperErrors.getCode;

/**
 * Stable error codes attached to expected refusals of AdminApi.inspectWorkspace() and
 * AdminApi.inspectUser(), and of AdminWorkspaceView and AdminUserView calls.
 */
export const ADMIN_ACCESS_ERROR_CODES = {
  workspaceNotFound: "ADMIN_WORKSPACE_NOT_FOUND",
  userNotFound: "ADMIN_USER_NOT_FOUND",
  accessOff: "ADMIN_WORKSPACE_ACCESS_OFF",
  viewExpired: "ADMIN_VIEW_EXPIRED",
  notAdmin: "ADMIN_NOT_ADMIN",
} as const;

/** An expected refusal code from ADMIN_ACCESS_ERROR_CODES. */
export type AdminAccessErrorCode =
    typeof ADMIN_ACCESS_ERROR_CODES[keyof typeof ADMIN_ACCESS_ERROR_CODES];

const adminAccessErrors = codedErrorFamily<AdminAccessErrorCode>({
  [ADMIN_ACCESS_ERROR_CODES.workspaceNotFound]: "Workspace not found.",
  [ADMIN_ACCESS_ERROR_CODES.userNotFound]: "User not found.",
  [ADMIN_ACCESS_ERROR_CODES.accessOff]:
      "Admin access to workspaces and users is turned off on this deployment.",
  [ADMIN_ACCESS_ERROR_CODES.viewExpired]: "This admin view has expired. Inspect again.",
  [ADMIN_ACCESS_ERROR_CODES.notAdmin]:
      "Only a deployment admin can inspect a workspace or a user.",
});

/** Creates an expected admin-access refusal with a machine-readable code. */
export const createAdminAccessError = adminAccessErrors.create;

/** Reads the machine-readable code from an expected admin-access refusal. */
export const getAdminAccessErrorCode = adminAccessErrors.getCode;

/**
 * The most characters of a display name or a workspace title the deployment directory keeps (see
 * AuthenticatedApi.searchUsers(), AdminApi.listUsers() and AdminApi.listWorkspaces()): it lists a
 * longer one as its first MAX_DIRECTORY_TEXT_LENGTH characters, since nothing else bounds either.
 * Ids are kept whole.
 */
export const MAX_DIRECTORY_TEXT_LENGTH = 1000;

/**
 * One user as listed in the deployment-wide user directory (see `AuthenticatedApi.searchUsers`
 * and `AdminApi.listUsers`).
 */
export type UserDirectoryRecord = {
  /**
   * Canonical user identifier: email for Access / sign-in accounts, username
   * for password accounts.
   */
  id: string;

  /** The user's current display name: its first MAX_DIRECTORY_TEXT_LENGTH characters when longer. */
  name: string;
};

/** Routing identity and one-use proof posted by the authenticated browser to redeem a transfer. */
export type DeviceSessionHandoffStart = {
  /** Durable Object identifier for the staging user; this value is not secret. */
  userDoId: string;
  /** Single-use 256-bit secret in lowercase hex; only its hash is stored server-side. */
  ticket: string;
};

/**
 * Top-level API exposed to the user after they have authenticated, from which they reach their
 * workspaces and the gadgets in them.
 */
export interface AuthenticatedApi extends RpcTarget {
  /** Get profile info for the user who is logged in. */
  whoami(): Promise<AiChatAuthorInfo>;

  /**
   * Stage a two-minute, single-use device-session transfer for a native app. The state is an
   * opaque 16–512 character URL-safe value and the key is an uncompressed P-256 public key encoded
   * as unpadded base64url. The encrypted credential remains server-side until the browser POSTs
   * the returned ticket to `/api/device-session/callback`, which redirects to the fixed, claimed
   * HTTPS app link. Repeating a live state reissues its ticket and invalidates the previous one.
   */
  beginDeviceSessionHandoff(publicKey: string, state: string)
    : Promise<DeviceSessionHandoffStart>;

  /** Set the user's own display name, seen in chats, etc. */
  setOwnDisplayName(name: string): Promise<void>;

  /**
   * Set the email address used on git commits the user authors, or clear it with null to fall
   * back to one derived from their user ID. Rejects an address `validateCommitEmail` refuses.
   */
  setOwnCommitEmail(email: string | null): Promise<void>;

  /**
   * Find other users of this deployment by a case-insensitive substring of
   * their display name or id, for inviting collaborators. Excludes the caller
   * and every user named by `excludeIds`. Returns at most 10 records, earliest
   * substring match first.
   *
   * Rejects a `query` longer than 1000 characters or containing a line break,
   * and more than 1000 distinct ids to exclude, the caller's own included.
   *
   * Returns no records while the admin has user search turned off
   * (`ServerConfig.userSearchEnabled`); inviting by exact username/email via
   * `Overseer.addCollaborator()` still works then.
   */
  searchUsers(query: string, excludeIds: string[]): Promise<UserDirectoryRecord[]>;

  /**
   * Change the user's password, if using password-based authentication.
   *
   * See `PublicApi.login()` for an explanation of the hashing algorithm.
   */
  changePassword(oldHash: Uint8Array, newHash: Uint8Array): Promise<void>;

  /**
   * Whether this account has a password set. False for accounts created via an OAuth provider, in
   * which case the change-password UI should be hidden.
   */
  hasPasswordLogin(): Promise<boolean>;

  /**
   * Register one of the user's devices for push: an older native app's one-time central device
   * registration, or this browser's Web Push subscription. Each registered device gets push; a
   * device that registers again replaces its own subscription. The deployment never receives an
   * APNs device token or Cloudflare account token. A browser's subscription passes through it to
   * the central notification service under this user's opaque installation-local identity; the
   * service delivers to an endpoint only for its most recent registration.
   */
  registerNotificationDevice(registration: string | WebPushSubscription): Promise<void>;

  /**
   * Claim a new native registration using this user's CFOS authorization, not legacy OAuth.
   * This is separate from `registerNotificationDevice()` because legacy and authorized native
   * registrations have the same opaque string shape; only the native protocol version identifies
   * which central exchange is valid.
   */
  registerAuthorizedNotificationDevice(deviceRegistrationId: string): Promise<void>;

  /**
   * Authorize native push enrollment as this CFOS user. The single-use central grant is bound to
   * this installation and user; it carries no provider token or Dashboard credential.
   */
  authorizeNotificationDevice(): Promise<string>;

  /**
   * Subscribe to live notifications while able to present them. Dispose the returned handle
   * while hidden or on logout so unavailable clients do not delay push. A client that becomes
   * unable to present an event must reject `notify()`. Receipt does not mark its chat read.
   */
  subscribeToNotifications(
      subscriber: RpcStub<NotificationSubscriber>): Promise<RpcStub<{}>>;

  /**
   * List the chats with notifications enabled and unread messages across the user's workspaces,
   * most recently active first: the unread inbox. Each row includes the chat's title and a preview of its latest message,
   * so the inbox can be shown without opening any workspace. See "Unread tracking" above
   * `ChatReadState`.
   */
  getUnreadThreads(): Promise<UnreadThread[]>;

  /**
   * Get the user's read state for the chats in one workspace, to combine with that workspace's own
   * chat list (e.g. to highlight unread chats). Chats that aren't returned have nothing unread.
   */
  getWorkspaceUnreadState(workspaceId: string): Promise<ChatReadState[]>;

  /** Get the user's unread totals, overall and per workspace, for badges. */
  getUnreadSummary(): Promise<UserUnreadSummary>;

  /**
   * Subscribe to live unread-state changes. `scope` picks which chats to get per-chat updates for
   * (see `UnreadStateScope`). Totals are always included. Use the narrowest scope the current view
   * needs: `"summary"` for badges, `"unread"` for the inbox, or a workspace ID for that workspace's
   * chat list.
   *
   * The subscriber first gets a full snapshot through `updated()`, then incremental changes. Dispose
   * of the returned stub to unsubscribe, e.g. when the view is hidden or its scope changes. If the
   * connection drops, subscribe again to get a fresh snapshot.
   *
   * Subscribing is read-only: it never marks messages read or dismisses notifications.
   */
  subscribeToUnreadState(scope: UnreadStateScope, subscriber: RpcStub<UnreadStateSubscriber>): Promise<RpcStub<{}>>;

  /**
   * Mark every chat in a workspace read, up to the latest messages the user's unread state has
   * received from it. Doesn't open the workspace, so a message that is still on its way from the
   * workspace at that moment stays unread, as do messages that arrive later. To mark a single chat
   * read, use `Overseer.markChatRead()`.
   */
  markWorkspaceRead(workspaceId: string): Promise<void>;

  /** Mark every chat in all of the user's workspaces read. Works like `markWorkspaceRead()`. */
  markAllRead(): Promise<void>;

  /**
   * Mute a workspace in the user's list, so its finished tasks notify no tab or device, or unmute
   * it with null. Permission requests still come through.
   */
  setWorkspaceNotificationMute(workspaceId: string, mute: NotificationMute | null): Promise<void>;

  /**
   * List the user's configured AI models of one kind, by default the language models, which can
   * chat.
   *
   * Note that the list returned here could be different from a particular gadget's Overseer,
   * especially if the gadget is owned by someone else.
   */
  listModels(kind?: ModelKind): Promise<AiChatAuthorInfo[]>;

  /**
   * Adds a new model to the user's configured set. The ID must not name a model the user already
   * added; use `updateModel()` to replace one.
   *
   * `copySecretsFrom` names a hand-added model (see `getModelConfig()`) whose stored secrets fill
   * in the `null` secrets of `config`, which is how a model is cloned without the client ever
   * holding the secrets. The rules of `updateModel()` for keeping a secret apply to copying one.
   * Without it, `config` must contain no `null` secrets. With it, `profile.id` must also not name
   * a model provided by the deployment's AI Gateway configuration.
   *
   * Throws on a deployment whose users may not add their own models (see
   * `AiGatewayInfo.userModelsEnabled`), as `updateModel()` does.
   */
  addModel(profile: AiChatAuthorInfo, config: RedactedAiModelConfig,
           copySecretsFrom?: string): Promise<void>;

  /**
   * Gets the profile and configuration of a model the user added by hand, i.e. not one provided
   * by the deployment's AI Gateway configuration, with its secrets withheld.
   */
  getModelConfig(id: string): Promise<{profile: AiChatAuthorInfo, config: RedactedAiModelConfig}>;

  /**
   * Replaces the configuration of a model the user added by hand. `profile.id` names the model,
   * and `config.provider` and `config.model` must match the stored values.
   *
   * A `null` secret keeps the stored value; for a header, that of the stored header with exactly
   * the same name. Secrets may be kept only while `config.provider` and `config.apiUrl` are
   * unchanged, since otherwise the client could direct the stored secrets to a server it controls.
   * Passing back what `getModelConfig()` returned therefore changes nothing.
   */
  updateModel(profile: AiChatAuthorInfo, config: RedactedAiModelConfig): Promise<void>;

  /** Deletes a configured model. */
  deleteModel(id: string): Promise<void>;

  /**
   * Set the model to use for simple quick tasks, like generating chat titles. Set null to
   * disable quick model use (e.g. chats will be titled "New Chat"); in AI Gateway mode, null and
   * a model that no longer resolves leave quick tasks to the deployment's own quick model.
   * Throws for a model on a deployment that applies Cloudflare usage limits, whose quick tasks
   * always run on its own quick model, since they count against no limit.
   */
  setQuickModel(id: string | null): Promise<void>;

  /** Get the quick model setting: null when unset or when the model no longer resolves. */
  getQuickModel(): Promise<null | string>;

  /**
   * Get AI configuration info, including whether AI Gateway mode is active and which providers
   * are available. The frontend uses this to adjust the model management UI.
   */
  getAiConfig(): Promise<AiGatewayInfo>;

  /** Resolve UI feature flags for the authenticated user. */
  getUiFeatureFlags(): Promise<UiFeatureFlags>;

  /**
   * Get the user's preferred model, chosen during onboarding. Returns null if the user has not
   * set a preference (or explicitly chose "No agent"). The preference may name a model that is
   * no longer offered (see setPreferredModel).
   */
  getPreferredModel(): Promise<string | null>;

  /**
   * Set the user's preferred model. Pass null to indicate "No agent". Any model that resolves is
   * accepted, including one hidden from pickers, but a new external conversation uses the
   * preference only while it is offered, and otherwise the first offered model.
   */
  setPreferredModel(id: string | null): Promise<void>;

  /** Returns true if the user has completed the onboarding wizard. */
  isOnboardingCompleted(): Promise<boolean>;

  /** Mark the onboarding wizard as completed. */
  completeOnboarding(): Promise<void>;

  // --- Optional Cloudflare limits / top-up flow (only meaningful when enabled server-side) ---

  /** Get the user's current free-tier usage and connected-account balance. */
  getCloudflareUsage(): Promise<CloudflareUsageInfo>;

  /**
   * List the Cloudflare accounts the connected grant can access. Used to prompt account selection
   * when the user has more than one. Returns an empty array if not connected. Connecting Cloudflare
   * is done via the Cloudflare gatekeeper (connectAccount("cloudflare")) or by signing in with it.
   */
  listCloudflareAccounts(): Promise<CloudflareAccountOption[]>;

  /**
   * Select which Cloudflare account to bill. Persists the choice. Throws if the account isn't
   * accessible.
   */
  selectCloudflareAccount(accountId: string): Promise<void>;

  /**
   * Upload a user avatar image. The data should be a compressed image (JPEG/PNG), ideally under
   * 50 KB. Pass null to remove the avatar.
   */
  setAvatar(data: Uint8Array | null): Promise<void>;

  /**
   * Fetch a user's avatar image by user ID. Returns null if no avatar has been set.
   * Accepts any user ID so that other users' avatars can be displayed (e.g. in chat).
   */
  getAvatar(userId: string): Promise<Uint8Array | null>;

  /**
   * Open an existing workspace, or join one shared with you by redeeming its share link's key.
   *
   * If `shareKey` is provided, the server redeems it before opening, adding the caller as a
   * collaborator. If the key is invalid or expired, the call throws an exception. If the workspace
   * has `ownerInvitesOnly` set (see `WorkspaceMetadata`), a caller the owner has not added directly
   * is refused with a `shareLinksDisabled` coded exception. This design
   * allows share-key redemption and workspace opening in a single round trip, and further calls
   * can be pipelined on the returned Overseer.
   *
   * To allow for pipelining, this throws an exception if the workspace doesn't exist. Expected
   * missing and authorization failures carry a code from `OPEN_WORKSPACE_ERROR_CODES`.
   *
   * `configureObservers` is invoked only when the opening user is a non-owner "build" collaborator
   * who must choose connected accounts for one or more gatekeeper bindings before they can observe
   * the workspace (see ObserverConfigCallback). It is never called for the owner or an
   * already-configured observer, so the common-case open is still a single pipelined round trip.
   * Collaborators with access to individual gadgets are verified when they get each gadget instead
   * (see Overseer.getGadget()).
   */
  openWorkspace(id: string, shareKey?: string,
      configureObservers?: RpcStub<ObserverConfigCallback>): Promise<RpcStub<Overseer>>;

  /**
   * Create a new workspace. It will start out titled "未命名工作区".
   *
   * Note: A workspace is considered "provisional" until it has some sort of activity, such as a
   *   chat message or code edit. Provisional workspaces do not appear on the home page
   *   (listWorkspaces() leaves them out). They are garbage, meant to be deleted after a while,
   *   though nothing deletes them yet. Note in particular that calling new*Gatekeeper() will
   *   not clear the provisional bit (as long as the gatekeeper isn't bound into a gadget), so
   *   provisional workspaces are useful to allow the user to write an initial chat message without
   *   explicitly creating a new workspace.
   *
   * A client that does not keep the returned Overseer, such as a one-shot command, reads the
   * workspace's id with Overseer.getMetadata() before letting it go, and later opens the workspace
   * with openWorkspace().
   *
   * @reportsId workspace getMetadata().id
   */
  newWorkspace(): Promise<RpcStub<Overseer>>;

  /**
   * List metadata about all the user's workspaces, which hold their gadgets. Used to display the
   * front-page listing.
   *
   * Provisional workspaces are hidden.
   *
   * TODO: Pagination, sort options.
   */
  listWorkspaces(): Promise<WorkspaceMetadataWithTimestamps[]>;

  /** Pin or unpin this workspace in the user's list. */
  setWorkspacePinned(workspaceId: string, pinned: boolean): Promise<void>;

  /**
   * List the outputs of all the user's workspaces. Used to display the Outputs page, which lets
   * the user find things they made without remembering which workspace they made them in.
   *
   * Served from an index in the user's own account which each workspace pushes to; a workspace
   * shared with the user contributes its outputs from the first time the user opens it (matching
   * when it appears in listWorkspaces()), and stops updating them if their access is revoked.
   * Provisional workspaces (still awaiting acceptance of a chat's changes) are never included.
   *
   * TODO: Pagination, sort options.
   */
  listOutputs(): Promise<ListOutputsResult>;

  /**
   * The deployment's standard output formats, the built-in blueprints this instance ships with and
   * any others an admin promotes, for a "New Document / New Slides / ..." menu, in the order to
   * offer them.
   * Empty when the deployment promotes none.
   *
   * These are ordinary blueprints an admin has promoted. Each blueprint bundled with the
   * deployment is promoted once, when it is first installed, and an admin may turn it off.
   */
  listOutputFormats(): Promise<OutputFormatOffer[]>;

  /**
   * Connectors you can connect: third-party services and MCP (Model Context Protocol) servers.
   * The services are ones such as GitHub or Slack, and the list is those this account can add.
   *
   * connectAccount() connects one, giving a connected account, and Overseer.newGatekeeper() then
   * makes one of that account's resources (a GitHub repository, an MCP server's endpoint) a
   * gatekeeper in a workspace; that is also how a workspace answers an agent's connection request
   * (see Overseer.acceptConnectionRequest()). Ambient gatekeepers need no connecting: see
   * listAddableGatekeepers().
   */
  listGatekeeperVendors(filter?: GatekeeperVendorFilter): Promise<GatekeeperVendorInfo[]>;

  /**
   * Connect this account to an account on a connector: a third-party service or MCP server. Returns
   * the URL which the Workshop opens as a disowned popup to complete the authorization, plus the
   * flow's nonce (see `ConnectFlowStart`). When the flow finishes, the popup lands on the
   * Workshop's own /connect/handoff page, which redeems the handoff with completeConnectHandoff()
   * over its own session; only then is the account added to the list, which can be observed through
   * subscribeConnectedAccounts().
   *
   * Only the Workshop client that started the flow can complete it. The ticket arrives only in
   * the URL fragment of the /connect/handoff page the flow ends on, and that page redeems it only
   * with the nonce the Workshop stored in its popup (the native apps instead pass the ticket back
   * to the WebView that kept the nonce). The URL opened any other way, such as in a plain browser
   * tab, ends on a handoff page that redeems nothing, so a caller holding the nonce still never
   * sees the ticket (see docs/connect-handoff.md). A vendor that provisions its own account
   * (`description.autoProvisionsAccount`) needs no flow: see provisionAmbientAccount().
   *
   * `resourceTypeIds`, if given, limits the connection to the authorization needed for those
   * grantable resource types (those with `grantable`; see `SupportedResource`). If omitted,
   * authorization for all of the vendor's resource types is requested. An empty array is meaningful
   * and distinct from omitting it: it requests no resource authorization at all, which is how a
   * caller connects an account for a non-resource purpose (e.g. billing) without asking the user to
   * grant data access it will never use.
   */
  connectAccount(vendorId: string, resourceTypeIds?: string[]): Promise<ConnectFlowStart>;

  /**
   * Redeem a finished connect flow's handoff. Called by the Workshop's own /connect/handoff page
   * running in the popup, over the popup's session, which is the initiating user's (the SPA
   * authenticates as any Workshop tab does: from the shared localStorage token, or from the
   * Cloudflare Access identity in an Access deployment). `ticket` is the handoff ticket from the
   * page's URL fragment; `nonce` must be the one connectAccount() / reconnectAccount() /
   * ensureAccountResources() returned for the flow that produced the ticket, read from the popup's
   * own sessionStorage. Both are single-use. Activates the pending connect / reconnect /
   * ensure-resources grant, after which the account (or its restored credentials) appears via
   * subscribeConnectedAccounts(). Throws with a user-facing message if the ticket or nonce is
   * unknown to this user, already used, or expired, or they belong to different flows.
   */
  completeConnectHandoff(ticket: string, nonce: string): Promise<void>;

  /**
   * Ensure the authorization for the listed grantable resource types (by stable vendor-scoped ID) is granted
   * on a connected account, expanding if needed. Returns a flow to open as a disowned popup, which
   * only the Workshop client that started it can complete (as for connectAccount()), to authorize
   * them, or null if nothing was needed. Completion is redeemed via completeConnectHandoff(); the
   * updated grant is then observable via subscribeConnectedAccounts().
   * Returning null also re-reads the account's description, so a list of granted resource types
   * that was out of date is corrected and observable the same way.
   */
  ensureAccountResources(accountId: number, resourceTypeIds: string[]): Promise<ConnectFlowStart | null>;

  /**
   * List the auto-provisioning ("ambient") gatekeepers the user can opt into right now. They are
   * those set to 'optional' by the admin that the user hasn't added yet, such as Skills
   * (`context`), Scheduled Tasks (`scheduler`) or Web Search (`websearch`). Rendered as an
   * "Available" section on the Connectors page. ('enabled' ones are already provisioned; 'disabled'
   * ones aren't offered.) Returns the same shape as listGatekeeperVendors (with no resources) so
   * the connect UI handles both identically, routing on `description.autoProvisionsAccount`.
   */
  listAddableGatekeepers(): Promise<GatekeeperVendorInfo[]>;

  /**
   * Opt into an ambient gatekeeper, such as Skills (Context collections), minting its account.
   * Ambient ones include Skills (`context`), Scheduled Tasks (`scheduler`) and Web Search
   * (`websearch`), and the account is this user's connected account, minted with no OAuth flow.
   * The new account appears via subscribeConnectedAccounts(); if the user already has one, the
   * call does nothing. Throws for an unknown vendor, one whose mode is 'disabled', or one that
   * isn't ambient.
   */
  provisionAmbientAccount(vendorId: string): Promise<void>;

  /**
   * Subscribe to the list of third-party accounts connected to the user's account.
   *
   * Dispose the returned stub to cancel the subscription.
   *
   * This is subscription-based because the flow to connect a new account completes in a separate
   * window. When it completes, we want the list of accounts in the Workshop UI to update
   * immediately, to give the user feedback that the account is now connected.
   */
  subscribeConnectedAccounts(
      subscriber: RpcStub<ConnectedAccountsSubscriber>, filter?: ConnectedAccountsFilter)
      : Promise<RpcStub<{}>>;

  /** Remove a connected account, revoking the token. */
  disconnectAccount(accountId: number): Promise<void>;

  /**
   * Get the UI used to choose a specific resource from a connected account.
   *
   * `accountId` is the user's connected account that provides this resource.
   * `resourceTypeId` is the stable vendor-scoped ID of the supported resource.
   *
   * Once the user has chosen in the frame, the Workshop asks its iframe for the resource URL
   * (ResourceConfiguratorIframe.collectResourceUrl()) and passes it to Overseer.newGatekeeper().
   * A caller without the iframe makes that URL itself, matching the type's current `urlPattern`, the
   * frame's `ui` helping only to look up what fills it.
   */
  startResourceConfigurator(
    accountId: number,
    resourceTypeId: string,
  ): Promise<ResourceConfiguratorFrame>;

  /**
   * Get the UI in which the approver of a creation of the type `resourceTypeId` configures it
   * in their connected account `accountId` (see SupportedResource.creationConfigurator). The
   * frame's collectResourceUrl() gives CreationApproval.configuration, or with `purpose` "save"
   * (omitted means "create") the `destination` of saveFile().
   */
  startCreationConfigurator(accountId: number, resourceTypeId: string, purpose?: "create" | "save")
      : Promise<GatekeeperUiFrame>;

  /**
   * Save `file` as a resource of the type `resourceTypeId` in the user's connected account
   * `accountId` (see GatekeeperUser.saveFile(), which defines the other parameters). Pass the
   * promise GadgetClient.export() returns as `file`, so the export goes straight to the
   * gatekeeper instead of through the client.
   */
  saveFile(accountId: number, resourceTypeId: string, destination: string, name: string,
      contentType: string, file: ReadableStream<Uint8Array>): Promise<{ url: string }>;

  /**
   * Remove a shared workspace from the user's home page listing. Does NOT revoke the user's
   * access -- if they open the workspace again (e.g., via link), it reappears on their home page.
   */
  dismissSharedWorkspace(workspaceId: string): Promise<void>;

  /**
   * List all blueprints created by the current user (from User DO). Useful for an audit
   * view in Settings.
   */
  listOwnBlueprints(): Promise<BlueprintUserSummary[]>;

  /** Return a blueprint created by the current user, or null if it is not owned by this user. */
  getOwnBlueprint(blueprintId: string): Promise<BlueprintUserSummary | null>;

  /**
   * List the blueprints currently in the user's library. This includes uploaded `.gadget`
   * archives (stored locally) and blueprints saved by reference from other publishers.
   */
  listLibraryBlueprints(): Promise<BlueprintLibrarySummary[]>;

  /**
   * Pin a blueprint for quick reuse on the home page. Pinning a public blueprint that isn't
   * already yours or in your library saves it to your library first.
   */
  setBlueprintPinned(blueprintId: string, pinned: boolean): Promise<void>;

  /** Returns whether the blueprint is pinned by the current user. */
  isBlueprintPinned(blueprintId: string): Promise<boolean>;

  /**
   * List the deployment-wide featured blueprints. This is served from a KV snapshot rather
   * than directly from the AdminSettings durable object.
   */
  listFeaturedBlueprints(): Promise<BlueprintPublicInfo[]>;

  /**
   * Add a blueprint to the user's library by reference, caching the current public metadata
   * snapshot for list rendering.
   */
  addBlueprintToLibrary(blueprintId: string): Promise<void>;

  /**
   * Remove a blueprint from the user's library. If the library entry was uploaded by the
   * current user, this also deletes the backing blueprint content from storage.
   */
  removeBlueprintFromLibrary(blueprintId: string): Promise<void>;

  /**
   * Returns info about whether the blueprint is in the user's library.
   * Returns null if not in library, or { uploaded } if it is.
   */
  isBlueprintInLibrary(blueprintId: string): Promise<{ uploaded: boolean } | null>;

  /**
   * Create a new workspace from a blueprint. Reads the blueprint from KV, downloads code from
   * R2, creates a new Overseer DO, initializes it with the blueprint's code, and creates
   * gatekeepers from the provided binding assignments.
   *
   * Every required binding in the blueprint must have a corresponding entry in `bindings`,
   * keyed by binding name. Throws if any are missing or if accountId/modelId are invalid.
   *
   * The returned Overseer can be used immediately (pipelining-friendly).
   *
   * @reportsId workspace getMetadata().id
   */
  newWorkspaceFromBlueprint(
    blueprintId: string,
    bindings: Record<string, BlueprintBindingAssignment>
  ): Promise<RpcStub<Overseer>>;

  /**
   * Delete a blueprint that the user owns. Works even if the source gadget has been deleted
   * (operates on User DO + KV directly).
   */
  deleteOrphanedBlueprint(blueprintId: string): Promise<void>;

  /**
   * Import a `.gadget` archive from another Workshop instance. The imported blueprint is stored
   * as a local blueprint owned by the current user.
   */
  importBlueprint(archive: ReadableStream<Uint8Array>): Promise<string>;

  /**
   * Re-authenticate a connected account whose credentials have expired (or may be about to
   * expire). Returns a flow to open as a disowned popup, which only the Workshop client that
   * started it can complete (as for connectAccount()). Once the OAuth flow completes and the
   * popup's /connect/handoff page redeems the handoff via completeConnectHandoff(), the account is
   * updated and subscribers are notified with credentialsValid: true.
   */
  reconnectAccount(accountId: number): Promise<ConnectFlowStart>;

  // --- Gatekeeper management apps ---

  /**
   * List the gatekeepers that expose a full-page management UI (VendorDescription.providesUi) and are
   * available to this user. The Workshop renders a nav entry + page per entry. Independent of whether
   * the gatekeeper is a singleton.
   */
  listGatekeeperApps(): Promise<GatekeeperAppInfo[]>;

  /**
   * Get the app of gatekeeper `id`, such as Skills, for creating Skills/Context collections.
   * A UI-providing gatekeeper has one: Skills (`context`) has a `ui` that creates and manages
   * Skills/Context collections, and Scheduled Tasks (`scheduler`) one that lists schedules. The app
   * is the gatekeeper's frame (self-contained iframe HTML + its `ui` capability), or null if the
   * user has no such gatekeeper. An ambient one the deployment only offers is null until the user
   * opts in with provisionAmbientAccount(). The Workshop hosts the HTML in a sandboxed iframe and
   * exposes `ui` to it over a MessagePort RPC session. The `ui`'s interface is the gatekeeper's own:
   * `ContextApi` in gatekeeper-context's `context-types.ts`, `ScheduleManagementApi` in
   * gatekeeper-scheduler's `management-types.ts`.
   *
   * @appApi ui id
   * @nullWhen the user has no gatekeeper of that id with an app, as listGatekeeperApps() lists
   *   them; for an ambient one the deployment only offers, provisionAmbientAccount() with that id
   *   adds it
   */
  getGatekeeperApp(id: string): Promise<GatekeeperUiFrame | null>;

  /**
   * Mint a single-use ticket for a user selected on behalf of a gatekeeper app,
   * redeemable through that gatekeeper app's exchange capability (see
   * GatekeeperUserSelectionExchangeImpl). Returns null if the selected user is
   * this user or does not exist.
   */
  createGatekeeperUserSelection(
      vendorId: string, selectedUserId: string,
  ): Promise<GatekeeperUserSelection | null>;

  // --- Deployment admin ---

  /**
   * Whether the current user is a deployment admin. Used by the client to decide whether to show
   * the admin UI.
   */
  amIAdmin(): Promise<boolean>;

  /**
   * Returns a capability for managing and investigating the deployment as an admin, or null when
   * the caller is not one. The access check happens here, once, for every AdminApi method but
   * inspection: AdminApi.inspectWorkspace(), AdminApi.inspectUser() and each call on the view
   * either mints check again (see AdminWorkspaceView and AdminUserView). Every audit record the
   * capability makes is labelled with an AdminVia derived from the client's User-Agent.
   * (Authentication config — sign-in providers, password login — is intentionally not managed
   * here; it stays env-var driven.)
   *
   * @nullWhen the caller is not a deployment admin; amIAdmin() says whether it is
   */
  getAdminApi(): Promise<RpcStub<AdminApi> | null>;

  // TODO:
  // - Edit permissions on a connected account.
}

/** Describes a gatekeeper's management app, for the Workshop nav + page. */
export type GatekeeperAppInfo = {
  /**
   * The vendor id (the GATEKEEPER_<ID> binding suffix, lowercased), used as the URL slug at
   * /gatekeepers/$id. This is the vendor, not a specific account: it assumes one management-UI
   * account per vendor per user, which holds for today's auto-provisioned singletons.
   */
  id: string;
  /** Title for the nav entry / page header. */
  title: string;
  /** Optional icon. */
  icon?: AvatarImage;
};

// ---------------------------------------------------------------------------
// Context Library — pluggable separate worker (packages/gatekeeper-context)
// ---------------------------------------------------------------------------
//
// The Context Library lives in its own Worker, bound as the auto-provisioned gatekeeper
// GATEKEEPER_CONTEXT. Core implements none of its logic and owns none of its types (those live in
// the gatekeeper package): the account mints a management capability (the iframe app's `ui`, treated
// opaquely here) and a read session (the agent read-path, auto-provided as an unnamed capsule).

/** Maximum length (characters) of the admin announcement / banner text. */
export const MAX_ANNOUNCEMENT_LENGTH = 2000;

/**
 * Accent colors available for the full-width announcement banner. Soft status tints plus the brand
 * color, so a banner need not look like an alert.
 */
export type BannerColor = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

export const BANNER_COLORS: BannerColor[] =
    ['neutral', 'info', 'success', 'warning', 'danger', 'brand'];

export const DEFAULT_BANNER_COLOR: BannerColor = 'info';

export function isBannerColor(value: unknown): value is BannerColor {
  return typeof value === 'string' && (BANNER_COLORS as string[]).includes(value);
}

/** The deployment-wide full-width banner configuration. */
export type BannerConfig = {
  /** Banner text (Markdown supported). Empty string hides the banner. */
  text: string;
  /** Accent color. */
  color: BannerColor;
};

/**
 * Whether `value` is a valid 3- or 6-digit hex color (e.g. "#abc" or "#aabbcc"). Used to validate
 * the admin accent color before it's interpolated into CSS, preventing CSS injection.
 */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

/** A single gatekeeper resource type in the admin resource-config UI. */
export type AdminResource = {
  /** Stable vendor-scoped type ID; older responses and unresolved legacy restrictions omit it. */
  resourceTypeId?: string;
  /** URL matching pattern, or the retained unmatched pattern of a legacy restriction. */
  urlPattern: string;
  title: string;
  description: string;
  icon?: AvatarImage;
  /** Whether this resource is currently enabled (not in the admin disabled set). */
  enabled: boolean;
};

/**
 * Provisioning mode for an auto-provisioning ("ambient") gatekeeper — one that mints a connected
 * account with no OAuth flow (VendorDescription.autoProvisionsAccount), e.g. the Context Library:
 *   - 'disabled': not available; no account is provisioned and any existing one is dormant.
 *   - 'optional': users opt in from the Connectors page; not forced on anyone (the default).
 *   - 'enabled':  auto-provisioned for every user (forced); they can't remove it.
 */
export const AMBIENT_GATEKEEPER_MODES = ['disabled', 'optional', 'enabled'] as const;
export type AmbientGatekeeperMode = typeof AMBIENT_GATEKEEPER_MODES[number];

export function isAmbientGatekeeperMode(value: unknown): value is AmbientGatekeeperMode {
  return AMBIENT_GATEKEEPER_MODES.includes(value as AmbientGatekeeperMode);
}

/**
 * A bound gatekeeper in the admin gatekeeper-config UI, discriminated by `autoProvisions`:
 *   - an ordinary OAuth/resource gatekeeper has a binary `enabled` flag and `resources` to toggle;
 *   - an auto-provisioning ("ambient") gatekeeper has a three-state `ambientMode` and no resources.
 */
export type AdminResourceVendor = {
  vendorId: string;
  displayName: string;
  logo?: AvatarImage;
} & (
  | { autoProvisions: false; enabled: boolean; resources: AdminResource[] }
  | { autoProvisions: true; ambientMode: AmbientGatekeeperMode }
);

/**
 * A third-party service: its vendor id, display metadata, and resource types with connection and
 * creation flags (empty for an auto-provisioning gatekeeper like the Context Library). Returned by both
 * listGatekeeperVendors and listAddableGatekeepers so the connect UI treats both uniformly.
 */
export type GatekeeperVendorInfo = {
  id: string;
  description: VendorDescription;
  supportedResources: SupportedResource[];
  /**
   * Present when a bound gatekeeper could not be queried. UIs should surface this to the user but
   * not offer it as connectable.
   */
  unavailable?: boolean;
};

/** Maximum length (characters) of the admin-authored agent system-prompt instructions. */
export const MAX_INSTANCE_INSTRUCTIONS_LENGTH = 8000;

/** Maximum length (characters) of the admin-authored site name shown next to the top-bar logo. */
export const MAX_SITE_NAME_LENGTH = 40;

/**
 * What this deployment calls itself when the admin has not set a custom `siteName`. Also the
 * product's own name, so it appears in prose the server and UI address to the user.
 */
export const DEFAULT_SITE_NAME = "有缘心之助";

/**
 * The name to display for this deployment. Accepts an unset or not-yet-loaded `siteName` so both
 * the server (reading admin config) and the client (reading ServerConfig) resolve it identically.
 */
export function resolveSiteName(siteName: string | undefined): string {
  return (siteName ?? "").trim() || DEFAULT_SITE_NAME;
}

/** Maximum byte length of an admin-uploaded site logo after browser-side PNG conversion. */
export const MAX_SITE_LOGO_BYTES = 256 * 1024;

/** Maximum width or height of an admin-uploaded site logo in pixels. */
export const MAX_SITE_LOGO_DIMENSION = 512;

/**
 * The default of the deployment's check interval (see AdminApi.setUpdateCheckIntervalMinutes): how
 * many minutes a successful update check is relied on before the deployment asks again.
 */
export const DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES = 60;

/** The largest check interval, in minutes, an admin may set: 30 days. */
export const MAX_UPDATE_CHECK_INTERVAL_MINUTES = 43_200;

/**
 * The default of the deployment's minimum age (see AdminApi.setUpdateMinimumAgeHours): how many
 * hours a newer release must have been available before admins are notified of it.
 */
export const DEFAULT_UPDATE_MINIMUM_AGE_HOURS = 24;

/**
 * The default of the deployment's notice snooze (see AdminApi.setUpdateNoticeSnoozeHours): how
 * many hours a dismissed update notice stays hidden in the browser that dismissed it.
 */
export const DEFAULT_UPDATE_NOTICE_SNOOZE_HOURS = 24;

/** The largest minimum age and notice snooze, in hours, an admin may set: 30 days. */
export const MAX_UPDATE_HOURS = 720;

/**
 * The path a Workshop browser POSTs to, through the router, before it reads the update status, so
 * that the backend records the router's current version tag first. The Workshop's other calls
 * travel over one WebSocket, which carries the router's tag only when it opens. Answered with an
 * empty 204.
 */
export const ROUTER_TAG_PROBE_PATH = "/api/router-tag";

/**
 * The path a Workshop browser GETs, through the router, to learn the version id of the backend that
 * new requests reach: `{ version: string | null }`, never cached, `null` where the backend has no
 * version id. A deploy does not move the WebSocket a tab already holds, so a tab whose
 * `ServerConfig.backendVersion` differs is still talking to an older backend, and reconnects.
 */
export const VERSION_PATH = "/api/version";

/** All admin-managed deployment settings, returned by AdminApi.getSettings() for the admin UI. */
export type AdminSettingsView = {
  /** Whether new account signups are allowed. */
  signupsEnabled: boolean;
  /** Whether users may search the user directory to find collaborators. */
  userSearchEnabled: boolean;
  /**
   * How much of a workspace or of a user's account an admin may inspect (see
   * AdminApi.setAdminWorkspaceAccess): inspectWorkspace() and inspectUser() are refused while
   * `effective` is "off".
   */
  adminWorkspaceAccess: {
    /** The level enforced: the lower of `chosen` and `max`. */
    effective: AdminWorkspaceAccess;
    /** The level an admin set, DEFAULT_ADMIN_WORKSPACE_ACCESS until one does. A stored value that
     * is not a level reads as "off", though no admin chose it. Kept, but not enforced, while it
     * is above `max`. */
    chosen: AdminWorkspaceAccess;
    /** The highest level the deployment allows, which its ADMIN_WORKSPACE_ACCESS_MAX environment
     * variable sets: "metadata" while that is unset or blank, and "off" while it holds anything
     * that is not a level, so a misconfiguration never grants access. Only a deployment config
     * change can raise it. */
    max: AdminWorkspaceAccess;
  };
  /**
   * How many days the admin audit log keeps a record (see AdminApi.setAdminAuditRetentionDays):
   * `effective`.
   */
  adminAuditRetentionDays: {
    /** The retention enforced: the higher of `chosen` and `min`. */
    effective: number;
    /** The retention an admin set, DEFAULT_ADMIN_AUDIT_RETENTION_DAYS until one does. */
    chosen: number;
    /** The fewest days the deployment allows, which its ADMIN_AUDIT_RETENTION_MIN_DAYS environment
     * variable sets: DEFAULT_ADMIN_AUDIT_RETENTION_DAYS while that is unset, blank or not a
     * positive whole number. */
    min: number;
  };
  /** Site name shown next to the top-bar logo ("" falls back to DEFAULT_SITE_NAME). */
  siteName: string;
  /** Custom deployment logo, or undefined to use the default Cloudflare OS mark. */
  siteLogo?: AvatarImage;
  /** Agent system-prompt instructions ("" when unset). */
  instanceInstructions: string;
  /** Top-bar notice text ("" when unset). */
  announcement: string;
  /** Full-width banner (text + accent color). */
  banner: BannerConfig;
  /** Accent color hex, or "" for the default theme. */
  accentColor: string;
  /** The hosts `webFetch` may reach in a workspace that has observed restricted data. */
  restrictedWebFetchHosts: string[];
  /**
   * Whether a user may approve, one URL at a time, a fetch that `restrictedWebFetchHosts` doesn't
   * allow, in a workspace that has observed restricted data.
   */
  restrictedWebFetchApprovals: boolean;
  /** Every bound gatekeeper and its resource types, with enabled state (not hidden when disabled). */
  resourceVendors: AdminResourceVendor[];
  /** The blueprints promoted as standard output formats, in menu order (including disabled ones). */
  formats: AdminFormat[];
  /** The models the deployment provides through AI Gateway. Absent outside AI Gateway mode. */
  gatewayModels?: {
    /** The providers a model may be added under: the ones the gateway both enables and serves. */
    providers: AiModelProvider[];
    /** Every provider the gateway serves, on or off, in the order the models are listed in. */
    providerSettings: AdminGatewayProvider[];
    /** Every gateway model, in any mode, in listing order. */
    models: AdminModelView[];
    /**
     * The reasoning level of each gateway model that has none of its own (see
     * AdminApi.setDefaultReasoning), or null while the deployment sets none.
     */
    defaultReasoning: ReasoningLevel | null;
    /** Whether users may add models of their own (see AdminApi.setUserModelsEnabled). */
    userModelsEnabled: boolean;
    /**
     * Whether the admin UI may suggest models from models.dev while an admin adds one (see
     * AdminApi.setModelsDevSuggestions).
     */
    modelsDevSuggestions: boolean;
  };
};

/**
 * One promoted blueprint, as the admin Formats panel sees it: the deployment's curation plus
 * enough of the blueprint to show what is being curated.
 */
export type AdminFormat = {
  blueprintId: string;

  blueprintTitle: string;

  /**
   * The blueprint's own description, which is the rest of the catalog entry the agent reads;
   * `agentHint` is only its last line.
   */
  blueprintDescription: string;

  /** Presentation after the deployment's overrides are applied. */
  output?: BlueprintOutput;

  /** What the blueprint itself declares, so the panel can show which fields are overridden. */
  declared?: BlueprintOutput;

  /** The deployment's presentation overrides, if any. */
  overrides?: Partial<BlueprintOutput>;

  enabled: boolean;

  /** One line telling the agent when to prefer this format. */
  agentHint: string;

  /**
   * The promoted blueprint no longer exists (deleted after promotion). Such an entry is skipped
   * everywhere else; the panel surfaces it so the admin can remove it.
   */
  missing: boolean;

  /**
   * The blueprint ships with the deployment (see packages/bundled-blueprints and the
   * BUNDLED_BLUEPRINTS the backend's build generates from it), so an upgrade can replace its contents. Curation stays the admin's: an upgrade never re-promotes something they
   * removed, nor resets their overrides.
   */
  bundled: boolean;
};

/**
 * Whether a newer release is available for a deployment the deploy flow installed, returned by
 * AdminApi.getUpdateStatus(). The check fields describe the last successful update check made for
 * the release this backend runs: until one succeeds, `latestReleaseId`, `availableSince` and
 * `checkedAt` are absent and `updateAvailable` is false.
 */
export type DeploymentUpdateStatus = {
  /** The release this backend runs. */
  currentReleaseId: string;
  /** The newest release the last successful check for `currentReleaseId` reported. */
  latestReleaseId?: string;
  /** Whether that check said a release newer than `currentReleaseId` exists. */
  updateAvailable: boolean;
  /**
   * When the first release newer than `currentReleaseId` was published. Absent unless
   * `updateAvailable`.
   */
  availableSince?: Date;
  /**
   * Whether the home page should show admins the update notice now, before the browser applies
   * its own dismissal (see `noticeSnoozeHours`). True exactly when `checksEnabled`, the check says
   * `updateAvailable`, the deployment is not `modified`, and `availableSince` is at least
   * `minimumAgeHours` ago.
   */
  notify: boolean;
  /**
   * Whether the deployment checks for updates by itself (see AdminApi.setUpdateChecksEnabled).
   * When false, `notify` is false and only AdminApi.checkForUpdates() asks for the newest release.
   */
  checksEnabled: boolean;
  /**
   * The deployment's check interval: how many minutes a successful check is relied on before the
   * deployment asks again (see AdminApi.setUpdateCheckIntervalMinutes).
   */
  checkIntervalMinutes: number;
  /**
   * The deployment's minimum age: how many hours a newer release must have been available before
   * `notify` is true (see AdminApi.setUpdateMinimumAgeHours).
   */
  minimumAgeHours: number;
  /**
   * The deployment's notice snooze: how many hours a browser hides the notice after an admin
   * dismisses it there (see AdminApi.setUpdateNoticeSnoozeHours).
   */
  noticeSnoozeHours: number;
  /**
   * Whether this deployment's running code differs from what the deploy flow installed: true
   * exactly when `modifiedWorkers` is non-empty. The deploy flow refuses to upgrade a modified
   * deployment.
   */
  modified: boolean;
  /**
   * The Workers whose running version is neither this installation's current one nor another
   * release of it: they have no version tag, or one the deploy flow did not write for this
   * installation. Each is "backend", "router", or a gatekeeper's install slug. A Worker that did
   * not report its version is in neither this list nor `unfinishedWorkers`.
   */
  modifiedWorkers: string[];
  /**
   * The Workers still running another release of this installation: an update that did not
   * finish, which the deploy flow can finish once no Worker is modified. Named as in
   * `modifiedWorkers`. Unlike those, they do not affect `notify`.
   */
  unfinishedWorkers: string[];
  /** The opaque link that opens the deploy flow for this installation. */
  updateUrl: string;
  /** When the last successful check for `currentReleaseId` was made. */
  checkedAt?: Date;
};

/**
 * How an admin's calls reach the deployment, as their audit records say: "cli" when the session's
 * User-Agent is the cf-os CLI's, "api" for any other client of the API (the Workshop's admin panel
 * among them). The User-Agent is the client's own claim, so this is an unverified label that
 * grants nothing.
 */
export type AdminVia = "api" | "cli";

/** How many records one page of an admin listing (AdminApi.listUsers(), listWorkspaces(),
 * listAdminAudit()) holds when the caller gives no `limit`. */
export const ADMIN_LIST_DEFAULT_LIMIT = 50;

/** The most records one page of an admin listing may hold. */
export const ADMIN_LIST_MAX_LIMIT = 200;

/**
 * One account of this deployment, as AdminApi.listUsers() lists it. `id` is the username of a
 * password account and the email of a sign-in or Cloudflare Access account, kept whole; `name` is
 * the display name, at most MAX_DIRECTORY_TEXT_LENGTH characters (see UserDirectoryRecord).
 */
export type AdminUserRecord = UserDirectoryRecord & {
  /** When the account was created. Absent for one created before the deployment recorded it. */
  created?: Date;
  /** When the user last started a session (signed in, or connected with a stored session), to
   * within an hour. Absent until their first session after the deployment began recording it. */
  lastLogin?: Date;
  /** Whether the user is a deployment admin now: named in the deployment's ADMINS variable. */
  isAdmin: boolean;
};

/** Options for AdminApi.listUsers(). */
export type AdminUserQuery = {
  /** Only users whose id or display name contains this, case-insensitively. At most 1000
   * characters, with no line break; absent or blank lists everyone. */
  query?: string;
  /** The previous page's `nextCursor`; absent for the first page. */
  cursor?: string;
  /** The page size: a whole number from 1 to ADMIN_LIST_MAX_LIMIT, ADMIN_LIST_DEFAULT_LIMIT when
   * absent. */
  limit?: number;
};

/** One page of AdminApi.listUsers(). */
export type AdminUserPage = {
  /** The page's users, in id order: at most the query's `limit`, and fewer when their ids and
   * names are long (see AdminApi.listUsers()). */
  users: AdminUserRecord[];
  /** Pass as `cursor` for the next page; absent once there is none. */
  nextCursor?: string;
};

/** One workspace of this deployment, as AdminApi.listWorkspaces() lists it. */
export type AdminWorkspaceRecord = {
  /** The workspace id, as AdminApi.inspectWorkspace() and AuthenticatedApi.openGadget() take it. */
  id: string;
  /** The workspace title, as the workspace last reported it: its first MAX_DIRECTORY_TEXT_LENGTH
   * characters when longer. */
  title: string;
  /** The owner: their canonical user id, kept whole, and their display name as the directory last
   * saw it (their id until they next start a session), at most MAX_DIRECTORY_TEXT_LENGTH
   * characters. */
  owner: UserDirectoryRecord;
  /** When the workspace was created. Absent until known: an older workspace's is read from its
   * owner's records when it is first opened after the deployment began recording workspaces. */
  created?: Date;
  /** When the workspace was last active (an agent turn, a code change, an action), to within an
   * hour. Absent until it is next active. */
  lastActive?: Date;
};

/** Options for AdminApi.listWorkspaces(). */
export type AdminWorkspaceQuery = {
  /** Only workspaces this user owns, by canonical user id (AdminUserRecord.id), matched exactly. */
  owner?: string;
  /** Only workspaces whose id, title or owner id contains this, case-insensitively. At most 1000
   * characters, with no line break; absent or blank matches every workspace. */
  query?: string;
  /** The previous page's `nextCursor`; absent for the first page. */
  cursor?: string;
  /** The page size: a whole number from 1 to ADMIN_LIST_MAX_LIMIT, ADMIN_LIST_DEFAULT_LIMIT when
   * absent. */
  limit?: number;
};

/** One page of AdminApi.listWorkspaces(). */
export type AdminWorkspacePage = {
  /** The page's workspaces, in id order: at most the query's `limit`, and fewer when their ids,
   * titles and owners are long (see AdminApi.listWorkspaces()). */
  workspaces: AdminWorkspaceRecord[];
  /** Pass as `cursor` for the next page; absent once there is none. */
  nextCursor?: string;
};

/**
 * How much of a workspace or of a user's account a deployment admin may inspect through
 * AdminApi.inspectWorkspace() and AdminApi.inspectUser(), in increasing order:
 *   - "off":      nothing; inspectWorkspace() and inspectUser() are refused.
 *   - "metadata": a workspace's structure: titles, workpieces, collaborators, observers,
 *                 connections, the chat and action lists, file names, commit ids and authors, the
 *                 names, types, sizes and content hashes of attachments, the titles and
 *                 descriptions of blueprints, share links' notes, and diagnostics. Chat messages,
 *                 queued steers, attachments, file contents (at any commit, or pending in a
 *                 chat), commit messages, the arguments of calls queued for an agent, the
 *                 configuration an agent suggested for a connection, which blueprint a gadget
 *                 follows, the ids of the blueprints the workspace publishes, and the
 *                 descriptions and fields of actions, observations and hooks are withheld.
 *                 Titles, names, notes and blueprint descriptions stay, and can echo content.
 *                 Of a user's account, what the account itself records: its profile, workspaces,
 *                 connected accounts, models, sign-in sessions, blueprints and diagnostics. What
 *                 a gatekeeper says of a connected account (its display names, avatar and what
 *                 it grants) and the ids of the account's blueprints are withheld, and no
 *                 credential is returned.
 * No level shows what "metadata" withholds.
 */
export const ADMIN_WORKSPACE_ACCESS_LEVELS = ["off", "metadata"] as const;

/** One of ADMIN_WORKSPACE_ACCESS_LEVELS. */
export type AdminWorkspaceAccess = typeof ADMIN_WORKSPACE_ACCESS_LEVELS[number];

/** Whether `value` is an AdminWorkspaceAccess. */
export function isAdminWorkspaceAccess(value: unknown): value is AdminWorkspaceAccess {
  return ADMIN_WORKSPACE_ACCESS_LEVELS.includes(value as AdminWorkspaceAccess);
}

/** The access level a deployment has until an admin sets one. */
export const DEFAULT_ADMIN_WORKSPACE_ACCESS: AdminWorkspaceAccess = "metadata";

/**
 * How many days the admin audit log keeps a record until an admin sets otherwise, and the fewest
 * an admin may set unless the deployment's ADMIN_AUDIT_RETENTION_MIN_DAYS says otherwise.
 */
export const DEFAULT_ADMIN_AUDIT_RETENTION_DAYS = 90;

/** The longest retention an admin may set, in days: ten years. */
export const MAX_ADMIN_AUDIT_RETENTION_DAYS = 3650;

/** How long an AdminWorkspaceView or an AdminUserView lasts unless
 * AdminInspectOptions.lifetimeSeconds says: 15 minutes. */
export const DEFAULT_ADMIN_VIEW_LIFETIME_SECONDS = 900;

/** The longest an AdminWorkspaceView or an AdminUserView may last, in seconds: an hour. */
export const MAX_ADMIN_VIEW_LIFETIME_SECONDS = 3600;

/** The longest reason AdminApi.inspectWorkspace() and AdminApi.inspectUser() take, in characters,
 * once trimmed. */
export const MAX_ADMIN_ACCESS_REASON_LENGTH = 500;

/** How many commits AdminWorkspaceView.getCommitLog() returns when the caller gives no `depth`. */
export const DEFAULT_ADMIN_COMMIT_LOG_DEPTH = 20;

/** The most commits one AdminWorkspaceView.getCommitLog() call returns. */
export const MAX_ADMIN_COMMIT_LOG_DEPTH = 100;

/** Options for AdminApi.inspectWorkspace() and AdminApi.inspectUser(). */
export type AdminInspectOptions = {
  /** How long the view lasts: a whole number of seconds from 1 to
   * MAX_ADMIN_VIEW_LIFETIME_SECONDS, DEFAULT_ADMIN_VIEW_LIFETIME_SECONDS when absent. */
  lifetimeSeconds?: number;
};

/** The workspace calls the audit log records: the open (AdminApi.inspectWorkspace()) and each
 * AdminWorkspaceView method. */
export const ADMIN_WORKSPACE_METHODS = [
  "inspectWorkspace", "describe", "listChats", "getChatState", "listChatAttachments",
  "listActions", "listFiles", "getCommitLog", "listFilesAtCommit", "listChangedPaths",
  "listPendingChanges", "listGatekeepers", "listObservers", "listObserverRequirements",
  "listShareLinks", "listAutoApprovals", "listBlueprints", "getDiagnostics",
] as const satisfies readonly ("inspectWorkspace" | keyof AdminWorkspaceView)[];

/** One of ADMIN_WORKSPACE_METHODS. */
export type AdminWorkspaceMethod = typeof ADMIN_WORKSPACE_METHODS[number];

/** The calls into a user's account that the audit log records: the open (AdminApi.inspectUser())
 * and each AdminUserView method. */
export const ADMIN_USER_METHODS = [
  "inspectUser", "describe", "listWorkspaces", "listConnectedAccounts", "listModels",
  "listSessions", "listBlueprints", "getDiagnostics",
] as const satisfies readonly ("inspectUser" | keyof AdminUserView)[];

/** One of ADMIN_USER_METHODS. */
export type AdminUserMethod = typeof ADMIN_USER_METHODS[number];

/**
 * The AdminApi methods that change a deployment setting, each recorded as an AdminSettingRecord
 * before its change takes effect. inspectWorkspace() is recorded as an AdminAccessRecord and
 * inspectUser() as an AdminUserAccessRecord. The rest change no setting and are not recorded: the
 * reads (getSettings, isBlueprintFeatured, getUpdateStatus, listUsers, listWorkspaces,
 * listAdminAudit, getAdminAuditStats), the gateway tests, and checkForUpdates.
 */
export const ADMIN_SETTING_METHODS = [
  "setSignupsEnabled", "setUserSearchEnabled", "setSiteName", "setSiteLogo",
  "setInstanceInstructions", "setResourceEnabled", "setGatekeeperMode", "setAnnouncement",
  "setBanner", "setAccentColor", "setBlueprintFeatured", "promoteFormat", "removeFormat",
  "updateFormat", "setFormatOrder", "setGatewayModelMode", "addGatewayModel",
  "removeGatewayModel", "setUserModelsEnabled", "setModelsDevSuggestions",
  "setGatewayModelSettings", "setDefaultReasoning", "setGatewayProviderEnabled",
  "setUpdateChecksEnabled", "setUpdateCheckIntervalMinutes", "setUpdateMinimumAgeHours",
  "setUpdateNoticeSnoozeHours", "setRestrictedWebFetchHosts", "setRestrictedWebFetchApprovals",
  "setAdminWorkspaceAccess", "setAdminAuditRetentionDays", "setGatewayProviderOrder",
  "setGatewayModelOrder",
] as const satisfies readonly (keyof AdminApi)[];

/** One of ADMIN_SETTING_METHODS. */
export type AdminSettingMethod = typeof ADMIN_SETTING_METHODS[number];

/** The longest string an audit record keeps as a call's argument, a workspace's title or a
 * setting entry's key, in characters: a longer one is cut to this, its last character replaced
 * with "…". */
export const MAX_ADMIN_AUDIT_ARG_LENGTH = 256;

/** The longest value an AdminSettingChange keeps whole, in characters: more than any bounded
 * setting holds (the longest, the agent instructions, are at most
 * MAX_INSTANCE_INSTRUCTIONS_LENGTH characters, recorded as themselves). A longer value is kept as
 * an excerpt (see AdminSettingChange.excerpt). */
export const MAX_ADMIN_AUDIT_VALUE_LENGTH = 10_000;

/**
 * One admin call into a workspace: the open that minted an AdminWorkspaceView, or a call made
 * through one. It is recorded once the call has read what it answers with, and before any of that
 * leaves the server. It is recorded in the deployment-wide log behind AdminApi.listAdminAudit(),
 * never in the workspace, so nothing a workspace member can read ever shows it. A call the view
 * itself stops is not recorded. That covers a call made after the view expired, after its admin
 * stopped being an admin or after the workspace was deleted, and a call that any of these
 * overtakes while it reads. A call the access level refuses is recorded, with `refused` set, and
 * so is a call whose read fails, and so is an open refused before it reaches the workspace,
 * because the deployment's access level is "off".
 */
export type AdminAccessRecord = {
  /** Distinguishes this from an AdminUserAccessRecord and an AdminSettingRecord. */
  kind: "workspace";
  /** When the call was recorded: once it had read its answer (or failed to), or as it was
   * refused. */
  at: Date;
  /** The admin who made it, by canonical user id. */
  admin: string;
  /** Opaque. Shared by every record made through one AuthenticatedApi.getAdminApi() capability,
   * so one admin session's records can be read together. */
  sessionId: string;
  /** How the admin's calls reached the deployment (see AdminVia). */
  via: AdminVia;
  /** The workspace. */
  workspaceId: string;
  /** The workspace's owner, by canonical user id, as the workspace knew them when the view opened.
   * A username has no length limit of its own, so an id over MAX_ADMIN_AUDIT_ARG_LENGTH characters
   * is kept as its start, "…#" and a digest of the whole id, that many characters in all: two
   * long ids stay apart. For an open refused before it reached the workspace, the owner the
   * deployment directory lists, kept the same way, "" when it lists none. */
  workspaceOwner: string;
  /** The workspace's title when the call was made, cut like an argument (see
   * MAX_ADMIN_AUDIT_ARG_LENGTH), since a title has no length limit of its own. For an open refused
   * before it reached the workspace, the title the deployment directory lists, cut the same way,
   * "" when it lists none. */
  workspaceTitle: string;
  /** "inspectWorkspace" for the open, else the view method called. */
  method: AdminWorkspaceMethod;
  /** The call's arguments by name: only those it declares, an absent optional one left out, each
   * string cut to MAX_ADMIN_AUDIT_ARG_LENGTH. The open records `expiresAt` (ISO 8601), and
   * listObserverRequirements() its grant as `grant: "workspace"` or the gadget's `gadgetId`. No
   * view method takes content, so none is recorded. */
  args: Record<string, string | number>;
  /** The reason the admin gave when opening the view. */
  reason: string;
  /** The deployment's access level when the call ran (AdminSettingsView.adminWorkspaceAccess
   * .effective, as the call read it): "metadata", or "off" when the call was refused for that. */
  access: AdminWorkspaceAccess;
  /** Present when the access level refused the call, which then read nothing: the code it was
   * refused with. */
  refused?: typeof ADMIN_ACCESS_ERROR_CODES.accessOff;
};

/**
 * One admin call into a user's account: the open that minted an AdminUserView, or a call made
 * through one. Recorded as an AdminAccessRecord is: once the call has read what it answers with
 * and before any of that leaves the server, in the deployment-wide log behind
 * AdminApi.listAdminAudit() and never in the account, so nothing the user can read shows it unless
 * they are a deployment admin themselves, who can read that log. A call the view itself stops
 * (expired, its admin no longer one, the account gone) is not recorded; a call the access level
 * refuses is, with `refused` set, as is a call whose read fails, and an open refused before it
 * reaches the account because the deployment's access level is "off".
 */
export type AdminUserAccessRecord = Pick<AdminAccessRecord,
    "at" | "admin" | "sessionId" | "via" | "reason" | "access" | "refused"> & {
  /** Distinguishes this from an AdminAccessRecord and an AdminSettingRecord. */
  kind: "user";
  /** The user whose account the call was made into, by canonical user id, kept as
   * AdminAccessRecord.workspaceOwner keeps an owner: whole while at most
   * MAX_ADMIN_AUDIT_ARG_LENGTH characters, else its start, "…#" and a digest of the whole id. For
   * an open refused before it reached the account, the id the admin gave, kept the same way. */
  userId: string;
  /** "inspectUser" for the open, else the view method called. */
  method: AdminUserMethod;
  /** The call's arguments by name. Only the open records one, `expiresAt` (ISO 8601): no
   * AdminUserView method takes an argument, so every other record's is empty. */
  args: Record<string, string | number>;
};

/**
 * One setting an AdminSettingRecord changed, with its value before and after. `setting` names a
 * field of the deployment's stored settings ("siteName", "modelModes", ...) or one of the two kept
 * apart from them, "siteLogo" and "featured". The names are those the settings are stored under: a
 * diagnostic vocabulary, not a schema clients may depend on.
 *
 * A setting holding a map (an object keyed by id or name, such as "modelModes" or "banner") or a
 * list of entries with ids ("formats", by blueprint id; "addedModels", by model id) is recorded
 * one entry at a time: `key` names the entry, and the values are that entry's alone. A change to
 * the order of such a list is one more change, without `key`, whose values are the lists of every
 * entry's id, in order.
 *
 * A string is recorded as itself, any other value as JSON with object keys sorted. A value is kept
 * whole up to MAX_ADMIN_AUDIT_VALUE_LENGTH characters, more than any bounded setting holds; past
 * that both values are excerpts (see `excerpt`). A key is cut like an argument (see
 * MAX_ADMIN_AUDIT_ARG_LENGTH). No credential is a setting (provider keys and tokens live in the
 * environment), but a free-text setting such as the agent instructions is recorded as an admin
 * entered it. A logo is recorded as its size and SHA-256, never its bytes.
 */
export type AdminSettingChange = {
  /** The setting. */
  setting: string;
  /** The entry of a map or list setting: a model id, a vendor id, a blueprint id, a field name;
   * cut past MAX_ADMIN_AUDIT_ARG_LENGTH characters, a length no real entry's id reaches. */
  key?: string;
  /** The value before; absent when there was none. */
  before?: string;
  /** The value after; absent when the change removed it. */
  after?: string;
  /**
   * Present when a value was longer than MAX_ADMIN_AUDIT_VALUE_LENGTH. `before` and `after` are
   * then excerpts: each starts at character `offset` of its value, a little before the first
   * character at which the two differ, and holds at most MAX_ADMIN_AUDIT_VALUE_LENGTH characters.
   */
  excerpt?: {
    /** Where both excerpts start, in characters (UTF-16 code units) into their values. */
    offset: number;
    /** The whole `before` value's length, when there was one. */
    beforeLength?: number;
    /** The whole `after` value's length, when there is one. */
    afterLength?: number;
  };
};

/**
 * One change an admin made to the deployment's settings through an AdminApi method (see
 * ADMIN_SETTING_METHODS), recorded in the deployment-wide audit log before the change takes
 * effect, so that a change whose record cannot be written is refused. A call that changes nothing
 * records nothing. A record is kept if its change then fails to take effect (the setter throws):
 * it records the attempt.
 */
export type AdminSettingRecord = {
  /** The kind of audit record (see AdminAuditKind). */
  kind: "setting";
  /** When the change was made. */
  at: Date;
  /** The admin who made it, by canonical user id. */
  admin: string;
  /** Opaque. Shared by every record made through one AuthenticatedApi.getAdminApi() capability,
   * so one admin session's records can be read together. */
  sessionId: string;
  /** How the admin's calls reach the deployment (see AdminVia). */
  via: AdminVia;
  /** The AdminApi method called. */
  method: AdminSettingMethod;
  /** What it changed; never empty. */
  changes: AdminSettingChange[];
};

/** One record of the deployment-wide admin audit log, kept for the deployment's retention
 * (AdminSettingsView.adminAuditRetentionDays). */
export type AdminAuditRecord = AdminAccessRecord | AdminUserAccessRecord | AdminSettingRecord;

/** The kinds of AdminAuditRecord: "workspace" for access to a workspace, "user" for access to a
 * user's account, "setting" for a change to the deployment's settings. */
export type AdminAuditKind = AdminAuditRecord["kind"];

/** Options for AdminApi.listAdminAudit(). The filters combine. */
export type AdminAuditQuery = {
  /** Only records of this kind. */
  kind?: AdminAuditKind;
  /** Only this admin's records, by canonical user id. At most 1000 characters. */
  admin?: string;
  /** Only records of calls to this method. AdminWorkspaceView and AdminUserView share three method
   * names, describe, listBlueprints and getDiagnostics: `kind` tells their records apart. */
  method?: AdminAuditRecord["method"];
  /** Only records of access to this workspace. At most 1000 characters. */
  workspace?: string;
  /** Only records of access to this user's data: to workspaces they own
   * (AdminAccessRecord.workspaceOwner) and to their account (AdminUserAccessRecord.userId), by
   * canonical user id, whole or as the records keep it. At most 1000 characters. */
  owner?: string;
  /** Only records made at or after this time. */
  since?: Date;
  /** The previous page's `nextCursor`; absent for the first page. */
  cursor?: string;
  /** The page size: a whole number from 1 to ADMIN_LIST_MAX_LIMIT, ADMIN_LIST_DEFAULT_LIMIT when
   * absent. */
  limit?: number;
};

/** One page of AdminApi.listAdminAudit(). */
export type AdminAuditPage = {
  /** The page's records, newest first. */
  records: AdminAuditRecord[];
  /** Pass as `cursor` for the next page; absent once there is none. */
  nextCursor?: string;
};

/** The longest window AdminApi.getAdminAuditStats() reports on, in days. */
export const MAX_ADMIN_AUDIT_STATS_DAYS = 366;

/** Options for AdminApi.getAdminAuditStats(). */
export type AdminAuditStatsQuery = {
  /** The window: the last `days` UTC days, today included. A whole number from 1 to
   * MAX_ADMIN_AUDIT_STATS_DAYS, 7 when absent. */
  days?: number;
  /** Only records of this kind; every kind when absent. */
  kind?: AdminAuditKind;
};

/**
 * What the admin audit log holds for one window, from AdminApi.getAdminAuditStats(). Every count
 * covers the records of the queried kind (every kind when none is given). A record older than the
 * retention is gone, so a window reaching past it counts nothing there.
 */
export type AdminAuditStats = {
  /** The window's length in UTC days, today included. */
  days: number;
  /** The records in the window. */
  totalEvents: number;
  /** One entry per UTC day of the window, oldest first, days with no records included. `day` is
   * the date as YYYY-MM-DD. */
  byDay: { day: string; count: number }[];
  /** The admins with the most records in the window, most first (ties by id), at most 10. */
  topAdmins: { admin: string; count: number }[];
};

/**
 * Capability for managing and investigating the deployment, obtained via
 * AuthenticatedApi.getAdminApi() (which is null for non-admins). The access check happens when the
 * capability is minted, so these methods don't re-check, with one exception: inspectWorkspace()
 * and inspectUser() re-check, and so does every call on the view either mints (AdminWorkspaceView,
 * AdminUserView), since a view is the one thing an admin holds that reads users' data. Covers
 * branding, agent instructions, which gatekeeper connectors/resources are offered, the models an
 * AI Gateway deployment provides, the user and workspace directory, and admin access to
 * workspaces and to users' accounts — NOT authentication config (that's env-var driven). Each
 * setter throws on invalid input, and records the change it makes in the deployment's audit log
 * before making it (see AdminSettingRecord).
 */
export interface AdminApi {
  /** Read all admin-managed settings for the admin UI in one call. */
  getSettings(): Promise<AdminSettingsView>;

  /** Enable or disable new account signups. Existing users can still log in while signups are closed. */
  setSignupsEnabled(enabled: boolean): Promise<void>;

  /**
   * Enable or disable user directory search. The directory itself is maintained
   * either way, and this switch just controls user access.
   */
  setUserSearchEnabled(enabled: boolean): Promise<void>;

  /**
   * Set the site name shown next to the top-bar logo. Pass "" to reset to DEFAULT_SITE_NAME.
   * Rejects over MAX_SITE_NAME_LENGTH.
   */
  setSiteName(name: string): Promise<void>;

  /** Set the deployment logo from browser-rasterized PNG bytes and return its canonical public
   * image, or undefined after reset. Pass null to restore the default Cloudflare OS mark. The
   * caller must supply decodable PNG data; the server enforces its header, size, and dimensions. */
  setSiteLogo(data: Uint8Array | null): Promise<AvatarImage | undefined>;

  /** Replace the agent system-prompt instructions. Pass "" to clear. Rejects over MAX_INSTANCE_INSTRUCTIONS_LENGTH. */
  setInstanceInstructions(text: string): Promise<void>;

  /**
   * Replace the hosts `webFetch` may reach in a workspace that has observed restricted data. Each
   * entry is an exact host name, so a subdomain needs its own entry. Entries are trimmed and
   * lowercased, and duplicates and blank entries are dropped. Rejects an entry that is not an ASCII
   * host name, such as one with a scheme, port, path or wildcard. Resolves to the list as stored.
   */
  setRestrictedWebFetchHosts(hosts: string[]): Promise<string[]>;

  /** Set `AdminSettingsView.restrictedWebFetchApprovals`. */
  setRestrictedWebFetchApprovals(enabled: boolean): Promise<void>;

  /**
   * Enable or disable a single gatekeeper resource type, keyed by vendor ID + stable resource type ID.
   * Soft enforcement: disabling hides the resource from the connect UI, the resource picker, and the
   * agent; it doesn't revoke a capability a gadget already holds.
   */
  setResourceEnabled(vendorId: string, resourceTypeId: string, enabled: boolean): Promise<void>;

  /**
   * Set a gatekeeper's availability. For an auto-provisioning ("ambient") gatekeeper, `mode` is the
   * full three-state (disabled / optional / enabled); for an ordinary gatekeeper only 'disabled' /
   * 'enabled' are valid ('optional' is rejected). Soft enforcement: it doesn't revoke a capability a
   * gadget already holds, and 'disabled' leaves an ambient account's data dormant rather than deleting
   * it.
   */
  setGatekeeperMode(vendorId: string, mode: AmbientGatekeeperMode): Promise<void>;

  /**
   * Set the top-bar notice (centered text in the top navigation bar). Pass "" to clear. Rejects over
   * MAX_ANNOUNCEMENT_LENGTH.
   */
  setAnnouncement(text: string): Promise<void>;

  /**
   * Set the full-width banner. Pass an empty text to hide it. Rejects over MAX_ANNOUNCEMENT_LENGTH or
   * an invalid color.
   */
  setBanner(text: string, color: BannerColor): Promise<void>;

  /**
   * Set the deployment accent color (hex, e.g. "#3b82f6"). Pass "" to reset to the default theme.
   * Rejects an invalid hex color.
   */
  setAccentColor(color: string): Promise<void>;

  /**
   * Returns whether the blueprint is featured on the deployment. Returns null when the blueprint
   * can't be featured (e.g. it isn't a listable blueprint).
   */
  isBlueprintFeatured(blueprintId: string): Promise<boolean | null>;

  /** Mark or unmark a blueprint as featured on the deployment. */
  setBlueprintFeatured(blueprintId: string, featured: boolean): Promise<void>;

  // --- Standard output formats ---
  //
  // Promotion is what makes a blueprint one of the deployment's standard formats: offered in the
  // "New ..." menu and listed first for the agent. A blueprint declaring what it produces is
  // presentation, and never enough on its own.

  /**
   * Offer a blueprint as a standard format, appended last in menu order. Throws if the blueprint
   * doesn't exist. Promoting one that already is leaves its curation and menu position alone, so
   * that retrying a promotion whose mirror write failed repairs it rather than being refused.
   */
  promoteFormat(blueprintId: string): Promise<void>;

  /**
   * Stop offering a blueprint as a standard format, and forget the deployment's curation of it.
   * The blueprint itself is untouched.
   *
   * Refused for a bundled blueprint (see `AdminFormat.bundled`), which the deployment installed
   * and will reinstall: `enabled: false` withdraws it without discarding the admin's overrides,
   * hint and menu position.
   */
  removeFormat(blueprintId: string): Promise<void>;

  /**
   * Update one promoted format. Only the provided fields change. `agentHint: ""` clears the hint;
   * an `overrides` field set to null reverts that field to the blueprint's own declaration.
   */
  updateFormat(blueprintId: string, patch: AdminFormatPatch): Promise<void>;

  /** Reorder the menu. `blueprintIds` must be a permutation of the currently promoted ids. */
  setFormatOrder(blueprintIds: string[]): Promise<void>;

  // --- AI Gateway models ---
  //
  // The models the deployment provides through AI Gateway (AdminSettingsView.gatewayModels). Each
  // of these throws outside AI Gateway mode.

  /**
   * Set how the deployment offers one of its gateway models (see GatewayModelMode). Setting the
   * model's default mode forgets the override, so the model follows its default from then on.
   * Throws if `modelId` is not one of the deployment's gateway models.
   *
   * 'disabled' revokes nothing that is stored: the chats, spawners, preferences and gadget model
   * bindings that name the model keep naming it, and stop resolving for as long as it is disabled.
   */
  setGatewayModelMode(modelId: string, mode: GatewayModelMode): Promise<void>;

  /**
   * Add a model to the ones the deployment provides, 'enabled' by default and listed where its
   * provider's order puts it (see setGatewayModelOrder): after the provider's other models unless
   * the order names its ID. Throws if the model is malformed (an empty or over-long ID or name,
   * an over-long `behavesLike`, a token limit that isn't a positive integer), if the gateway does
   * not serve and enable its provider (see AdminSettingsView.gatewayModels), if a suggested or
   * added model already has its ID, if the model runtime does not know its `behavesLike` under
   * its provider, or if what its context window reserves for the response (its output limit, or
   * WORKERS_AI_OUTPUT_LIMIT for a Cloudflare model that gives none) leaves a prompt no room.
   */
  addGatewayModel(model: GatewayModel): Promise<void>;

  /**
   * Remove a model added with addGatewayModel(), along with its mode and settings. Throws if no
   * added model has this ID; a suggested model can't be removed, only disabled.
   *
   * Removing frees the ID rather than reserving it. The chats, spawners and preferences that name
   * the model resolve again if a model is later added under the same ID. A gadget model binding
   * minted for it carries its own provider and model, so while users may add their own models
   * (see setUserModelsEnabled) it runs once the model is removed, even if the model was disabled.
   * To shut a model off, disable it instead.
   */
  removeGatewayModel(modelId: string): Promise<void>;

  /**
   * Set whether users may add models of their own, which run through the deployment's gateway
   * like the models it provides. On by default.
   *
   * Off makes the deployment's models the only ones: a user can't add or edit a model, and the
   * models users added are neither listed nor resolved. A gadget model binding stops at its next
   * call unless a gateway model has its provider and model. Nothing stored is deleted, so the
   * models users added work again once this is back on.
   */
  setUserModelsEnabled(enabled: boolean): Promise<void>;

  /**
   * Set whether the admin UI may suggest models from models.dev while an admin adds one. Off by
   * default.
   *
   * The admin's browser reads the setting and, with it on, downloads models.dev's public model
   * list while an admin adds a model, to fill in the add-model form. It changes nothing the server
   * does: the server never contacts models.dev, and addGatewayModel() validates a suggested model
   * like any other.
   */
  setModelsDevSuggestions(enabled: boolean): Promise<void>;

  /**
   * Replace what the deployment sets for one of its gateway models (see GatewayModelSettings):
   * a field left out of `settings` is unset, and an empty `settings` unsets everything. Throws
   * if `modelId` is not one of the deployment's gateway models, or if the compaction budget is
   * not a positive whole number within the model's maximum (see
   * AdminModelView.maxCompactionInputBudget).
   *
   * The reasoning level may be one the model lacks, since it is fitted to the model when a
   * request is made (see ReasoningLevel).
   */
  setGatewayModelSettings(modelId: string, settings: GatewayModelSettings): Promise<void>;

  /**
   * Set the reasoning level of every gateway model that has none of its own, or null for each
   * model's built-in behaviour. It never applies to a model a user added.
   */
  setDefaultReasoning(level: ReasoningLevel | null): Promise<void>;

  /**
   * Turn a provider on or off beside the ones CF_AI_GATEWAY_PROVIDERS lists. On is the same as
   * listing it there: its suggested models appear in their default modes, models can be added
   * under it, and so can users' own while those are allowed. Throws for a provider the gateway
   * does not serve, and when turning off one that the variable lists: it is a floor, which an
   * admin adds to.
   *
   * Off takes the provider's models out of the deployment's and deletes nothing: their modes and
   * settings, and the models added under the provider, are kept for when it is back on. It stops
   * neither a model a user already added under the provider nor a gadget model binding already
   * minted for one of its models, which setUserModelsEnabled(false) does.
   */
  setGatewayProviderEnabled(provider: AiModelProvider, enabled: boolean): Promise<void>;

  /**
   * List the providers, and so their models, in the order `providers` gives: in the admin's and
   * users' model pickers, and for the default model, which is the first one enabled. Throws
   * unless `providers` lists each provider of AdminSettingsView.gatewayModels.providerSettings,
   * on or off, exactly once.
   *
   * A provider a later release adds follows the listed ones.
   */
  setGatewayProviderOrder(providers: AiModelProvider[]): Promise<void>;

  /**
   * List one provider's models in the order `modelIds` gives, which also decides the provider's
   * first model and so may change the default model (see setGatewayProviderOrder). Throws for a
   * provider the gateway does not serve or that is off, and unless `modelIds` lists each of the
   * provider's gateway models exactly once: suggested and added, in every mode.
   *
   * A model that joins the provider later, added or suggested by a later release, follows the
   * listed ones. A removed model keeps its place until the next call, so one added again under its
   * ID takes the place back.
   */
  setGatewayModelOrder(provider: AiModelProvider, modelIds: string[]): Promise<void>;

  /**
   * Send one small request to the first of a provider's SUGGESTED_MODELS through the gateway, as
   * the admin, and report what happened within 15 seconds: the Workshop can't see which provider
   * keys the gateway holds. It works on a provider that is off, and changes nothing. Throws for
   * a provider the gateway does not serve; a request that fails is a result (see
   * GatewayModelTest).
   *
   * A pass says that one model answered once. A 401 or 403 does not tell a provider key the
   * gateway lacks from a CF_AI_GATEWAY_API_TOKEN that may not run models. The request is a
   * quick one that takes none of a model's settings: testGatewayModel() sends a model the
   * request its chats would. Auto Router's alone carries a setting, the pool its model picks
   * from, allowed models included, since that decides which model answers.
   */
  testGatewayProvider(provider: AiModelProvider): Promise<GatewayModelTest>;

  /**
   * Send one request to a gateway model the way a chat turn would, through the gateway, as the
   * admin, and report what happened within 30 seconds. The request asks for the reasoning level
   * in effect for the model (its own, else the deployment's default, else what BuiltInReasoning
   * describes), with the capabilities stated for it and the flags of the model it behaves like,
   * under a response cap of at most 2,048 tokens. A level that a model takes as a token budget
   * comes out of that cap, so it is cut to the room the cap leaves and is smaller than a chat's.
   * It works on a model in any mode, hidden and disabled included, and changes nothing. Throws
   * outside AI Gateway mode and for an ID that names no gateway model; a request that fails is a
   * result (see GatewayModelTest).
   *
   * A pass says that the model answered that one request. It costs more than
   * testGatewayProvider(), whose quick request is capped at a few tokens.
   */
  testGatewayModel(modelId: string): Promise<GatewayModelTest>;

  /**
   * Test a model as described, without adding it. It sends one request the way a chat turn would
   * with no reasoning level set (so asking for what BuiltInReasoning describes, whatever the
   * deployment's default level is), and one at each reasoning level the model would list once
   * added (see AdminModelView.reasoningLevels). The requests are sent together, through the
   * gateway, as the admin, each under testGatewayModel()'s response cap and time limit. The
   * results come with the request that set no level first, then the levels from least to most.
   * It stores nothing. Throws outside AI Gateway mode and for a model addGatewayModel() would
   * refuse, for the same reason; a request that fails is a result (see GatewayModelLevelTest).
   *
   * A pass says that the model answered that one request. A model that lists every level is sent
   * eight requests, each of which may use the whole response cap.
   */
  testNewGatewayModel(model: GatewayModel): Promise<GatewayModelLevelTest[]>;

  /**
   * Whether a newer release is available. Null unless the deploy flow installed this deployment.
   * While automatic update checks are off (see setUpdateChecksEnabled) it asks no one and reports
   * the last check made for the running release, if any.
   */
  getUpdateStatus(): Promise<DeploymentUpdateStatus | null>;

  /**
   * Ask now for the newest release, whether or not automatic update checks are on, and return
   * the status that check produces. Null unless the deploy flow installed this deployment. Throws
   * when the check fails.
   */
  checkForUpdates(): Promise<DeploymentUpdateStatus | null>;

  /**
   * Set whether the deployment checks for updates by itself. On by default. When off,
   * getUpdateStatus() makes no outbound call and admins are never notified; checkForUpdates()
   * still asks.
   */
  setUpdateChecksEnabled(enabled: boolean): Promise<void>;

  /**
   * Set how many minutes a successful update check is relied on before the deployment asks again,
   * DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES by default. A failed check is retried after the interval
   * or 15 minutes, whichever is shorter. The deployment asks only while an admin is using it
   * (getUpdateStatus() makes the check when one is due), never on a schedule of its own. Throws
   * unless `minutes` is a whole number from 1 to MAX_UPDATE_CHECK_INTERVAL_MINUTES.
   */
  setUpdateCheckIntervalMinutes(minutes: number): Promise<void>;

  /**
   * Set how many hours a newer release must have been available before admins are notified of
   * it, DEFAULT_UPDATE_MINIMUM_AGE_HOURS by default. It delays the notice only: an update always
   * installs the newest release. 0 notifies as soon as a check reports an update. Throws unless
   * `hours` is a whole number from 0 to MAX_UPDATE_HOURS.
   */
  setUpdateMinimumAgeHours(hours: number): Promise<void>;

  /**
   * Set how many hours a dismissed update notice stays hidden in the browser that dismissed it,
   * DEFAULT_UPDATE_NOTICE_SNOOZE_HOURS by default. 0 means a closed notice comes back on the next
   * visit to Home. Throws unless `hours` is a whole number from 0 to MAX_UPDATE_HOURS.
   */
  setUpdateNoticeSnoozeHours(hours: number): Promise<void>;

  // --- Users, workspaces and admin access ---
  //
  // listUsers() and listWorkspaces() read the deployment-wide directory that user search reads
  // (see setUserSearchEnabled). Durable Objects cannot be enumerated, so the directory fills as
  // accounts and workspaces are used. An account is listed once it has started a session since the
  // directory began recording accounts for user search, so most are listed at once, without
  // `lastLogin` until their next session; one with no session since then is listed at its next. A workspace is listed when it is next opened. One never used again is never listed.

  /**
   * One page of the deployment's users, in id order: every account that has started a session
   * since the directory began recording accounts. Unaffected by setUserSearchEnabled(). A page
   * holds at most `limit` users and stops early, with a `nextCursor`, once their ids and names
   * would pass a million characters: an id has no length limit of its own, so a count alone cannot
   * bound a page. Rejects a `query` over 1000 characters or with a line break, and a `limit` that
   * is not a whole number from 1 to ADMIN_LIST_MAX_LIMIT.
   */
  listUsers(options?: AdminUserQuery): Promise<AdminUserPage>;

  /**
   * One page of the deployment's workspaces, in id order: every workspace opened since the
   * directory began recording workspaces, deleted ones left out. A page stops early as
   * listUsers()'s does, counting ids, titles and owners. Rejects what listUsers() rejects.
   */
  listWorkspaces(options?: AdminWorkspaceQuery): Promise<AdminWorkspacePage>;

  /**
   * Open a read-only view of a workspace to investigate it (see AdminWorkspaceView), at the
   * "metadata" level (see ADMIN_WORKSPACE_ACCESS_LEVELS). `reason` is required: it is recorded
   * with the open and with every call made through the view, and is rejected when blank or, once
   * trimmed, longer than MAX_ADMIN_ACCESS_REASON_LENGTH. The open is recorded as an
   * AdminAccessRecord ("inspectWorkspace") before the view is returned, so an open whose record
   * cannot be written is refused.
   *
   * Refused with a code from ADMIN_ACCESS_ERROR_CODES, checked in this order: `notAdmin` once the
   * caller is no longer a deployment admin; `workspaceNotFound` for a malformed id; `accessOff`
   * while the access level is "off", recorded in the deployment-wide log without the workspace
   * being reached; `workspaceNotFound` for an id that names no workspace (never initialised or
   * since deleted), which this neither creates nor claims; `viewExpired` should the view's
   * lifetime run out before the workspace answers. Only `accessOff` refusals are recorded.
   *
   * Admin access is a deliberate exception to observer verification (see docs/observers.md): the
   * admin is never verified against the workspace's connections nor registered as an observer, and
   * the audit log is the compensating control.
   */
  inspectWorkspace(workspaceId: string, reason: string, options?: AdminInspectOptions)
      : Promise<RpcStub<AdminWorkspaceView>>;

  /**
   * Open a read-only view of a user's account to investigate it (see AdminUserView), as
   * inspectWorkspace() opens one of a workspace: at the "metadata" level, with `reason` and
   * `options` under the same rules, and refused while the deployment's one access level
   * (AdminSettingsView.adminWorkspaceAccess.effective) is "off". `userId` is the user's canonical
   * id, exactly as listUsers() lists it. The open is recorded as an AdminUserAccessRecord
   * ("inspectUser") before the view is returned, so an open whose record cannot be written is
   * refused.
   *
   * Refused with a code from ADMIN_ACCESS_ERROR_CODES, checked in this order: `notAdmin` once the
   * caller is no longer a deployment admin; `userNotFound` for an empty id; `accessOff` while the
   * access level is "off", recorded in the deployment-wide log without the account being reached;
   * `userNotFound` for an id that names no account, which this does not create; `viewExpired`
   * should the view's lifetime run out before the account answers. Only `accessOff` refusals are
   * recorded.
   */
  inspectUser(userId: string, reason: string, options?: AdminInspectOptions)
      : Promise<RpcStub<AdminUserView>>;

  /**
   * One page of the deployment-wide admin audit log, newest first, filtered as `options` says. It
   * holds access to workspaces and to users' accounts, and changes to settings. Rejects a `limit`
   * that is not a whole number from 1 to ADMIN_LIST_MAX_LIMIT, a filter over 1000 characters, and a
   * malformed `cursor`.
   */
  listAdminAudit(options?: AdminAuditQuery): Promise<AdminAuditPage>;

  /** Counts from the admin audit log over the last `days` UTC days, today included (7 by
   * default). Throws unless `days` is a whole number from 1 to MAX_ADMIN_AUDIT_STATS_DAYS. */
  getAdminAuditStats(options?: AdminAuditStatsQuery): Promise<AdminAuditStats>;

  /**
   * Set whether inspectWorkspace() and inspectUser() may show a workspace's and a user account's
   * metadata (see ADMIN_WORKSPACE_ACCESS_LEVELS), DEFAULT_ADMIN_WORKSPACE_ACCESS by default.
   * Throws for a value that is not a level, and for a level above the deployment's maximum
   * (AdminSettingsView.adminWorkspaceAccess.max), which only its ADMIN_WORKSPACE_ACCESS_MAX
   * environment variable can raise. "off" reaches a view already minted, of either kind, from its
   * next call once the setting reaches it, within about a minute; a view still within its
   * lifetime answers again once the level is back at "metadata".
   */
  setAdminWorkspaceAccess(access: AdminWorkspaceAccess): Promise<void>;

  /**
   * Set how many days the admin audit log keeps a record, DEFAULT_ADMIN_AUDIT_RETENTION_DAYS by
   * default. A record older than that is no longer listed or counted, and is deleted as the log is
   * next used. Throws
   * unless `days` is a whole number from the deployment's minimum
   * (AdminSettingsView.adminAuditRetentionDays.min, set by its ADMIN_AUDIT_RETENTION_MIN_DAYS
   * environment variable) to MAX_ADMIN_AUDIT_RETENTION_DAYS.
   */
  setAdminAuditRetentionDays(days: number): Promise<void>;

  /** 获取平台所有用户的行为与 Token 消耗用量统计 */
  getUsageStats(): Promise<UsageStatsResponse>;
}

/** A workspace as AdminWorkspaceView.describe() presents it. */
export type AdminWorkspaceDescription = Pick<WorkspaceMetadata,
    "id" | "title" | "totalCost" | "containsRestrictedData" | "ownerInvitesOnly" |
    "defaultGadgetId"> & {
  /** The owner's profile. */
  owner: AiChatAuthorInfo;
  /** Every workpiece summary a "build" session sees (see WorkpieceSummary): gadgets, pending ones
   * included, and worktrees. A gadget's `upstream` is left out: a blueprint id is a share link
   * to that blueprint's code. */
  workpieces: WorkpieceSummary[];
  /** Everyone the workspace is shared with, as Overseer.listCollaborators() lists them. */
  collaborators: CollaboratorInfo[];
  /** When this view stops working. */
  expiresAt: Date;
};

/** One connection (gatekeeper workpiece) of a workspace, as AdminWorkspaceView.listGatekeepers()
 * lists it. */
export type AdminGatekeeperInfo = {
  /** Its workpiece id. */
  id: WorkpieceId;
  /** The connected resource's title, as the workspace records it. */
  resourceTitle?: string;
  /** The connected resource's URL, when known. */
  resourceUrl?: string;
  /** The vendor whose gatekeeper serves it. Absent for one with no vendor (a model, a spawner). */
  vendorId?: string;
  /** How it was created, without the `configuration` an agent suggested for it. Absent for one
   * created before this was recorded. */
  creationSpec?: GatekeeperCreationSpec;
  /** Who created it: the member who added it, or whoever started the agent turn that created its
   * resource. Absent for an ambient connection (`creationSpec.type` "ambient"), which the
   * workspace takes from a singleton account its owner holds and no person creates, and for a
   * connection whose creator was not recorded, as one made before creators were recorded. */
  createdBy?: AiChatAuthorInfo;
  /** The gadget bindings that point at it. `chatId` is present while one is pending in that chat. */
  bindings: { gadgetId: WorkpieceId; name: string; chatId?: number }[];
  /** The hooks it delivers, as Overseer.listHooks() lists them, each with an empty
   * `description.description`. */
  hooks: BoundHookInfo[];
};

/** A workspace's operational state, as AdminWorkspaceView.getDiagnostics() reports it. None of it
 * is content. */
export type AdminWorkspaceDiagnostics = {
  /** The version of the workspace's storage schema. */
  storageVersion: number;
  /** When the workspace's current Durable Object instance started. */
  instanceStartedAt: Date;
  /** What collaborators hold on the workspace now, by role: a count of holds, not of people. Each
   * open session counts once, and so does each capability or subscription one keeps from it, and
   * each piece of work under way for a collaborator (an admission being verified, an agent turn
   * resumed for them). Zero means no collaborator of that role is connected; `present` lists who
   * is. The owner's sessions and admin views are never counted. */
  sessions: { build: number; use: number };
  /** The chats with an agent turn recorded, running or paused; getChatState() says which. */
  activeAgentChatIds: number[];
  /** Calls to callable agents recorded but not yet in their chat. */
  pendingAgentCalls: number;
  /** Actions waiting for approval. */
  pendingActions: number;
  /** The workspace's chats. */
  chats: number;
  /** The workspace's hooks, and how many are enabled. */
  hooks: { total: number; enabled: number };
  /** How many collaborators hold an observer record (see AdminObserver, which says what one
   * means); listObservers() lists them. */
  observers: number;
  /** The size of the workspace's storage, in bytes. */
  storageBytes: number;
  /** Who has the workspace open now, as its presence roster lists them (see
   * Overseer.subscribeToPresence()). An admin view is never among them. */
  present: PresenceParticipant[];
  /** When the workspace's alarm next fires. Absent while none is set. */
  nextAlarm?: Date;
  /** Whether an external message created the workspace before its owner's account recorded it. */
  ownerRegistrationPending: boolean;
};

/** One call made on a chat's callable agent that is not in the chat yet, as
 * AdminChatState.queuedCalls lists it. Its arguments, which its caller wrote, are not shown. */
export type AdminQueuedAgentCall = {
  /** Its id, unique in the workspace. A chat's calls reach it in id order. */
  callId: number;
  /** The method called on the agent. */
  methodName: string;
  /** The model the call's turn is to run on. Null when the agent's spawner names none. */
  initiatorModelId: string | null;
};

/**
 * What a workspace records of one chat's agent turn and of what waits on the chat, as
 * AdminWorkspaceView.getChatState() reports it: the state behind a chat that looks stuck. The
 * chat's title, token counts, cost and code pins are in listChats().
 */
export type AdminChatState = {
  /** The agent turn recorded for the chat: one running, or one paused. Absent when no turn is
   * recorded. */
  turn?: {
    /** The model the turn runs on. */
    modelId: string;
    /** Who started the turn: a user, or a gadget whose spawner or call started it. */
    initiator: AiChatAuthorInfo;
    /** Whether a call to the agent started the turn, rather than a chat message. */
    callbackInitiated: boolean;
    /** How many times the workspace has looked up the turn's model since it last prepared the
     * turn to run. It grows while restarts keep finding the turn unfinished. */
    resumeAttempts: number;
    /** Whether the turn is paused: recorded, while the chat names no agent as responding
     * (AiChatMetadata.activeAgent), as when it waits for a decision on an action. */
    paused: boolean;
  };
  /** When the newest entry of the chat's log was written (a message, an agent step, a change, an
   * action): the only time the workspace keeps of a turn's progress. Absent for a chat with no
   * entry. */
  lastMessageAt?: Date;
  /** The calls made on the chat's agent that are not in the chat yet, oldest first. */
  queuedCalls: AdminQueuedAgentCall[];
  /** The ids of the actions waiting for approval that were submitted from the chat, oldest first;
   * listActions() holds each. */
  pendingActionIds: number[];
};

/** One attachment of a chat message, as AdminWorkspaceView.listChatAttachments() lists it: the
 * message's ChatAttachmentRef without its bytes. Its `oid` is a hash of those bytes, so it tells
 * whether two attachments are the same file; like the name, the type and the size, it is
 * metadata. */
export type AdminChatAttachment =
    Pick<ChatAttachmentRef, "id" | "oid" | "mimeType" | "name" | "size"> & {
  /** The sequence of the message it is attached to (AiChatMessage.sequence). */
  sequence: number;
};

/**
 * One gadget or worktree a chat holds changes to that are not accepted yet, as
 * AdminWorkspaceView.listPendingChanges() lists it, with the paths the chat's current content
 * changes against the commit those changes apply on top of. Paths are names: the view returns no
 * file's content.
 */
export type AdminPendingChange = {
  /** The gadget or worktree. */
  gadgetId: WorkpieceId;
  /** The commit the chat's changes to it apply on top of (ChatGadgetPin.baseCommit). Absent for a
   * gadget the chat created that is not accepted yet: it has no commit, and each of its files is
   * in `added`. */
  baseCommit?: string;
  /** The accepted code the chat's content includes (ChatGadgetPinState.mergedCommit). Absent
   * with `baseCommit`. Accepting changes the workpiece from this commit to the chat's content,
   * while the paths here compare that content with `baseCommit`. So where the two commits
   * differ, as when the pin is rooted at a merge commit (after an update from mainline, or for a
   * proposed blueprint merge) or is a worktree's pin an agent step re-rooted,
   * listChangedPaths(mergedCommit, baseCommit) is the rest of the comparison, and the three lists
   * can be empty while there is a change to accept. */
  mergedCommit?: string;
  /** The paths the chat's content holds that `baseCommit` lacks, sorted. */
  added: string[];
  /** The paths whose content differs from `baseCommit`'s, sorted. */
  modified: string[];
  /** The paths `baseCommit` holds that the chat's content lacks, sorted. */
  removed: string[];
};

/** The account an observer chose for one connection, as AdminObserver.accountChoices lists it. */
export type AdminObserverAccountChoice = ObserverAccountChoice & {
  /** The vendor whose gatekeeper serves the connection, in lower case as
   * AdminGatekeeperInfo.vendorId gives it (ObserverBindingNeed.vendorId keeps the vendor's own
   * spelling). Absent once the connection is removed. */
  vendorId?: string;
};

/**
 * One collaborator who holds an observer record, as AdminWorkspaceView.listObservers() lists
 * them. A workspace reserves the record when a collaborator first opens what was shared with them
 * while a connection it reaches needs an account, before anything is verified, and keeps it until
 * they lose access, whether or not that open was admitted (see docs/observers.md). So a record
 * does not say its holder was admitted: `accountChoices` says what was verified.
 */
export type AdminObserver = {
  /** Who they are: their profile as the workspace's collaborator list keeps it, or one made of
   * their id alone when it keeps none. */
  profile: AiChatAuthorInfo;
  /** The account they chose for each connection, by connection id, each recorded once an
   * admission verified it. Empty means nothing is verified yet: no admission of theirs has
   * passed. An entry is what an admission verified then, and every open checks it again. An
   * `accountId` names a connected account in their own user account, so the workspace knows its
   * id and nothing else of it. */
  accountChoices: AdminObserverAccountChoice[];
};

/**
 * One auto-approval rule of a workspace, as AdminWorkspaceView.listAutoApprovals() lists it: a
 * member's opt-in for actions of `actionKind` on the connection. A rule alone applies nothing. An
 * action of that kind is applied without a manual approval only when its author also marked it
 * `autoApprovable` (ActionDescription.autoApprovable), and never once the workspace has read
 * restricted data (`containsRestrictedData`, which describe() reports): the rule then stays
 * stored, and listed here, while every action waits for a manual approval.
 */
export type AdminAutoApproval = {
  /** The connection the rule is on. */
  gatekeeperId: WorkpieceId;
  /** The kind of action the rule covers. An action matches by its kind's `tag`. */
  actionKind: ActionKind;
  /** Who turned the rule on. The actions it applies are applied under their authority. */
  enabledBy: AiChatAuthorInfo;
};

/**
 * A deployment admin's read-only view of one workspace's metadata, minted by
 * AdminApi.inspectWorkspace(). Nothing it does changes the workspace or is seen by its members:
 * it joins no presence and no session count, and starts no agent or connection. It returns what
 * the "metadata" access level shows (see ADMIN_WORKSPACE_ACCESS_LEVELS) and none of what that
 * level withholds: no method returns a chat's messages, an attachment's bytes or a file's
 * content.
 *
 * Each call first passes three checks, refused unrecorded with a code from
 * ADMIN_ACCESS_ERROR_CODES: the view has not expired (`viewExpired`), its admin is still a
 * deployment admin (`notAdmin`), and the workspace still exists (`workspaceNotFound`). It then
 * reads the deployment's access level (AdminSettingsView.adminWorkspaceAccess.effective), which
 * reaches live views within about a minute of a change. While that is "off" the call is
 * recorded and refused (`accessOff`), having read nothing. Any other call reads its answer,
 * never through a connection: what a connection supplied is read only as the workspace stores
 * it (the commits of a worktree checked out through one are that repository's), and the
 * connection is not asked. It is then recorded as an AdminAccessRecord in the deployment-wide
 * log. Only then is the call answered: nothing it read leaves the server before its record
 * exists, and a call whose record cannot be written fails and returns nothing. The checks run
 * again once the call has read the deployment's setting, and again once it has read its answer,
 * just before it writes. So a call that expiry, a demotion or the workspace's deletion overtakes
 * while it reads writes nothing. A call whose read fails is recorded as an attempt, and fails
 * with the read's error.
 *
 * A workspace restart (a revocation, a deletion, a redeploy) ends the view along with every other
 * session on the workspace; inspect again.
 */
export interface AdminWorkspaceView extends RpcTarget {
  /** The workspace's metadata, owner, workpieces and collaborators, with the view's expiry. */
  describe(): Promise<AdminWorkspaceDescription>;

  /** The workspace's chats, newest first, as Overseer.listChats() lists them, without
   * `queuedSteers`, which hold message text. */
  listChats(): Promise<AiChatMetadata[]>;

  /** What is recorded of a chat's agent turn, its newest entry, the calls queued for its agent
   * and its pending actions (see AdminChatState). Throws for an id that names no chat. */
  getChatState(chatId: number): Promise<AdminChatState>;

  /** The attachments of a chat's messages, oldest message first, without their bytes. Their
   * names, types, sizes and content hashes (`oid`) are metadata, as titles are. Empty for an id
   * that names no chat. */
  listChatAttachments(chatId: number): Promise<AdminChatAttachment[]>;

  /**
   * One page of the workspace's action log, as Overseer.listActions() pages it. Admin access is
   * never in it (see AdminAccessRecord). Every action, observation and hook entry has an empty
   * `description.description` and no `description.fields`: titles, states, resources and times
   * remain.
   */
  listActions(options?: { beforeId?: number; filter?: ActionHistoryFilter })
      : Promise<ActionHistoryPage>;

  /**
   * The tree at a committed head, as Overseer.listTree() gives it, read only from the objects the
   * workspace stores. It never pulls through a connection, and throws when an object is missing.
   * Only a permanent gadget has a head to read: throws for a pending gadget, a worktree, or an id
   * that names no gadget.
   */
  listFiles(gadgetId: WorkpieceId): Promise<TreeNode[]>;

  /**
   * The history of a stored commit, as Overseer.getCommitLog() walks it: `fromCommit` first, then
   * its ancestry, at most `depth` commits (a whole number from 1 to MAX_ADMIN_COMMIT_LOG_DEPTH,
   * DEFAULT_ADMIN_COMMIT_LOG_DEPTH when absent). Any commit the workspace stores can start it: a
   * gadget's head (WorkpieceSummary.commitId), a worktree's commits, a chat pin's base. Read only
   * from the objects the workspace stores: a parent that is not stored, as below the commit a
   * worktree was checked out at, ends that line of the walk and is never pulled. Each `message`
   * is "": a commit message describes its change.
   */
  getCommitLog(fromCommit: string, depth?: number): Promise<CommitInfo[]>;

  /** The tree at any stored commit, read as listFiles() reads a committed head. Any commit the
   * workspace stores can be read: a version in a gadget's history, a worktree's commit, a chat
   * pin's base. Throws for an id that names no stored commit, and when an object is missing. */
  listFilesAtCommit(commitId: string): Promise<TreeNode[]>;

  /** The paths that differ between two stored commits, as Overseer.listChangedPaths() lists
   * them, read only from stored objects. Paths are names: the view returns no file's content. */
  listChangedPaths(fromCommit: string, toCommit: string): Promise<string[]>;

  /**
   * The paths a chat's current content adds, modifies and removes against each pin's base, per
   * workpiece it holds changes to (see AdminPendingChange), in workpiece id order. A workpiece
   * here is a gadget or a worktree; a gadget the chat created that is not accepted yet has no
   * pin, and lists every file as added. It is what the chat changed on top of each base, which is
   * not always all that accepting would change (see AdminPendingChange.mergedCommit). Folded from
   * the chat's content, edits not yet recorded in a message included, and the objects the
   * workspace stores. Throws for an id that names no chat.
   */
  listPendingChanges(chatId: number): Promise<AdminPendingChange[]>;

  /** The workspace's connections, oldest first, with their creators, bindings and hooks. */
  listGatekeepers(): Promise<AdminGatekeeperInfo[]>;

  /** The collaborators holding an observer record, with the account each chose for each
   * connection (see AdminObserver). A record with no choice is one whose admission has not
   * passed: nothing is verified for that collaborator yet. */
  listObservers(): Promise<AdminObserver[]>;

  /** The connections a recipient of `grant` would have to pass before opening what it grants, as
   * Overseer.listObserverRequirements() lists them. It is what sharing the workspace, or one
   * gadget, asks of the recipient: an account that each of those connections verifies. Read from
   * the workspace's own records: no connection is asked. Throws for a gadget that cannot be
   * shared, and when a connection `grant` reaches was made before connections could verify
   * collaborators: any such connection for "workspace", and for a gadget only one it reaches. */
  listObserverRequirements(grant: CollaboratorGrant): Promise<ObserverBindingNeed[]>;

  /** The active share links, as Overseer.listShareLinks() lists them. Each has its id, note,
   * creator, role, the gadget or gadgets it grants and whether it is its creator's default link,
   * and never a key that redeems it. */
  listShareLinks(): Promise<ShareLinkInfo[]>;

  /** The auto-approval rules, each with its connection, its kind of action and who turned it on.
   * A rule is a member's opt-in and applies nothing alone (see AdminAutoApproval): an action is
   * applied without a manual approval only when its author also marked it `autoApprovable`, and
   * never once the workspace has read restricted data (`containsRestrictedData`, which
   * describe() reports), when every action waits whatever the rules say. listActions() shows
   * each action's `description.autoApprovable` and `description.actionKind`, and `autoApproved`
   * on one a rule applied. */
  listAutoApprovals(): Promise<AdminAutoApproval[]>;

  /** The published blueprints, as Overseer.listBlueprints() lists them. Each `id` is "" and
   * `screenshotUrl` is left out: a blueprint's id is a share link to its code. Titles and
   * descriptions stay, as a workspace's title does. */
  listBlueprints(): Promise<BlueprintGadgetSummary[]>;

  /** The workspace's operational state. Admin access records are not part of it: they are kept
   * only in the deployment-wide log (AdminApi.listAdminAudit()). */
  getDiagnostics(): Promise<AdminWorkspaceDiagnostics>;
}

/** A user's account as AdminUserView.describe() presents it. */
export type AdminUserDescription = {
  /** The user's profile, as AuthenticatedApi.whoami() gives it to them; `id` is their canonical
   * user id. */
  profile: AiChatAuthorInfo;
  /** When the account was created. Absent for one created before the deployment recorded it. */
  created?: Date;
  /** When the user last started a session, as the account last told the deployment directory: to
   * within an hour, as AdminUserRecord.lastLogin is. Absent until it has told it of one. */
  lastLogin?: Date;
  /** Whether the user is a deployment admin at the time of the call: named in the deployment's
   * ADMINS variable. */
  isAdmin: boolean;
  /** Whether the account has a password to sign in with; false for one that signs in through a
   * provider or Cloudflare Access. */
  hasPassword: boolean;
  /** Whether the user has finished onboarding. */
  onboardingCompleted: boolean;
  /** How many of each thing the account holds; the view's list methods give the things. */
  counts: {
    /** Workspaces the user owns, the provisional ones included (see
     * AdminUserView.listWorkspaces()). */
    ownedWorkspaces: number;
    /** Workspaces shared with the user that they have opened. */
    sharedWorkspaces: number;
    /** Connected accounts. */
    connectedAccounts: number;
    /** Models the user added. */
    models: number;
    /** Sign-in sessions. */
    sessions: number;
    /** Blueprints of the user's own: those listBlueprints() lists as "published" or
     * "imported". */
    ownBlueprints: number;
    /** Blueprints in the user's library: those listBlueprints() lists as "uploaded" or
     * "added". */
    libraryBlueprints: number;
  };
  /** When this view stops working. */
  expiresAt: Date;
};

/** One workspace a user's account lists, as AdminUserView.listWorkspaces() lists it: what the
 * account itself records of it. */
export type AdminUserWorkspace = Pick<WorkspaceMetadata,
    "title" | "totalCost" | "notificationMute"> & {
  /** The workspace's id, as AdminApi.inspectWorkspace() takes it. */
  id: WorkspaceMetadata["id"];
  /** Who owns the workspace, when it is shared with the user. Absent for one the user owns. */
  owner?: WorkspaceMetadata["owner"];
  /** The user's role in a workspace shared with them. Absent for one the user owns. */
  role?: WorkspaceMetadata["role"];
  /** When the account first recorded the workspace: its creation for one the user owns, the
   * user's first open of it for one shared with them. */
  created: Date;
  /** When it was last active or, for one shared with the user, when they last opened it. Absent
   * for a provisional workspace (see AuthenticatedApi.newWorkspace()): one the user owns that has
   * had no activity yet, which the user's own listing, AuthenticatedApi.listWorkspaces(), leaves
   * out. */
  lastActive?: Date;
};

/** One connected account of a user, as AdminUserView.listConnectedAccounts() lists it. What its
 * gatekeeper says of it (AccountDescription: its display names, avatar, granted resource types
 * and what it provides) is not shown: it is the gatekeeper's own text, and a name in it can
 * carry a secret (an address with its token, say). */
export type AdminUserConnectedAccount = {
  /** Its id among the user's connected accounts, as AuthenticatedApi.disconnectAccount() takes
   * it. */
  id: number;
  /** The vendor whose gatekeeper holds it. */
  vendorId: string;
  /** Whether the Workshop created it with no OAuth flow (see
   * VendorDescription.autoProvisionsAccount), rather than the user connecting it. */
  autoProvisioned: boolean;
  /** When its credentials are expected to expire, if its gatekeeper said. */
  credentialExpiresAt?: Date;
  /** Whether its gatekeeper has reported its credentials expired. */
  credentialsExpired: boolean;
};

/** A model a user added to their account, as AdminUserView.listModels() lists it. Its API token
 * and extra headers are credentials and are never returned. Nor is its API URL: that is free
 * text, not a credential, but a URL can carry one, so only whether one is set is reported. */
export type AdminUserModel = {
  /** The model's id among the user's models, as chats name it. */
  id: string;
  /** The display name the user gave it. */
  name: string;
  /** The provider that hosts it. */
  provider: AiModelProvider;
  /** The model's name, as given to the provider's API. */
  model: string;
  /** Whether it overrides the provider's API URL (AiModelConfig.apiUrl). */
  customApiUrl: boolean;
};

/** A user's model settings, as AdminUserView.listModels() reports them. */
export type AdminUserModels = {
  /** The models the user added, in id order. A deployment's own AI Gateway models are not among
   * them (see AdminSettingsView.gatewayModels). */
  models: AdminUserModel[];
  /** The id of the model the user prefers (AuthenticatedApi.setPreferredModel()), as stored: it
   * may name one no longer offered. Null while none is set. */
  preferredModel: string | null;
  /** The id of the model the user chose for quick tasks such as chat titles
   * (AuthenticatedApi.setQuickModel()), as stored. Null while none is set. */
  quickModel: string | null;
};

/** One sign-in session of a user, as AdminUserView.listSessions() lists it. Never its token, nor
 * the token's hash. */
export type AdminUserSession = {
  /** When it was created: a sign-in, or the staging of a device session. */
  created: Date;
  /** When it stops working. Only a device session has one: a session a password or provider
   * sign-in made, the CLI's included, does not expire. */
  expiresAt?: Date;
  /** Present on a device session staged for a handoff its device has not completed: when that
   * handoff lapses. It cannot sign in meanwhile. */
  pendingUntil?: Date;
};

/** A user's sign-in sessions, as AdminUserView.listSessions() reports them. An account behind
 * Cloudflare Access holds none. */
export type AdminUserSessions = {
  /** How many sessions the account holds. */
  total: number;
  /** The latest ADMIN_LIST_MAX_LIMIT of them, latest first. */
  sessions: AdminUserSession[];
};

/** One blueprint a user's account holds, as AdminUserView.listBlueprints() lists it. Its id is
 * not shown: a blueprint's id is a share link to its code, which is why
 * AdminWorkspaceView.listBlueprints() withholds a workspace's too. */
export type AdminUserBlueprint = {
  /** How the account holds it. Of the user's own blueprints: "published" from one of their
   * workspaces, or "imported" for one that names no workspace (BlueprintSource's "imported"). Of
   * their library: "uploaded" by the user, or "added" by its id, which may be any blueprint's. */
  held: "published" | "imported" | "uploaded" | "added";
  /** Its title. */
  title: string;
  /** Its version as the account records it; each update increments it. */
  version: number;
  /** When that version was released. */
  lastUpdated: Date;
  /** For a published one, the workspace it was published from, whether or not that still
   * exists. */
  workspaceId?: string;
  /** For one of the user's own ("published" or "imported"), whether it is featured
   * deployment-wide. */
  featured?: boolean;
};

/** A user account's operational state, as AdminUserView.getDiagnostics() reports it. The billing
 * account's id, its credit balance and the daily count of model calls are metadata. */
export type AdminUserDiagnostics = {
  /** When the account's alarm next fires. Absent while none is set. */
  nextAlarm?: Date;
  /** Connect, reconnect and grant flows the user started that have neither finished nor lapsed
   * (see ConnectFlowStart): a lapsed one the account has yet to sweep is not counted. */
  pendingConnectFlows: number;
  /** Sign-ins staged for a native app that the app has neither completed nor let lapse (see
   * AuthenticatedApi.beginDeviceSessionHandoff()), counted as pendingConnectFlows is. */
  pendingDeviceHandoffs: number;
  /** The devices registered for the user's push notifications. */
  pushDevices: {
    /** Phones. */
    phones: number;
    /** Browsers. */
    browsers: number;
  };
  /** Notifications the account accepted from workspaces and has yet to deliver. */
  queuedNotifications: number;
  /** The model calls counted against the user's daily allowance on `day` (a UTC date,
   * YYYY-MM-DD), on a deployment that applies Cloudflare usage limits. Absent until one is
   * counted; a `day` before today counts as none. */
  dailyModelCalls?: {
    /** The UTC date counted. */
    day: string;
    /** The calls counted on it. */
    count: number;
  };
  /** The Cloudflare account the user's AI Gateway usage is billed to. Absent until the user
   * connects one. */
  billing?: {
    /** The account's id, once one is chosen. */
    accountId?: string;
    /** Its credit balance in US dollars as last fetched; absent when unknown. */
    creditsRemaining?: number;
    /** When that balance was fetched. */
    creditsUpdatedAt?: Date;
  };
};

/**
 * A deployment admin's read-only view of one user's account, minted by AdminApi.inspectUser(). It
 * reads only what the account itself stores, and nothing it does changes the account or is seen by
 * its user: it writes nothing there, starts no session, leaves the user's last login and the
 * deployment directory alone, sets no alarm, and never calls a gatekeeper, a connected account's
 * own included. No method connects, disconnects, renames or deletes anything. One effect is the
 * wake's and not the view's: reaching an account whose Durable Object was asleep wakes it, and any
 * wake delivers the notifications already queued for the user and re-arms a missing alarm.
 *
 * Each call runs as an AdminWorkspaceView call does, in the same order: the same checks, refused
 * unrecorded (`viewExpired`, `notAdmin`, and `userNotFound` should the account be gone), then the
 * deployment's access level, read as that view reads it. While that is "off" the call is recorded
 * and refused, having read nothing (`accessOff`); any other call reads its answer, is recorded as
 * an AdminUserAccessRecord, and only then answers.
 *
 * It returns what the "metadata" access level shows of an account (see
 * ADMIN_WORKSPACE_ACCESS_LEVELS) and none of what that level withholds: no method returns what a
 * gatekeeper says of a connected account (see AdminUserConnectedAccount) or a blueprint's id (see
 * AdminUserBlueprint). Nor does any return what the account stores as a credential: a session
 * token or its hash, the password's hash, a model's API token or extra headers, a push
 * subscription, or a pending connect or sign-in ticket. A model's API URL is free text, not a
 * credential, but a URL can carry one, so only whether one is set is reported
 * (AdminUserModel.customApiUrl). A restart of the account's Durable Object ends the view; inspect
 * again.
 */
export interface AdminUserView extends RpcTarget {
  /** The account's profile, when it was created and last signed in, whether its user is a
   * deployment admin, and how much it holds, with the view's expiry. */
  describe(): Promise<AdminUserDescription>;

  /** The workspaces the account lists, in id order: those the user owns, and those of other users
   * that they have opened as a collaborator. The user's provisional workspaces are among them,
   * each with no `lastActive`: the user's own listing, AuthenticatedApi.listWorkspaces(), leaves
   * those out, so this lists more than their home page shows. */
  listWorkspaces(): Promise<AdminUserWorkspace[]>;

  /** The user's connected accounts, in id order, without what each one's gatekeeper says of it
   * (see AdminUserConnectedAccount). */
  listConnectedAccounts(): Promise<AdminUserConnectedAccount[]>;

  /** The models the user added, and the ones they chose. */
  listModels(): Promise<AdminUserModels>;

  /** The account's sign-in sessions, latest first. */
  listSessions(): Promise<AdminUserSessions>;

  /** The blueprints the account holds: the user's own, then those in their library, without
   * each one's id (see AdminUserBlueprint). */
  listBlueprints(): Promise<AdminUserBlueprint[]>;

  /** The account's operational state. */
  getDiagnostics(): Promise<AdminUserDiagnostics>;
}

/** 单个用户的 Token 消耗与行为用量记录 */
export type UserUsageRecord = {
  /** 用户唯一标识（通常为 username 或 email） */
  username: string;
  /** 用户对外昵称 */
  displayName: string;
  /** 首次注册/进入系统时间 (ISO string) */
  createdAt: string;
  /** 最近一次交互或登录活跃时间 (ISO string) */
  lastActive: string;
  /** 累计消耗的 Token 总量 */
  totalTokens: number;
  /** 累计预估模型调用成本 (USD) */
  estimatedCost: number;
  /** 累计执行的 AI 会话交互轮次 */
  callCount: number;
  /** 累计创建的剧本/工作区总数 */
  workspaceCount: number;
};

/** 平台全局汇总用量概览 */
export type UsageOverviewStats = {
  totalUsers: number;
  totalWorkspaces: number;
  totalTokens: number;
  totalCost: number;
  totalCalls: number;
};

/** 用量统计总响应体 */
export type UsageStatsResponse = {
  overview: UsageOverviewStats;
  users: UserUsageRecord[];
};

