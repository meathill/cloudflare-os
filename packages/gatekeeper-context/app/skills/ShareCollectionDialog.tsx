import {
  Banner,
  Button,
  Dialog,
  DropdownMenu,
  Loader,
  Text,
} from "@cloudflare/kumo";
import { Buildings, CaretDown, User, Warning, WarningCircle, X } from "@phosphor-icons/react";
import { RpcTarget } from "capnweb";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ContextApi,
  ContextCollectionMember,
  ContextCollectionPermissions,
  ContextCollectionRole,
  ContextCollectionSharing,
} from "../../src/context-types";
import {
  useContextApi,
  useSelectUsers,
  type UserSelection,
  type UserSelectionReceiver,
} from "../bridge";
import { COLLECTION_ROLE_LABELS } from "./collectionRole";
import { LeaveCollectionDialog } from "./LeaveCollectionDialog";
import { useMutationDialog } from "./useMutationDialog";

type ShareCollectionDialogProps = {
  collection: { id: string; title: string };
  /** Sharing changed while the dialog was open; listings may need new labels. */
  onChanged: () => void;
  /** The viewer removed their own membership. */
  onLeft: () => void;
  onClose: () => void;
};

type ShareState = {
  sharing: ContextCollectionSharing;
  permissions: ContextCollectionPermissions;
};

