import { describe, expect, it } from "bun:test";
import {
  bold,
  colorizeCost,
  cyan,
  dim,
  gray,
  green,
  isColorEnabled,
  red,
  stripAnsi,
  yellow,
} from "../colors";

describe("color functions", () => {
  it("all color functions return strings", () => {
    expect(typeof bold("test")).toBe("string");
    expect(typeof dim("test")).toBe("string");
    expect(typeof green("test")).toBe("string");
    expect(typeof yellow("test")).toBe("string");
    expect(typeof red("test")).toBe("string");
    expect(typeof cyan("test")).toBe("string");
    expect(typeof gray("test")).toBe("string");
  });

  it("color functions contain original text", () => {
    expect(bold("hello")).toContain("hello");
    expect(green("world")).toContain("world");
    expect(red("error")).toContain("error");
  });

  it("identity passthrough when colors disabled (non-TTY)", () => {
    // In test environment, TTY is typically false so colors are passthrough
    if (!isColorEnabled()) {
      expect(bold("test")).toBe("test");
      expect(green("test")).toBe("test");
      expect(red("test")).toBe("test");
    }
  });
});

describe("stripAnsi", () => {
  it("returns correct length for plain string", () => {
    expect(stripAnsi("hello")).toBe(5);
    expect(stripAnsi("")).toBe(0);
    expect(stripAnsi("test string")).toBe(11);
  });

  it("returns length without ANSI codes", () => {
    // Even if colors are disabled in tests, verify with manual ANSI
    expect(stripAnsi("\x1b[32mhello\x1b[39m")).toBe(5);
    expect(stripAnsi("\x1b[1mbold\x1b[22m")).toBe(4);
    expect(stripAnsi("\x1b[31m\x1b[1mred bold\x1b[22m\x1b[39m")).toBe(8);
  });
});

describe("colorizeCost", () => {
  it("returns dash for null/undefined", () => {
    expect(colorizeCost(null, "-")).toBe("-");
    expect(colorizeCost(undefined, "-")).toBe("-");
  });

  it("returns formatted string", () => {
    const result = colorizeCost(2.5, "$2.50");
    expect(result).toContain("2.50");
  });

  it("returns original string when colors disabled", () => {
    if (!isColorEnabled()) {
      expect(colorizeCost(0, "$0.00")).toBe("$0.00");
      expect(colorizeCost(1, "$1.00")).toBe("$1.00");
      expect(colorizeCost(25, "$25.00")).toBe("$25.00");
    }
  });
});

describe("isColorEnabled", () => {
  it("returns boolean", () => {
    expect(typeof isColorEnabled()).toBe("boolean");
  });
});
