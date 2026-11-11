import { useEffect, useState } from "react";
import { Switch, useKumoToastManager } from "@cloudflare/kumo";
import { useAuthenticatedApi } from "../../AuthContext";
import { useServerConfig } from "../../ServerConfigContext";
import { logRpcFailure } from "../../rpcErrors";
import {
  browserPushEnabled, browserPushSupport, disableBrowserPush, enableBrowserPush,
} from "./browserPush";

type Status = "loading" | "on" | "off" | "denied";

const readStatus = async (userId: string): Promise<Status> =>
  Notification.permission === "denied" ? "denied"
    : await browserPushEnabled(userId) ? "on" : "off";

/** The profile page's notification settings: whether this browser shows push notifications. */
export const NotificationSettings = () => {
  const { authenticatedApi, currentUser, isCurrentUserConfirmed } = useAuthenticatedApi();
  const publicKey = useServerConfig()?.webPushPublicKey;
  const toasts = useKumoToastManager();
  const support = browserPushSupport();
  const [status, setStatus] = useState<Status>("loading");
  const [pending, setPending] = useState(false);
  // Mid-reconnect, currentUser can still be the previous account while the API is the next one's.
  const userId = isCurrentUserConfirmed ? currentUser?.id : undefined;

  useEffect(() => {
    if (!userId || !publicKey || support !== "supported") return;
    let cancelled = false;
    void readStatus(userId).then(next => { if (!cancelled) setStatus(next); });
    return () => { cancelled = true; };
  }, [userId, publicKey, support]);

  if (!publicKey || support === "unsupported") return null;

  const toggle = async () => {
    if (!userId) return;
    setPending(true);
    try {
      if (status === "on") {
        await disableBrowserPush();
        setStatus("off");
      } else {
        // First, so the permission prompt still has the click.
        let permission = await enableBrowserPush(authenticatedApi, userId, publicKey);
        setStatus(permission === "granted" ? "on" : permission === "denied" ? "denied" : "off");
      }
    } catch (error) {
      logRpcFailure("Failed to update browser notifications:", error);
      toasts.add({ title: "更新浏览器通知失败", variant: "error" });
      setStatus(await readStatus(userId));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 text-[12px] font-medium uppercase tracking-[0.08em] text-kumo-inactive">
        通知
      </h2>
      <div className="rounded-xl border border-kumo-line bg-kumo-base p-5">
        {support === "supported" ? (
          <div className="flex flex-col gap-2">
            <Switch
              label="浏览器通知"
              checked={status === "on"}
              disabled={status === "loading" || status === "denied" || pending}
              transitioning={pending}
              onClick={() => void toggle()}
            />
            <p className="text-sm text-kumo-subtle">
              {status === "on"
                ? "没有打开的工作台标签页处于前台时，任务完成或需要许可会在此浏览器中显示通知。"
                : status === "denied"
                  ? "你的浏览器设置已屏蔽此站点的通知。"
                  : "没有工作台标签页处于前台时，在任务完成或需要许可时通过此浏览器接收通知。"}
            </p>
          </div>
        ) : (
          <p className="text-sm text-kumo-subtle">
            {support === "appleMobile"
              ? "在 iPhone 和 iPad 上，通知来自 Cloudflare OS 应用。"
              : "Android 暂不支持浏览器通知。"}
          </p>
        )}
      </div>
    </section>
  );
};
