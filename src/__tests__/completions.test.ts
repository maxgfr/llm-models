import { describe, expect, it } from "bun:test";
import {
  generateBashCompletion,
  generateFishCompletion,
  generateZshCompletion,
} from "../completions";

describe("generateBashCompletion", () => {
  it("returns a string with bash header", () => {
    const result = generateBashCompletion();
    expect(result).toContain("# bash completion for llm-models");
    expect(result).toContain("_llm_models");
    expect(result).toContain("complete -F _llm_models llm-models");
  });

  it("includes all commands", () => {
    const result = generateBashCompletion();
    for (const cmd of [
      "find",
      "compare",
      "provider",
      "cost",
      "cheapest",
      "recommend",
      "stats",
      "diff",
      "info",
      "cache",
      "config",
      "mcp",
    ]) {
      expect(result).toContain(cmd);
    }
  });

  it("includes capabilities for completion", () => {
    const result = generateBashCompletion();
    expect(result).toContain("reasoning");
    expect(result).toContain("tool_call");
    expect(result).toContain("structured_output");
  });

  it("includes sort fields", () => {
    const result = generateBashCompletion();
    expect(result).toContain("cost_input");
    expect(result).toContain("context_length");
    expect(result).toContain("knowledge_cutoff");
    expect(result).toContain("value");
  });

  it("includes output formats", () => {
    const result = generateBashCompletion();
    expect(result).toContain("table");
    expect(result).toContain("json");
    expect(result).toContain("csv");
    expect(result).toContain("markdown");
  });
});

describe("generateZshCompletion", () => {
  it("returns a string with zsh header", () => {
    const result = generateZshCompletion();
    expect(result).toContain("#compdef llm-models");
    expect(result).toContain("_llm_models");
    expect(result).toContain("_arguments");
  });

  it("includes commands and flags", () => {
    const result = generateZshCompletion();
    expect(result).toContain("find");
    expect(result).toContain("--json");
    expect(result).toContain("--no-cache");
    expect(result).toContain("--quiet");
    expect(result).toContain("--verbose");
  });
});

describe("generateFishCompletion", () => {
  it("returns a string with fish header", () => {
    const result = generateFishCompletion();
    expect(result).toContain("# fish completion for llm-models");
    expect(result).toContain("complete -c llm-models");
  });

  it("includes all commands", () => {
    const result = generateFishCompletion();
    expect(result).toContain("__fish_use_subcommand");
    expect(result).toContain("find");
    expect(result).toContain("recommend");
    expect(result).toContain("stats");
  });

  it("includes flag completions", () => {
    const result = generateFishCompletion();
    expect(result).toContain("-l json");
    expect(result).toContain("-l no-cache");
    expect(result).toContain("-l quiet");
  });
});
