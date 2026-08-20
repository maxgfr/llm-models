import { describe, expect, it } from "bun:test";
import { formatFields, parseFieldList, readField } from "../functions/fields";
import type { UnifiedModel } from "../types";

const model: UnifiedModel = {
  id: "zai-coding-plan/glm-5.3",
  name: "GLM-5.3",
  provider: "zai-coding-plan",
  context_length: 1000000,
  output_limit: 131072,
  cost: { input: 0, output: 0 },
  modalities: { input: ["text"], output: ["text"] },
  capabilities: { tool_call: true },
  sources: { openrouter: false, models_dev: true },
};

describe("parseFieldList", () => {
  it("splits on commas and trims", () => {
    expect(parseFieldList("context_length, output_limit")).toEqual([
      "context_length",
      "output_limit",
    ]);
  });

  it("accepts repeated flags", () => {
    expect(parseFieldList(["id", "cost.input"])).toEqual(["id", "cost.input"]);
  });

  it("drops empty entries", () => {
    expect(parseFieldList("id,,")).toEqual(["id"]);
  });
});

describe("readField", () => {
  it("reads a top-level field", () => {
    expect(readField(model, "context_length")).toBe("1000000");
  });

  it("reads a dotted path", () => {
    expect(readField(model, "cost.input")).toBe("0");
  });

  it("joins arrays with commas", () => {
    expect(readField(model, "modalities.input")).toBe("text");
  });

  it("returns null for a missing field", () => {
    expect(readField(model, "family")).toBeNull();
  });

  it("returns null when the path walks through a non-object", () => {
    expect(readField(model, "context_length.nope")).toBeNull();
  });
});

describe("formatFields", () => {
  it("renders requested fields tab-separated", () => {
    expect(formatFields(model, ["context_length", "output_limit"])).toBe("1000000\t131072");
  });

  it("keeps a column for a missing field so counts stay stable", () => {
    expect(formatFields(model, ["context_length", "family"])).toBe("1000000\t");
  });

  it("returns null when every field is missing", () => {
    expect(formatFields(model, ["family", "tokenizer"])).toBeNull();
  });
});
