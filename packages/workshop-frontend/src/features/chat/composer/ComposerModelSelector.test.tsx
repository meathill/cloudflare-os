// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AiChatAuthorInfo } from "@gadgets/workshop-shared/api";
import { ComposerModelSelector } from "./ComposerModelSelector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const models: AiChatAuthorInfo[] = [
  { type: "agent", id: "claude-opus-5-5", name: "Claude Opus 5.5" },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(
    <ComposerModelSelector
      models={models}
      selectedModel={{ id: "gemini-3.8-flash" }}
      onModelChange={() => {}}
    />,
  ));
  return container;
}

describe("ComposerModelSelector", () => {
  it("shows the fixed model and offers no picker", () => {
    const rendered = render();
    expect(rendered.textContent).toContain("Gemini 3.8 Flash");
    expect(rendered.querySelector('[aria-label="Select model"]')).toBeNull();
    expect(rendered.querySelector("button")).toBeNull();
  });
});
