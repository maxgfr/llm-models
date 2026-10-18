// The effort scale and how each provider takes it, from the makers' documentation: Claude 4.7 and
// later take `low` to `max` including `xhigh`, Claude 4.6 takes `low`, `medium`, `high` and `max`,
// older Claude models a thinking budget. A model nobody documented takes none.
import { describe, expect, it } from "bun:test";
import {
  EFFORTS,
  type Effort,
  effortLevels,
  effortWire,
  modelKey,
  usableEffort,
} from "../effort.js";

const LOW_TO_MAX: Effort[] = ["low", "medium", "high", "xhigh", "max"];

describe("the scale", () => {
  it("lists every level, weakest first", () => {
    expect([...EFFORTS]).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
  });

  it("matches model ids without case, dots, variants or dates", () => {
    expect(modelKey("Claude-Sonnet-4-6-20260115")).toBe("claude-sonnet-4-6");
    expect(modelKey("gemini-2.5-flash")).toBe("gemini-2-5-flash");
    expect(modelKey("gpt-5.1:nitro")).toBe("gpt-5-1");
    expect(modelKey("o3-2025-04-16")).toBe("o3");
  });
});

describe("Anthropic", () => {
  it.each([
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "claude-fable-5-1",
    "claude-fable-5",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
  ])("%s takes low to max, xhigh included, and never none", (model) => {
    expect([...effortLevels("anthropic", model)]).toEqual(LOW_TO_MAX);
  });

  it("Claude 4.6 has no xhigh, whatever the date suffix", () => {
    expect([...effortLevels("anthropic", "claude-sonnet-4-6")]).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect([...effortLevels("anthropic", "claude-opus-4-6-20260115")]).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
  });

  it("an undocumented model takes none", () => {
    expect([...effortLevels("anthropic", "claude-unknown-9")]).toEqual([]);
    expect([...effortLevels("anthropic", "claude-3-haiku-20240307")]).toEqual([]);
  });

  it("Claude 4.6 and later send the level as output_config.effort", () => {
    for (const level of LOW_TO_MAX)
      expect(effortWire("anthropic", "claude-opus-5-5", level)).toEqual({
        param: "output_config.effort",
        value: level,
      } as never);
    expect(effortWire("anthropic", "claude-opus-5-5", "none")).toBeNull();
    expect(effortWire("anthropic", "claude-opus-5-5", "minimal")).toBeNull();
    expect(effortWire("anthropic", "claude-sonnet-4-6", "xhigh")).toBeNull();
    expect(effortWire("anthropic", "claude-sonnet-4-6", "max")).toEqual({
      param: "output_config.effort",
      value: "max",
    });
  });

  it("Claude 4.5 takes a thinking budget that grows with the level", () => {
    expect([...effortLevels("anthropic", "claude-haiku-4-5")]).toEqual(["low", "medium", "high"]);
    const budgets = (["low", "medium", "high"] as const).map((level) => {
      const wire = effortWire("anthropic", "claude-haiku-4-5", level);
      if (wire?.param !== "thinking.budget_tokens") throw new Error(JSON.stringify(wire));
      return wire.value;
    });
    for (const b of budgets) {
      expect(Number.isSafeInteger(b)).toBe(true);
      expect(b).toBeGreaterThanOrEqual(1024);
      expect(b).toBeLessThan(64_000);
    }
    expect(budgets[0]).toBeLessThan(budgets[1]);
    expect(budgets[1]).toBeLessThan(budgets[2]);
  });
});

describe("other providers", () => {
  it.each([
    ["openai", "gpt-5", ["minimal", "low", "medium", "high"]],
    ["openai", "gpt-5.1", ["none", "low", "medium", "high"]],
    ["openai", "o3", ["low", "medium", "high"]],
    ["openai", "gpt-4o", []],
    ["google", "gemini-3-pro", ["low", "high"]],
    ["google", "gemini-2.5-flash", ["low", "medium", "high"]],
    ["google", "gemini-2.0-flash", []],
    // A server speaking the same protocol may refuse a parameter it does not know
    ["openai-compatible", "deepseek-reasoner", []],
    ["openai-compatible", "gpt-5", []],
    ["mistral", "mistral-large-latest", []],
    ["my-own-provider", "claude-opus-5-5", []],
  ] as [string, string, Effort[]][])("%s %s", (kind, model, levels) => {
    expect([...effortLevels(kind, model)]).toEqual(levels);
  });

  it("each provider names its own parameter", () => {
    expect(effortWire("openai", "gpt-5", "minimal")).toEqual({
      param: "reasoning.effort",
      value: "minimal",
    });
    expect(effortWire("openai", "gpt-5", "max")).toBeNull();
    expect(effortWire("google", "gemini-3-pro", "high")).toEqual({
      param: "thinkingConfig.thinkingLevel",
      value: "high",
    });
    expect(effortWire("google", "gemini-2.5-flash", "medium")).toEqual({
      param: "thinkingConfig.thinkingBudget",
      value: 8192,
    });
    expect(effortWire("openai-compatible", "deepseek-reasoner", "high")).toBeNull();
  });
});

describe("usableEffort", () => {
  it("keeps a level the model takes and drops the rest", () => {
    expect(usableEffort("xhigh", LOW_TO_MAX)).toBe("xhigh");
    expect(usableEffort("xhigh", ["low", "medium", "high", "max"])).toBeNull();
    expect(usableEffort(null, LOW_TO_MAX)).toBeNull();
    expect(usableEffort(undefined, LOW_TO_MAX)).toBeNull();
    expect(usableEffort("low", [])).toBeNull();
  });
});
