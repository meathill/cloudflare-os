// @vitest-environment jsdom

import type { AiChatAuthorInfo } from "@gadgets/workshop-shared/api";
import { beforeEach, describe, expect, it } from "vitest";
import {
  fromModelSelectValue,
  getStoredSelectedModel,
  NO_AGENT_OPTION_VALUE,
  persistSelectedModel,
  toModelSelectValue,
} from "./modelSelection";

const GEMINI: AiChatAuthorInfo = { type: "agent", id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" };
const OTHER_MODEL: AiChatAuthorInfo = { type: "agent", id: "gpt-6.1-terra", name: "GPT-6.1 Terra" };

beforeEach(() => localStorage.clear());

describe("模型选择", () => {
  it("默认优先使用已配置的 Gemini 3.8 Flash", () => {
    expect(getStoredSelectedModel([OTHER_MODEL, GEMINI])).toBe(GEMINI.id);
  });

  it("已保存的模型不可用时回到唯一可用的 Gemini", () => {
    persistSelectedModel(OTHER_MODEL.id);
    expect(getStoredSelectedModel([GEMINI])).toBe(GEMINI.id);
  });

  it("保存并恢复明确选择的无 Agent 模式", () => {
    persistSelectedModel(null);
    expect(getStoredSelectedModel([GEMINI])).toBeNull();
    expect(toModelSelectValue(null)).toBe(NO_AGENT_OPTION_VALUE);
    expect(fromModelSelectValue(NO_AGENT_OPTION_VALUE)).toBeNull();
  });

  it("选择值往返转换保留所选模型", () => {
    persistSelectedModel(OTHER_MODEL.id);
    expect(getStoredSelectedModel([GEMINI, OTHER_MODEL])).toBe(OTHER_MODEL.id);
    expect(fromModelSelectValue(toModelSelectValue(OTHER_MODEL.id))).toBe(OTHER_MODEL.id);
  });

  it("没有配置模型时不产生无效的模型 ID", () => {
    expect(getStoredSelectedModel([])).toBeNull();
  });
});
