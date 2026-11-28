import { Button, Loader } from "@cloudflare/kumo";
import { Hourglass, Microphone } from "@phosphor-icons/react";
import type { DictationStatus } from "./useComposerDictation";

const announcements: Record<DictationStatus, string> = {
  idle: "",
  starting: "正在启动语音输入…",
  downloading: "正在下载语音输入语言包…",
  listening: "正在聆听… 停止会将你说的内容加入消息，Escape 则丢弃。",
  finishing: "正在结束语音输入…",
};

export const ComposerDictationButton = ({ status, disabled, onToggle, onCancel }: {
  status: DictationStatus;
  disabled: boolean;
  onToggle: () => void;
  onCancel: () => void;
}) => {
  const listening = status === "listening";
  const preparing = status === "starting" || status === "downloading" || status === "finishing";
  const label = status === "idle"
    ? "开始语音输入"
    : status === "finishing" ? "立即加入所说的内容" : "停止语音输入";

  return (
    <>
      <span role="status" className="sr-only">{announcements[status]}</span>
      <Button
        type="button"
        shape="square"
        variant="ghost"
        className="group relative !h-10 !w-10 shrink-0 sm:!h-8 sm:!w-8"
        disabled={disabled}
        aria-label={label}
        title={label}
        icon={preparing ? (
          <span aria-hidden="true" className="text-kumo-subtle">
            <Loader size="sm" className="motion-reduce:hidden" />
            <Hourglass size={16} className="hidden motion-reduce:block" />
          </span>
        ) : (
          <Microphone
            weight={listening ? "fill" : "regular"}
            className={listening
              ? "relative z-10 text-kumo-danger"
              : "text-kumo-inactive group-hover:text-kumo-subtle group-focus-visible:text-kumo-subtle"}
          />
        )}
        onClick={onToggle}
        onKeyDown={(e) => {
          // Clicking the mic leaves focus here, so Escape discards from the button as well as from
          // the textarea.
          if (e.key !== "Escape" || status === "idle") return;
          e.preventDefault();
          onCancel();
        }}
      >
        {listening && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 m-auto hidden size-3.5 rounded-full border border-kumo-danger/45 motion-safe:block motion-safe:animate-ping"
          />
        )}
      </Button>
    </>
  );
};