const MEMBER_ROLE_LABELS: Record<ContextCollectionRole, string> = {
  viewer: "可查看",
  editor: "可编辑",
  owner: "所有者",
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * Shares the collection with each person picked during one picker session. The collection and role
 * are fixed when the picker opens, so changing the role control while it is open cannot change what
 * later picks receive.
 */
class CollectionShareReceiver extends RpcTarget implements UserSelectionReceiver {
  readonly #context: Pick<ContextApi, "shareContextCollection">;
  readonly #collectionId: string;
  readonly #role: ContextCollectionRole;
  readonly #onSettled: () => void;

  constructor(
    context: Pick<ContextApi, "shareContextCollection">,
    collectionId: string,
    role: ContextCollectionRole,
    onSettled: () => void,
  ) {
    super();
    this.#context = context;
    this.#collectionId = collectionId;
    this.#role = role;
    this.#onSettled = onSettled;
  }

  // Resolving tells the picker the person was added; a rejection's message is shown beside them.
  async receive({ ticket }: UserSelection): Promise<void> {
    try {
      await this.#context.shareContextCollection(this.#collectionId, ticket, this.#role);
    } finally {
      // Cancelling the picker stops waiting, not a share already delivered to the backend.
      this.#onSettled();
    }
  }
}

/** Dialog that manages who can access a private collection. */
export const ShareCollectionDialog = ({
  collection,
  onChanged,
  onLeft,
  onClose,
}: ShareCollectionDialogProps) => {
  const context = useContextApi();
  const selectUsers = useSelectUsers();
  const [state, setState] = useState<ShareState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const mountedRef = useRef(false);
  const loadSequence = useRef(0);
  const [selectedRole, setSelectedRole] = useState<ContextCollectionRole>("viewer");
  // "picker", "everyone", or the memberId whose grant is being changed.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changedRef = useRef(false);
  const leftRef = useRef(false);
  const dialog = useMutationDialog(pending !== null, () => {
    if (leftRef.current) onLeft();
    else if (changedRef.current) onChanged();
    onClose();
  });

  const reload = useCallback(async () => {
    if (!mountedRef.current) return;
    // Unmounting also bumps the sequence, so a stale or orphaned load never sets state.
    const sequence = ++loadSequence.current;
    const isCurrent = () => sequence === loadSequence.current;
    setLoading(true);
    try {
      const [sharing, permissions] = await Promise.all([
        context.getContextCollectionSharing(collection.id),
        context.getContextCollectionPermissions(collection.id),
      ]);
      if (!isCurrent()) return;
      setState({ sharing, permissions });
      setLoadError(null);
    } catch (loadFailure) {
      if (isCurrent()) setLoadError(errorMessage(loadFailure, "无法加载分享设置。"));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [collection.id, context]);

  useEffect(() => {
    mountedRef.current = true;
    void reload();
    return () => {
      mountedRef.current = false;
      loadSequence.current++;
    };
  }, [reload]);

  const controlsDisabled = pending !== null || loading || loadError !== null;

  const mutate = async (key: string, action: () => Promise<void>, fallback: string) => {
    if (controlsDisabled) return;
    setPending(key);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure, fallback));
    } finally {
      // The backend can commit an ACL change and still reject (e.g. Git token revocation fails).
      changedRef.current = true;
      await reload();
      setPending(null);
    }
  };

  const addPeople = async () => {
    if (controlsDisabled) return;
    let pickerOpen = true;
    const receiver = new CollectionShareReceiver(context, collection.id, newRole, () => {
      if (!pickerOpen) {
        onChanged();
        void reload();
      }
    });
    setPending("picker");
    setError(null);
    try {
      await selectUsers(receiver);
    } catch (failure) {
      setError(errorMessage(failure, "无法打开用户选择器。"));
    } finally {
      pickerOpen = false;
      // An in-flight delivery may finish later; its receiver reconciles again when it settles.
      changedRef.current = true;
      await reload();
      setPending(null);
    }
  };

  const changeRole = async (member: ContextCollectionMember, role: ContextCollectionRole) => {
    await mutate(
      member.memberId,
      () => context.setContextCollectionMemberRole(collection.id, member.memberId, role),
      "无法更改角色。",
    );
  };

  const removeMember = async (member: ContextCollectionMember) => {
    await mutate(
      member.memberId,
      () => context.removeContextCollectionMember(collection.id, member.memberId),
      "无法移除用户。",
    );
  };

  const setEveryoneCanView = async (everyoneCanView: boolean) => {
    await mutate(
      "everyone",
      () => context.setContextCollectionEveryoneCanView(collection.id, everyoneCanView),
      "无法更改组织访问权限。",
    );
  };

  const permissions = state?.permissions;
  const sharing = state?.sharing;
  const roleOptions: ContextCollectionRole[] = permissions?.canManageOwners
    ? ["viewer", "editor", "owner"]
    : ["viewer", "editor"];
  // The viewer can lose owner management (e.g. by demoting themselves) after picking "owner".
  const newRole = roleOptions.includes(selectedRole) ? selectedRole : "editor";
  const ownerCount = sharing?.members.filter((member) => member.role === "owner").length ?? 0;
  const otherMembers = sharing?.members.filter((member) => !member.isViewer) ?? [];

  const renderMember = (member: ContextCollectionMember) => {
    const name = member.isViewer ? "你" : member.displayName ?? "知识集合创建者";
    const isOwner = member.role === "owner";
    const soleOwner = isOwner && ownerCount === 1;
    const canChangeRole = permissions?.canShare
      && (!isOwner || permissions.canManageOwners) && !soleOwner;
    const canRemove = member.isViewer ? !soleOwner : canChangeRole;

    return (
      <li key={member.memberId} className="flex items-center gap-2 rounded-xl py-2.5 pl-1.5">
        <span
          aria-hidden="true"
          className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-kumo-tint text-xs font-medium text-kumo-default"
        >
          {member.isViewer ? <User size={16} /> : name.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-kumo-default">
          {name}
        </span>
        {canChangeRole || canRemove ? (
          <DropdownMenu>
            <DropdownMenu.Trigger
              disabled={controlsDisabled}
              render={(
                <Button
                  variant="ghost"
                  size="sm"
                  className="group shrink-0 gap-1.5 text-xs"
                  aria-label={`${member.isViewer ? "你" : name}的角色`}
                >
                  {MEMBER_ROLE_LABELS[member.role]}
                  <CaretDown size={10} weight="bold" className="group-data-[popup-open]:rotate-180" />
                </Button>
              )}
            />
            <DropdownMenu.Content align="end" sideOffset={6}>
              {(canChangeRole ? roleOptions : [member.role]).map((role) => (
                <DropdownMenu.Item
                  key={role}
                  selected={role === member.role}
                  className="text-xs"
                  onClick={() => { if (role !== member.role) void changeRole(member, role); }}
                >
                  <span className="min-w-0 flex-1 pr-4">{MEMBER_ROLE_LABELS[role]}</span>
                </DropdownMenu.Item>
              ))}
              {canRemove && (
                <>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    variant="danger"
                    className="text-xs"
                    onClick={() => {
                      if (member.isViewer) setConfirmLeave(true);
                      else void removeMember(member);
                    }}
                  >
                    {member.isViewer ? "退出知识集合" : "移除访问权限"}
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu>
        ) : (
          <span className="shrink-0 px-2 text-xs font-medium text-kumo-default">
            {MEMBER_ROLE_LABELS[member.role]}
          </span>
        )}
      </li>
    );
  };

  return (
    <Dialog.Root
      open={dialog.open}
      onOpenChange={(open) => { if (!open) dialog.requestClose(); }}
      onOpenChangeComplete={dialog.onOpenChangeComplete}
    >
      <Dialog
        aria-describedby={undefined}
        className="top-[8%]! flex max-h-[84dvh] w-[min(560px,calc(100vw-32px))]! translate-y-0! flex-col bg-kumo-base p-0"
        size="sm"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-4 pb-2 pt-5 sm:px-6">
          <Dialog.Title className="min-w-0 text-[17px] leading-6 font-medium tracking-[-0.35px] text-kumo-default">
            分享 <span className="text-kumo-subtle">“{collection.title}”</span>
          </Dialog.Title>
          <Dialog.Close
            disabled={pending !== null}
            render={(props) => (
              <Button {...props} variant="ghost" shape="square" aria-label="关闭">
                <X size={18} />
              </Button>
            )}
          />
        </div>
        <div className="flex min-h-0 max-h-[min(72vh,680px)] flex-col gap-5 overflow-y-auto px-4 pt-2 pb-5 sm:px-6">
          {!state || !permissions || !sharing ? (
            loadError ? (
              <Banner
                variant="error"
                size="sm"
                icon={<WarningCircle weight="fill" />}
                description={loadError}
                action={<Button size="xs" variant="secondary" disabled={loading} onClick={() => void reload()}>重试</Button>}
              />
            ) : (
              <div role="status" aria-label="正在加载分享设置" className="flex justify-center py-8">
                <Loader size="lg" />
              </div>
            )
          ) : (
            <>
              {loadError && (
                <Banner
                  variant="error"
                  size="sm"
                  icon={<WarningCircle weight="fill" />}
                  title="分享设置可能已过期"
                  description={loadError}
                  action={<Button size="xs" variant="secondary" disabled={loading} onClick={() => void reload()}>重试</Button>}
                />
              )}
              {!sharing.hasOwner && (
                <Banner
                  variant="alert"
                  size="sm"
                  icon={<Warning weight="fill" />}
                  title="此知识集合已没有所有者"
                  description="所有者的账号已断开连接，所有人保留当前访问权限。"
                />
              )}
              {error && (
                <Banner
                  variant="error"
                  size="sm"
                  icon={<WarningCircle weight="fill" />}
                  description={error}
                />
              )}

              <div className="flex flex-wrap items-center gap-x-0 gap-y-2 rounded-xl bg-kumo-tint p-3">
                <Text>添加用户并设置角色</Text>
                <DropdownMenu>
                  <DropdownMenu.Trigger
                    // Each picker session keeps the role it opened with.
                    disabled={!permissions.canShare || loading || loadError !== null || (pending !== null && pending !== "picker")}
                    render={(
                      <Button
                        variant="ghost"
                        size="sm"
                        className="group shrink-0 gap-1.5 text-base"
                        aria-label="新增用户的角色"
                      >
                        {COLLECTION_ROLE_LABELS[newRole]}
                        <CaretDown size={10} weight="bold" className="group-data-[popup-open]:rotate-180" />
                      </Button>
                    )}
                  />
                  <DropdownMenu.Content align="end" sideOffset={6}>
                    {roleOptions.map((role) => (
                      <DropdownMenu.Item
                        key={role}
                        selected={role === newRole}
                        className="text-base"
                        onClick={() => setSelectedRole(role)}
                      >
                        <span className="min-w-0 flex-1 pr-4">{COLLECTION_ROLE_LABELS[role]}</span>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu>
                <Button
                  variant="primary"
                  className="ml-auto shrink-0"
                  loading={pending === "picker"}
                  disabled={!permissions.canShare || controlsDisabled}
                  onClick={() => void addPeople()}
                >
                  选择用户
                </Button>
              </div>

              <ul aria-label="有权访问的用户" className="flex flex-col">
                {sharing.members.filter((member) => member.isViewer).map(renderMember)}
                <li className="flex items-center gap-2 py-3 pl-1.5">
                  <span
                    aria-hidden="true"
                    className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-kumo-tint text-kumo-default"
                  >
                    <Buildings size={16} />
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-kumo-default">组织内所有人</span>
                  <DropdownMenu>
                    <DropdownMenu.Trigger
                      disabled={!permissions.canShare || controlsDisabled}
                      render={(
                        <Button
                          variant="ghost"
                          size="sm"
                          className="group shrink-0 gap-1.5 text-xs"
                          aria-label="组织内所有人的访问权限"
                        >
                          {sharing.everyoneCanView ? "可查看" : "无访问权限"}
                          <CaretDown size={10} weight="bold" className="group-data-[popup-open]:rotate-180" />
                        </Button>
                      )}
                    />
                    <DropdownMenu.Content align="end" sideOffset={6}>
                      <DropdownMenu.Item
                        selected={!sharing.everyoneCanView}
                        className="text-xs"
                        onClick={() => { if (sharing.everyoneCanView) void setEveryoneCanView(false); }}
                      >
                        <span className="min-w-0 flex-1 pr-4">无访问权限</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        selected={sharing.everyoneCanView}
                        className="text-xs"
                        onClick={() => { if (!sharing.everyoneCanView) void setEveryoneCanView(true); }}
                      >
                        <span className="min-w-0 flex-1 pr-4">可查看</span>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu>
                </li>
                {otherMembers.length > 0 && (
                  <li aria-hidden="true" className="my-1 border-b border-dashed border-kumo-line" />
                )}
                {otherMembers.map(renderMember)}
              </ul>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-kumo-line px-4 py-3 sm:px-6">
          <Button variant="secondary" onClick={dialog.requestClose} disabled={pending !== null}>完成</Button>
        </div>
      </Dialog>
      {confirmLeave && (
        <LeaveCollectionDialog
          collection={collection}
          onChanged={() => {
            changedRef.current = true;
            onChanged();
            void reload();
          }}
          onLeft={() => {
            leftRef.current = true;
            dialog.closeAfterSuccess();
          }}
          onClose={() => setConfirmLeave(false)}
        />
      )}
    </Dialog.Root>
  );
};
