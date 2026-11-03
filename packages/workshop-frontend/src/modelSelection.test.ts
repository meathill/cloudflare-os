// @vitest-environment jsdom

import type { AiChatAuthorInfo } from "@gadgets/workshop-shared/api";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FIXED_MODEL_ID,
  fromModelSelectValue,
  getStoredSelectedModel,
  NO_AGENT_OPTION_VALUE,
  persistSelectedModel,
  toModelSelectValue,
} from "./modelSelection";

const GEMINI: AiChatAuthorInfo = { type: "agent", id: FIXED_MODEL_ID, name: "Gemini 3.8 Flash" };
const OTHER_MODEL: AiChatAuthorInfo = { type: "agent", id: "other-model", name: "Other model" };

beforeEach(() => localStorage.clear());

describe("模型选择", () => {
  it("默认优先使用已配置的 Gemini 3.8 Flash", () => {
    expect(getStoredSelectedModel([OTHER_MODEL, GEMINI])).toBe(FIXED_MODEL_ID);
  });

  it("已保存的模型不可用时回到唯一可用的 Gemini", () => {
    persistSelectedModel(OTHER_MODEL.id);
    expect(getStoredSelectedModel([GEMINI])).toBe(FIXED_MODEL_ID);
  });

  it("保存并恢复明确选择的无 Agent 模式", () => {
    persistSelectedModel(null);
    expect(getStoredSelectedModel([GEMINI])).toBeNull();
    expect(toModelSelectValue(null)).toBe(NO_AGENT_OPTION_VALUE);
    expect(fromModelSelectValue(NO_AGENT_OPTION_VALUE)).toBeNull();
  });

  it("选择值往返转换保留所选模型", () => {
    persistSelectedModel(GEMINI.id);
    expect(getStoredSelectedModel([GEMINI])).toBe(GEMINI.id);
    expect(fromModelSelectValue(toModelSelectValue(GEMINI.id))).toBe(GEMINI.id);
  });

  it("没有配置模型时不产生无效的模型 ID", () => {
    expect(getStoredSelectedModel([])).toBeNull();
  });
});
