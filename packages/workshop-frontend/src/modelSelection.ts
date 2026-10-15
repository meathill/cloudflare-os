import type { AiChatAuthorInfo } from "@gadgets/workshop-shared/api";

const LAST_SELECTED_MODEL_KEY = "lastSelectedModel";

export const FIXED_MODEL_ID = "gemini-3.8-flash";
export const FIXED_MODEL_NAME = "Gemini 3.8 Flash";

/** Sentinel used for UI values and localStorage so an explicit null choice can persist. */
export const NO_AGENT_OPTION_VALUE = "__gadgets_no_agent__";

export function getStoredSelectedModel(
  _models?: AiChatAuthorInfo[],
): string {
  return FIXED_MODEL_ID;
}

export function persistSelectedModel(_modelId: string | null): void {
  localStorage.setItem(LAST_SELECTED_MODEL_KEY, FIXED_MODEL_ID);
}

export function toModelSelectValue(_modelId: string | null): string {
  return FIXED_MODEL_ID;
}

export function fromModelSelectValue(_value: string): string {
  return FIXED_MODEL_ID;
}
