import { Button, Input, LayerCard, Text, useKumoToastManager } from "@cloudflare/kumo";
import type { ContextGitTokenCreateResult } from "../../src/context-types";

type GitTokenCredentialsProps = {
  token: ContextGitTokenCreateResult;
  branch: string;
};

/** One-time credentials and instructions for configuring a repository push mirror. */
export const GitTokenCredentials = ({ token, branch }: GitTokenCredentialsProps) => {
  const toasts = useKumoToastManager();

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toasts.add({ title: `${label}已复制`, variant: "success" });
    } catch {
      toasts.add({ title: `复制${label}失败`, variant: "error" });
    }
  };

  return (
    <LayerCard className="flex flex-col gap-4 bg-kumo-control p-4">
      <div>
        <Text bold>镜像凭据</Text>
        <Text variant="secondary" DANGEROUS_className="mt-1">
          配置源仓库以推送到生成的目标地址。密码仅显示一次。
        </Text>
      </div>
      <div className="flex flex-col gap-3">
        <Input label="用户名" readOnly value="gitlab" />
        <div className="flex items-end gap-2">
          <Input label="远程 URL" readOnly value={token.remote} className="min-w-0 flex-1 font-mono" />
          <Button variant="secondary" onClick={() => void copy(token.remote, "远程 URL")}>复制</Button>
        </div>
        <div className="flex items-end gap-2">
          <Input label="密码" readOnly type="password" value={token.plaintext} className="min-w-0 flex-1 font-mono" />
          <Button variant="secondary" onClick={() => void copy(token.plaintext, "密码")}>复制</Button>
        </div>
      </div>
      <div>
        <Text bold>设置镜像</Text>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-5 text-kumo-subtle">
          <li>在 Git 服务中打开包含技能的仓库。</li>
          <li>使用上方的远程 URL 和凭据添加仓库镜像。</li>
          <li>将镜像方向设为 Push，并选择 {branch} 分支。</li>
          <li>触发首次推送，然后从此知识集合的菜单中刷新。</li>
        </ol>
      </div>
    </LayerCard>
  );
};
