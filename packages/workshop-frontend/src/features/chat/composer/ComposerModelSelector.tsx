import type { AiChatAuthorInfo } from "@gadgets/workshop-shared/api";
import { Sparkle } from "@phosphor-icons/react";

/** 主力模型固定为 Gemini 3.8 Flash，编辑器只展示，不提供切换。 */
export const FIXED_MODEL_NAME = "Gemini 3.8 Flash";

/**
 * The composer's model, or null for "No agent". Inference is locked to Gemini 3.8 Flash in this
 * deployment, so the composer only displays it; the type stays for existing callers.
 */
export type SelectedModel = { id: string; name?: string } | null;

type ComposerModelSelectorProps = {
  models: readonly AiChatAuthorInfo[];
  selectedModel: SelectedModel;
  onModelChange: (modelId: string | null) => void;
};

export const ComposerModelSelector = (_props: ComposerModelSelectorProps) => {
  return (
    <div
      className="inline-flex h-10 min-w-0 max-w-[110px] select-none items-center gap-1.5 rounded-lg bg-kumo-tint/50 px-2 text-[14px] leading-5 text-kumo-subtle sm:h-8 sm:max-w-[180px] sm:text-[13px]"
      title="当前使用模型：Gemini 3.8 Flash"
    >
      <Sparkle size={13} weight="fill" className="text-kumo-brand flex-shrink-0" />
      <span className="min-w-0 truncate font-medium">{FIXED_MODEL_NAME}</span>
    </div>
  );
};
