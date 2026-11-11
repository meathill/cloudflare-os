import { describe, it, expect } from "vitest";
import { getDoLocationHint, getDoOptions } from "../src/do-location";

describe("do-location", () => {
  it("defaults to apac-ne when DO_LOCATION_HINT is not set", () => {
    expect(getDoLocationHint()).toBe("apac-ne");
    expect(getDoLocationHint({})).toBe("apac-ne");
    expect(getDoLocationHint({ DO_LOCATION_HINT: "" })).toBe("apac-ne");
  });

  it("uses DO_LOCATION_HINT when specified", () => {
    expect(getDoLocationHint({ DO_LOCATION_HINT: "apac" })).toBe("apac");
    expect(getDoLocationHint({ DO_LOCATION_HINT: "apac-ne" })).toBe("apac-ne");
    expect(getDoLocationHint({ DO_LOCATION_HINT: "apac-se" })).toBe("apac-se");
  });

  it("produces get options with locationHint", () => {
    expect(getDoOptions()).toEqual({ locationHint: "apac-ne" });
    expect(getDoOptions({ DO_LOCATION_HINT: "apac" })).toEqual({ locationHint: "apac" });
  });
});
