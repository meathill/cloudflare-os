import { describe, expect, it } from "vitest";
import { formatSkillUpdatedAt, skillUpdatedAtLabel } from "./skillUpdatedAt";

describe("formatSkillUpdatedAt", () => {
  const now = new Date("2026-09-11T12:00:00Z").getTime();

  it.each([
    ["2026-09-11T11:59:30Z", "刚刚"],
    ["2026-09-11T11:48:00Z", "12 分钟前"],
    ["2026-09-11T08:00:00Z", "4 小时前"],
    ["2026-08-30T12:00:00Z", "12 天前"],
    ["2025-09-11T12:00:00Z", "1 年前"],
  ])("formats %s as %s", (timestamp, expected) => {
    expect(formatSkillUpdatedAt(new Date(timestamp), now)).toBe(expected);
  });

  it("provides an unabbreviated accessible label", () => {
    const date = new Date("2026-09-11T11:48:00Z");
    expect(skillUpdatedAtLabel(date, now)).toBe("12 分钟前更新");
  });
});
