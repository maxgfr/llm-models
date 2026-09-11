import { describe, expect, it } from "bun:test";
import { compareRecency, isEligible, isFast, pickTiers, version } from "../functions/latest";
import type { UnifiedModel } from "../types";

interface Extra {
  date?: string;
  family?: string;
  status?: string;
  tool?: boolean;
  output?: string[];
}

function model(id: string, provider: string, extra: Extra = {}): UnifiedModel {
  return {
    id,
    name: id,
    provider,
    context_length: 1000,
    output_limit: 100,
    modalities: { input: ["text"], output: extra.output ?? ["text"] },
    capabilities: { tool_call: extra.tool ?? true },
    release_date: extra.date,
    status: extra.status,
    family: extra.family,
    sources: { openrouter: false, models_dev: true },
  };
}

function ids(picks: ReturnType<typeof pickTiers>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pick of picks ?? []) out[pick.tier] = pick.model.id;
  return out;
}

const zai = [
  model("zai/glm-4.7", "zai", { date: "2025-12-22" }),
  model("zai/glm-4.7-flash", "zai", { date: "2026-01-19" }),
  model("zai/glm-5", "zai", { date: "2026-02-12" }),
  model("zai/glm-5-turbo", "zai", { date: "2026-03-16" }),
  model("zai/glm-5v-turbo", "zai", { date: "2026-04-01" }),
  model("zai/glm-5.2", "zai", { date: "2026-06-13" }),
  model("zai/glm-5.3", "zai", { date: "2026-08-14" }),
  model("zai/glm-5.3-flash", "zai", { date: "2026-08-26" }),
];

