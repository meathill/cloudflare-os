// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiChatAuthorInfo } from "@gadgets/workshop-shared/api";
import { ComposerModelSelector, type SelectedModel } from "./ComposerModelSelector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const models: AiChatAuthorInfo[] = [
  { type: "agent", id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
  { type: "agent", id: "gpt-6.1-terra", name: "GPT-6.1 Terra" },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(selectedModel: SelectedModel, onModelChange: (id: string | null) => void) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(
    <ComposerModelSelector
      models={models}
      selectedModel={selectedModel}
      onModelChange={onModelChange}
    />,
  ));
  return container;
}

describe("ComposerModelSelector", () => {
  it.each([
    ["GPT-6.1 Terra", "gpt-6.1-terra"],
    ["无智能体", null],
  ])("选择 %s 时传回对应的模型 ID", async (label, id) => {
    const onModelChange = vi.fn<(id: string | null) => void>();
    const rendered = render({ id: "gemini-3.8-flash" }, onModelChange);
    const trigger = rendered.querySelector<HTMLButtonElement>('button[aria-label="选择模型"]');
    expect(trigger?.textContent).toContain("Gemini 3.8 Flash");
    await act(async () => trigger?.click());
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find(element => element.textContent?.trim() === label);
    expect(item).toBeDefined();
    await act(async () => item?.click());
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith(id);
  });

  it("显示旧会话中已隐藏的模型名称", () => {
    const rendered = render({ id: "gpt-6-sol", name: "GPT-6 Sol" }, () => {});
    expect(rendered.textContent).toContain("GPT-6 Sol");
  });
});
