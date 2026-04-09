import { describe, expect, it } from "bun:test";
import {
  formatAsCSV,
  formatAsMarkdown,
  formatCapabilities,
  formatContext,
  formatCost,
  formatCostRaw,
  parseTokenCount,
} from "../format";

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

describe("formatCostRaw", () => {
  it("formats numbers as dollars without color", () => {
    expect(formatCostRaw(2.5)).toBe("$2.50");
    expect(formatCostRaw(0)).toBe("$0.00");
    expect(formatCostRaw(100.1)).toBe("$100.10");
  });

  it("returns dash for null/undefined", () => {
    expect(formatCostRaw(null)).toBe("-");
    expect(formatCostRaw(undefined)).toBe("-");
  });
});

describe("formatAsCSV", () => {
  it("generates CSV with headers", () => {
    const csv = formatAsCSV(["Name", "Value"], [["foo", "bar"]]);
    expect(csv).toBe("Name,Value\nfoo,bar");
  });

  it("escapes commas in values", () => {
    const csv = formatAsCSV(["Col"], [["hello, world"]]);
    expect(csv).toContain('"hello, world"');
  });

  it("escapes quotes in values", () => {
    const csv = formatAsCSV(["Col"], [['say "hi"']]);
    expect(csv).toContain('"say ""hi"""');
  });

  it("handles multiple rows", () => {
    const csv = formatAsCSV(
      ["A", "B"],
      [
        ["1", "2"],
        ["3", "4"],
      ],
    );
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("A,B");
    expect(lines[1]).toBe("1,2");
    expect(lines[2]).toBe("3,4");
  });

  it("strips ANSI codes from values", () => {
    const csv = formatAsCSV(["Col"], [["\x1b[32m$2.50\x1b[39m"]]);
    expect(csv).not.toContain("\x1b");
    expect(csv).toContain("$2.50");
  });
});

describe("formatAsMarkdown", () => {
  it("generates markdown table", () => {
    const md = formatAsMarkdown(["Name", "Value"], [["foo", "bar"]]);
    expect(md).toContain("| Name");
    expect(md).toContain("| foo");
    expect(md).toContain("---");
  });

  it("includes separator row", () => {
    const md = formatAsMarkdown(["A", "B"], [["1", "2"]]);
    const lines = md.split("\n");
    expect(lines).toHaveLength(3); // header, separator, data
    expect(lines[1]).toMatch(/^\|[\s-|]+\|$/);
  });

  it("handles multiple rows", () => {
    const md = formatAsMarkdown(["A"], [["1"], ["2"], ["3"]]);
    const lines = md.split("\n");
    expect(lines).toHaveLength(5); // header + separator + 3 data
  });

  it("strips ANSI codes", () => {
    const md = formatAsMarkdown(["Col"], [["\x1b[31mred\x1b[39m"]]);
    expect(md).not.toContain("\x1b");
    expect(md).toContain("red");
  });
});