describe("pickTiers", () => {
  it("picks the newest flagship and its fast sibling", () => {
    expect(ids(pickTiers(zai))).toEqual({
      opus: "zai/glm-5.3",
      sonnet: "zai/glm-5.3-flash",
      haiku: "zai/glm-5.3-flash",
    });
  });

  it("does not read 'mini' inside MiniMax as a fast variant", () => {
    const pool = [
      model("minimax/MiniMax-M2.7", "minimax", { date: "2026-03-18" }),
      model("minimax/MiniMax-M2.7-highspeed", "minimax", { date: "2026-03-18" }),
      model("minimax/MiniMax-M3", "minimax", { date: "2026-06-01" }),
      model("minimax/minimax-m3", "minimax"),
    ];
    expect(ids(pickTiers(pool))).toEqual({
      opus: "minimax/MiniMax-M3",
      sonnet: "minimax/MiniMax-M3",
      haiku: "minimax/MiniMax-M3",
    });
    expect(isFast(model("minimax/MiniMax-M3", "minimax"))).toBe(false);
    expect(isFast(model("minimax/MiniMax-M2.7-highspeed", "minimax"))).toBe(true);
  });

  it("keeps every tier on the flagship when its generation has no fast variant", () => {
    const pool = [
      model("moonshotai/kimi-k2.7-code", "moonshotai", { date: "2026-06-12" }),
      model("moonshotai/kimi-k2.7-code-highspeed", "moonshotai", { date: "2026-06-12" }),
      model("moonshotai/kimi-k3", "moonshotai", { date: "2026-07-16" }),
    ];
    expect(ids(pickTiers(pool))).toEqual({
      opus: "moonshotai/kimi-k3",
      sonnet: "moonshotai/kimi-k3",
      haiku: "moonshotai/kimi-k3",
    });
  });

  it("prefers a dated entry over an undated snapshot of the same model", () => {
    const pool = [
      model("deepseek/deepseek-v4-pro-0813", "deepseek"),
      model("deepseek/deepseek-v4-pro", "deepseek", { date: "2026-08-12" }),
      model("deepseek/deepseek-v4-flash-0731", "deepseek"),
      model("deepseek/deepseek-v4-flash", "deepseek", { date: "2026-09-10" }),
      model("deepseek/deepseek-flash", "deepseek", { date: "2026-09-10" }),
      model("deepseek/deepseek-v4.1-flash", "deepseek"),
    ];
    expect(ids(pickTiers(pool))).toEqual({
      opus: "deepseek/deepseek-v4-pro",
      sonnet: "deepseek/deepseek-v4-flash",
      haiku: "deepseek/deepseek-v4-flash",
    });
  });

  it("makes the newest fast model the flagship when nothing else is offered", () => {
    const pool = [
      model("x/thing-2-flash", "x", { date: "2026-01-01" }),
      model("x/thing-3-flash", "x", { date: "2026-02-01" }),
    ];
    expect(ids(pickTiers(pool))).toEqual({
      opus: "x/thing-3-flash",
      sonnet: "x/thing-3-flash",
      haiku: "x/thing-3-flash",
    });
  });

  it("excludes batch routes and moving ~vendor aliases", () => {
    const pool = [
      model("moonshotai/kimi-k3:batch", "moonshotai", { date: "2026-08-01" }),
      model("openrouter/~anthropic/claude-opus-latest", "openrouter", { date: "2026-08-01" }),
      model("moonshotai/kimi-k3", "moonshotai", { date: "2026-07-16" }),
    ];
    expect(ids(pickTiers(pool)).opus).toBe("moonshotai/kimi-k3");
  });

  it("excludes deprecated models", () => {
    const pool = [
      model("zai/glm-6", "zai", { date: "2026-09-01", status: "deprecated" }),
      model("zai/glm-5.3", "zai", { date: "2026-08-14" }),
    ];
    expect(ids(pickTiers(pool)).opus).toBe("zai/glm-5.3");
  });

  it("excludes models that cannot call tools or do not output text", () => {
    const pool = [
      model("minimax/minimax-m2-her", "minimax", { date: "2026-09-01", tool: false }),
      model("alibaba/qwen3-tts", "alibaba", { date: "2026-09-01", output: ["audio"] }),
      model("zai/glm-5.3", "zai", { date: "2026-08-14" }),
    ];
    expect(ids(pickTiers(pool)).opus).toBe("zai/glm-5.3");
    expect(isEligible(model("deepseek/deepseek-r1-distill-llama-70b", "deepseek"))).toBe(false);
  });

  it("excludes vision, preview, experimental and speech variants on whole tokens", () => {
    for (const id of [
      "alibaba/qwen-vl-max",
      "alibaba/qwen3.6-max-preview",
      "deepseek/deepseek-v3.2-exp",
      "alibaba/qwen3-omni-flash",
      "alibaba/qwen-plus-character-ja",
      "alibaba/qwen3-livetranslate-flash-realtime",
      "deepseek/deepseek-v4-flash-vision-exp",
    ]) {
      expect(isEligible(model(id, "x"))).toBe(false);
    }
    // "her", "vl" and "exp" must not fire as substrings of other tokens
    for (const id of ["zai/glm-5.3-flash", "x/hermes-3", "x/explorer-1", "x/vlm-max"]) {
      expect(isEligible(model(id, "x"))).toBe(true);
    }
  });

  it("maps Claude tiers literally when a filter narrows the pool to the claude family", () => {
    const openrouter = [
      model("openrouter/anthropic/claude-fable-5.1", "openrouter", {
        date: "2026-09-01",
        family: "claude-fable",
      }),
      model("openrouter/anthropic/claude-opus-5", "openrouter", {
        date: "2026-07-24",
        family: "claude-opus",
      }),
      model("openrouter/anthropic/claude-sonnet-5", "openrouter", {
        date: "2026-06-30",
        family: "claude-sonnet",
      }),
      model("openrouter/anthropic/claude-sonnet-4.6", "openrouter", {
        date: "2026-02-17",
        family: "claude-sonnet",
      }),
      model("openrouter/anthropic/claude-haiku-4.5", "openrouter", {
        date: "2025-10-15",
        family: "claude-haiku",
      }),
      model("openrouter/~anthropic/claude-sonnet-latest", "openrouter", {
        date: "2026-09-01",
        family: "claude-sonnet",
      }),
      model("openrouter/openai/gpt-6", "openrouter", { date: "2026-09-05", family: "gpt" }),
    ];
    expect(ids(pickTiers(openrouter, "anthropic/"))).toEqual({
      opus: "openrouter/anthropic/claude-opus-5",
      sonnet: "openrouter/anthropic/claude-sonnet-5",
      haiku: "openrouter/anthropic/claude-haiku-4.5",
    });
    // Any Claude entry in the pool switches to the literal mapping; a filter picks another vendor
    expect(ids(pickTiers(openrouter)).opus).toBe("openrouter/anthropic/claude-opus-5");
    expect(ids(pickTiers(openrouter, "openai/")).opus).toBe("openrouter/openai/gpt-6");
  });

  it("falls a missing Claude tier back onto the previous one", () => {
    const pool = [
      model("anthropic/claude-opus-5", "anthropic", { date: "2026-07-24", family: "claude-opus" }),
    ];
    expect(ids(pickTiers(pool))).toEqual({
      opus: "anthropic/claude-opus-5",
      sonnet: "anthropic/claude-opus-5",
      haiku: "anthropic/claude-opus-5",
    });
  });

  it("filters on a family prefix as well as an id substring", () => {
    const pool = [
      model("zai/glm-5.3", "zai", { date: "2026-08-14", family: "glm" }),
      model("zai/other-9", "zai", { date: "2026-09-01", family: "other" }),
    ];
    expect(ids(pickTiers(pool, "GLM")).opus).toBe("zai/glm-5.3");
    expect(ids(pickTiers(pool, "glm-5.3")).opus).toBe("zai/glm-5.3");
  });

  it("returns null for an empty or fully excluded pool", () => {
    expect(pickTiers([])).toBeNull();
    expect(pickTiers(zai, "nothing-here")).toBeNull();
    expect(pickTiers([model("x/y:batch", "x")])).toBeNull();
  });

  it("is deterministic regardless of input order", () => {
    const reversed = [...zai].reverse();
    expect(ids(pickTiers(reversed))).toEqual(ids(pickTiers(zai)));
    const tie = [model("x/bbb-1", "x"), model("x/aaa-1", "x"), model("x/aaaa-1", "x")];
    expect(ids(pickTiers(tie)).opus).toBe("x/aaa-1");
    expect(ids(pickTiers([...tie].reverse())).opus).toBe("x/aaa-1");
  });
});

describe("version", () => {
  it("reads the first dotted number of the last segment", () => {
    expect(version("zai/glm-5.3-flash")).toEqual([5, 3]);
    expect(version("moonshotai/kimi-k2.7-code")).toEqual([2, 7]);
    expect(version("anthropic/claude-opus-4-5")).toEqual([4]);
    expect(version("deepseek/deepseek-chat")).toEqual([0]);
    expect(version("alibaba/qwen3-235b-a22b")).toEqual([3]);
  });
});

describe("compareRecency", () => {
  it("orders dated first, then newest date, then highest version, then shortest id", () => {
    const sorted = [
      model("x/a-1", "x"),
      model("x/a-2", "x", { date: "2026-01-01" }),
      model("x/a-3", "x", { date: "2026-02-01" }),
      model("x/a-2.5", "x", { date: "2026-02-01" }),
      model("x/a-3-long", "x", { date: "2026-02-01" }),
    ]
      .sort(compareRecency)
      .map((m) => m.id);
    expect(sorted).toEqual(["x/a-3", "x/a-3-long", "x/a-2.5", "x/a-2", "x/a-1"]);
  });
});
