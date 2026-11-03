import {
  Button,
  Dialog,
  Field,
  Input,
  InputArea,
  LayerCard,
  Radio,
  Text,
  useKumoToastManager,
} from "@cloudflare/kumo";
import { Buildings, GitBranch, Lock, PencilSimple, X } from "@phosphor-icons/react";
import { useState } from "react";
import type {
  ContextCollectionContent,
  ContextCollectionMetadata,
  ContextCollectionVisibility,
  ContextGitTokenCreateResult,
} from "../../src/context-types";
import { CollectionIconPicker, DEFAULT_COLLECTION_ICON } from "../components/CollectionIconPicker";
import { useContextApi } from "../bridge";
import { GitTokenCredentials } from "./GitTokenCredentials";
import { useMutationDialog } from "./useMutationDialog";

type CreateCollectionDialogProps = {
  viewerInfo: { isAdmin: boolean; supportsGitCollections: boolean };
  onCreated: () => void;
  onClose: () => void;
};

/** Dialog that creates a collection with the sources and visibility available to the viewer. */
export const CreateCollectionDialog = ({
  viewerInfo,
  onCreated,
  onClose,
}: CreateCollectionDialogProps) => {
  const context = useContextApi();
  const toasts = useKumoToastManager();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState(DEFAULT_COLLECTION_ICON);
  const [source, setSource] = useState<ContextCollectionContent["source"]>("web");
  const [visibility, setVisibility] = useState<ContextCollectionVisibility>("private");
  const [creating, setCreating] = useState(false);
  const [creatingToken, setCreatingToken] = useState(false);
  const [gitSetup, setGitSetup] = useState<{
    collection: ContextCollectionMetadata;
    token: ContextGitTokenCreateResult | null;
  } | null>(null);
  const busy = creating || creatingToken;
  const dialog = useMutationDialog(busy, onClose);

  const createToken = async (collection: ContextCollectionMetadata) => {
    setCreatingToken(true);
    try {
      const token = await context.createContextCollectionGitToken(collection.id);
      setGitSetup({ collection, token });
    } catch (error) {
      toasts.add({
        title: error instanceof Error ? error.message : "创建 Git 令牌失败",
        variant: "error",
      });
    } finally {
      setCreatingToken(false);
    }
  };

  const create = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || creating) return;

    setCreating(true);
    try {
      const collection = await context.createContextCollection(
        trimmedTitle,
        description.trim(),
        visibility,
        icon,
        source,
      );
      onCreated();
      if (collection.content.source === "git") {
        setGitSetup({ collection, token: null });
        await createToken(collection);
      } else {
        dialog.closeAfterSuccess();
      }
    } catch (error) {
      toasts.add({
        title: error instanceof Error ? error.message : "创建知识集合失败",
        variant: "error",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog.Root
      open={dialog.open}
      onOpenChange={(open) => { if (!open) dialog.requestClose(); }}
      onOpenChangeComplete={(isOpen) => {
        dialog.onOpenChangeComplete(isOpen);
        if (!isOpen && gitSetup) onCreated();
      }}
    >
      <Dialog className="w-[min(520px,calc(100vw-32px))]! bg-kumo-base p-0 top-[10%]! translate-y-0!" size="sm">
        <div className="flex items-center justify-between gap-4 border-b border-kumo-line px-4 py-4 sm:px-6">
          <Dialog.Title className="text-[17px] leading-6 font-medium tracking-[-0.35px] text-kumo-default">
            {gitSetup ? "设置 Git 镜像" : "添加知识集合"}
          </Dialog.Title>
          <Dialog.Close
            disabled={busy}
            render={(props) => (
              <Button {...props} variant="ghost" shape="square" aria-label="关闭">
                <X size={18} />
              </Button>
            )}
          />
        </div>
        <div className="flex max-h-[min(68vh,640px)] flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
          {gitSetup ? (
            <>
              <Text variant="secondary">
                知识集合已准备就绪。Git 内容会推送到生成的目标地址，无需在此输入源仓库 URL。
              </Text>
              {gitSetup.token ? (
                <GitTokenCredentials
                  token={gitSetup.token}
                  branch={gitSetup.collection.content.source === "git"
                    ? gitSetup.collection.content.branch
                    : "main"}
                />
              ) : (
                <LayerCard className="flex items-center justify-between gap-3 bg-kumo-control p-4">
                  <Text variant="secondary">
                    创建凭据以完成推送镜像配置。
                  </Text>
                  <Button
                    variant="secondary"
                    onClick={() => void createToken(gitSetup.collection)}
                    loading={creatingToken}
                  >
                    创建令牌
                  </Button>
                </LayerCard>
              )}
            </>
          ) : (
            <>
              <Field label="名称">
                <div className="flex w-full items-center gap-2">
                  <CollectionIconPicker value={icon} onChange={setIcon} variant="boxed" size={24} />
                  <Input
                    aria-label="名称"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") void create(); }}
                    maxLength={100}
                    placeholder="简短的名称，例如品牌指南"
                    autoFocus
                    className="min-w-0 flex-1"
                  />
                </div>
              </Field>
              <InputArea
                label={<span>描述 <span className="font-normal text-kumo-inactive">可选</span></span>}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="包含什么内容以及何时使用"
                rows={3}
              />
              {viewerInfo.supportsGitCollections && (
                <Radio.Group<ContextCollectionContent["source"]>
                  legend="类型"
                  appearance="card"
                  value={source}
                  onValueChange={(value) => setSource(value)}
                  className="grid gap-2"
                >
                  <Radio.Item
                    value="web"
                    label={<span className="flex items-center gap-2"><PencilSimple size={15} />可编辑文档</span>}
                    description="在此应用中创建、编辑和删除文件。"
                  />
                  <Radio.Item
                    value="git"
                    label={<span className="flex items-center gap-2"><GitBranch size={15} />Git 镜像</span>}
                    description="从 Git 仓库推送内容，变更仍由 Git 管理。"
                  />
                </Radio.Group>
              )}
              {viewerInfo.isAdmin && (
                <Radio.Group<ContextCollectionVisibility>
                  legend="可见范围"
                  appearance="card"
                  value={visibility}
                  onValueChange={(value) => setVisibility(value)}
                  className="grid gap-2"
                >
                  <Radio.Item
                    value="private"
                    label={<span className="flex items-center gap-2"><Lock size={15} />仅自己</span>}
                    description="仅你的账号可见，直到你分享。"
                  />
                  <Radio.Item
                    value="public"
                    label={<span className="flex items-center gap-2"><Buildings size={15} />所有人</span>}
                    description="在组织内共享，并为所有用户启用。"
                  />
                </Radio.Group>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-kumo-line px-4 py-3 sm:px-6">
          {gitSetup ? (
            <Button onClick={dialog.requestClose} disabled={busy}>完成</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={dialog.requestClose} disabled={busy}>取消</Button>
              <Button
                onClick={create}
                loading={creating}
                disabled={!title.trim()}
              >
                添加知识集合
              </Button>
            </>
          )}
        </div>
      </Dialog>
    </Dialog.Root>
  );
};
