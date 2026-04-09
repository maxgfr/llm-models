import { describe, expect, it } from "bun:test";
import { formatCapabilities, formatContext, formatCost, parseTokenCount } from "../format";

describe("formatCost", () => {
  it("formats numbers as dollars", () => {
    expect(formatCost(2.5)).toBe("$2.50");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(100.1)).toBe("$100.10");
  });

  it("returns dash for null/undefined", () => {
    expect(formatCost(null)).toBe("-");
    expect(formatCost(undefined)).toBe("-");
  });
});

describe("formatContext", () => {
  it("formats thousands as K", () => {
    expect(formatContext(128000)).toBe("128K");
    expect(formatContext(4096)).toBe("4.1K");
    expect(formatContext(1000)).toBe("1K");
  });

  it("formats millions as M", () => {
    expect(formatContext(1000000)).toBe("1M");
    expect(formatContext(2000000)).toBe("2M");
  });

  it("returns raw number for small values", () => {
    expect(formatContext(512)).toBe("512");
  });
});

describe("parseTokenCount", () => {
  it("parses plain numbers", () => {
    expect(parseTokenCount("500000")).toBe(500000);
    expect(parseTokenCount("100")).toBe(100);
  });

  it("parses K suffix", () => {
    expect(parseTokenCount("100K")).toBe(100000);
    expect(parseTokenCount("100k")).toBe(100000);
    expect(parseTokenCount("1.5K")).toBe(1500);
  });

  it("parses M suffix", () => {
    expect(parseTokenCount("1M")).toBe(1000000);
    expect(parseTokenCount("1m")).toBe(1000000);
    expect(parseTokenCount("2.5M")).toBe(2500000);
  });

  it("throws on invalid input", () => {
    expect(() => parseTokenCount("abc")).toThrow("Invalid token count");
    expect(() => parseTokenCount("")).toThrow("Invalid token count");
  });
});

describe("formatCapabilities", () => {
  it("lists true capabilities", () => {
    expect(formatCapabilities({ reasoning: true, tool_call: true, open_weights: false })).toBe(
      "reasoning, tool_call",
    );
  });

  it("returns empty string when no capabilities", () => {
    expect(formatCapabilities({ reasoning: false })).toBe("");
    expect(formatCapabilities({})).toBe("");
  });
});
