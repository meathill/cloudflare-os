import { Button, Dialog, Text, useKumoToastManager } from "@cloudflare/kumo";
import { X } from "@phosphor-icons/react";
import { useState } from "react";
import { useContextApi } from "../bridge";
import { useMutationDialog } from "./useMutationDialog";

type LeaveCollectionDialogProps = {
  collection: { id: string; title: string };
  /** Reconcile access when leaving rejects, since token cleanup can fail after the membership was removed. */
  onChanged: () => void;
  onLeft: () => void;
  onClose: () => void;
};

/** Confirms giving up the viewer's own access to a collection someone shared with them. */
export const LeaveCollectionDialog = ({ collection, onChanged, onLeft, onClose }: LeaveCollectionDialogProps) => {
  const context = useContextApi();
  const toasts = useKumoToastManager();
  const [leaving, setLeaving] = useState(false);
  const dialog = useMutationDialog(leaving, onClose);

  const leave = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await context.leaveContextCollection(collection.id);
      onLeft();
      dialog.closeAfterSuccess();
    } catch (error) {
      onChanged();
      toasts.add({
        title: error instanceof Error ? error.message : "无法退出此知识集合。",
        variant: "error",
      });
    } finally {
      setLeaving(false);
    }
  };

  return (
    <Dialog.Root
      open={dialog.open}
      onOpenChange={(open) => { if (!open) dialog.requestClose(); }}
      onOpenChangeComplete={dialog.onOpenChangeComplete}
    >
      <Dialog className="w-[min(440px,calc(100vw-32px))]! bg-kumo-base p-0 top-[16%]! translate-y-0!" size="sm">
        <div className="flex items-center justify-between gap-4 border-b border-kumo-line px-4 py-4 sm:px-6">
          <Dialog.Title className="text-[17px] leading-6 font-medium tracking-[-0.35px] text-kumo-default">
            退出知识集合
          </Dialog.Title>
          <Dialog.Close
            disabled={leaving}
            render={(props) => (
              <Button {...props} variant="ghost" shape="square" aria-label="关闭">
                <X size={18} />
              </Button>
            )}
          />
        </div>
        <div className="px-4 py-5 sm:px-6">
          <Text size="sm" variant="secondary">
            你将退出{" "}
            <span className="font-medium text-kumo-default">{collection.title}</span>。需要有分享权限的用户重新分享才能恢复成员身份。
          </Text>
          <Text size="sm" variant="secondary" DANGEROUS_className="mt-3">
            如果你是没有所有者的知识集合的最后一位成员，退出将永久删除该知识集合及其所有文档，即使组织内所有人都能查看。
          </Text>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-kumo-line px-4 py-3 sm:px-6">
          <Button variant="secondary" onClick={dialog.requestClose} disabled={leaving}>取消</Button>
          <Button variant="destructive" onClick={leave} loading={leaving}>退出</Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
};
