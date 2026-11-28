import { useLayoutEffect, useRef } from "react";
import { Button } from "@cloudflare/kumo";
import { Check, X } from "@phosphor-icons/react";
import type { DictatedWords } from "./useComposerDictation";

/**
 * The words dictation is waiting to add, shown apart from the draft so that the draft, its
 * selection and its undo history stay the user's until they add them.
 */
export const ComposerDictationStrip = ({ textId, words, disabled, onAdd, onDiscard }: {
  /** Lets the textarea name these words as its description. */
  textId: string;
  words: DictatedWords;
  disabled: boolean;
  onAdd: () => void;
  onDiscard: () => void;
}) => {
  const textRef = useRef<HTMLParagraphElement>(null);
  const empty = !words.final && !words.interim;

  // Long dictation scrolls inside the strip, so keep its newest words in view.
  useLayoutEffect(() => {
    const text = textRef.current;
    if (text) text.scrollTop = text.scrollHeight;
  }, [words]);

  return (
    <div
      role="group"
      aria-label="语音输入"
      className="flex items-start gap-1 px-4 pb-2"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onDiscard();
      }}
    >
      <p
        id={textId}
        ref={textRef}
        className="m-0 max-h-[66px] min-w-0 flex-1 overflow-y-auto py-1 text-[16px] leading-[22px] text-kumo-default sm:text-[14px]"
      >
        {empty
          ? <span className="text-kumo-subtle">正在聆听…</span>
          : <>{words.final}<span className="text-kumo-subtle">{words.interim}</span></>}
      </p>
      <Button
        type="button"
        shape="square"
        size="sm"
        variant="ghost"
        aria-label="加入消息"
        title="加入消息"
        icon={<Check />}
        disabled={disabled || empty}
        onClick={onAdd}
      />
      <Button
        type="button"
        shape="square"
        size="sm"
        variant="ghost"
        aria-label="丢弃所说的内容"
        title="丢弃所说的内容"
        icon={<X />}
        disabled={disabled}
        onClick={onDiscard}
      />
    </div>
  );
};
