import { describe, expect, it } from "bun:test";
import catalogJson from "../data/browser-models.json";
import {
  baseId,
  browserModelCatalog,
  describeBrowserModel,
  listBrowserModels,
  QUALITY,
  recommendBrowserModel,
} from "../functions/browser-models";
import {
  BrowserModelCatalogSchema,
  BrowserModelRecommendationSchema,
  BrowserModelSchema,
} from "../schemas/functions";
import type { BrowserModel } from "../types";
import fixtureJson from "./fixtures/browser-models.json";

// A slice of the real extracted catalog (@mlc-ai/web-llm prebuiltAppConfig +
// Hugging Face tensor-cache.json), so the ranking is tested on published numbers.
const fixture = BrowserModelCatalogSchema.parse(fixtureJson);
const models = fixture.models.map(describeBrowserModel);
const byId = (id: string) => models.find((m) => m.id === id) as BrowserModel;

describe("browser model catalog", () => {
  it("the shipped catalog matches its schema and comes from WebLLM", () => {
    const catalog = BrowserModelCatalogSchema.parse(catalogJson);
    expect(catalog.source.package).toBe("@mlc-ai/web-llm");
    expect(catalog.models.length).toBeGreaterThan(50);
    expect(browserModelCatalog().source.version).toBe(catalog.source.version);
  });

  it("every listed model is described and valid", () => {
    const list = listBrowserModels();
    expect(list.length).toBe(browserModelCatalog().models.length);
    for (const m of list) BrowserModelSchema.parse(m);
    expect(new Set(list.map((m) => m.id)).size).toBe(list.length);
  });

  it("listBrowserModels returns copies", () => {
    const first = listBrowserModels()[0] as BrowserModel;
    first.family = "mutated";
    expect(listBrowserModels()[0]?.family).not.toBe("mutated");
  });

  it("rejects a catalog entry without a VRAM figure", () => {
    const [record] = fixture.models;
    const broken = { ...fixture, models: [{ ...record, vram_required_mb: undefined }] };
    expect(BrowserModelCatalogSchema.safeParse(broken).success).toBe(false);
  });

  it("every chat model in the shipped catalog has a known family", () => {
    const unknown = listBrowserModels().filter((m) => m.released === null);
    expect(unknown.map((m) => m.id)).toEqual([]);
  });
});

describe("describeBrowserModel", () => {
  it("reads size and quantization from the id", () => {
    const m = byId("Qwen3.5-4B-q4f16_1-MLC");
    expect(m.family).toBe("qwen");
    expect(m.series).toBe("Qwen3.5");
    expect(m.params_b).toBe(4);
    expect(m.params_source).toBe("id");
    expect(m.quantization).toBe("q4f16_1");
    expect(m.weight_bits).toBe(4);
    expect(m.compute_dtype).toBe("f16");
    expect(m.variant).toBe("chat");
    expect(m.reasoning).toBe(true);
    expect(m.multilingual).toBe(true);
    expect(m.structured_output).toBe(true);
  });

  it("parses millions and underscores", () => {
    expect(byId("SmolLM2-360M-Instruct-q4f16_1-MLC").params_b).toBe(0.36);
    expect(byId("SmolLM2-135M-Instruct-q0f16-MLC").weight_bits).toBe(16);
  });

  it("estimates the size from the weights when the id has none", () => {
    const phi = byId("Phi-3.5-mini-instruct-q4f16_1-MLC");
    expect(phi.params_source).toBe("weights");
    // Microsoft's model card: 3.8B parameters.
    expect(phi.params_b).toBeGreaterThan(3.7);
    expect(phi.params_b).toBeLessThan(3.9);
  });

  it("keeps WebLLM's figures and the download size", () => {
    const m = byId("Llama-3.2-1B-Instruct-q4f16_1-MLC");
    expect(m.vram_required_mb).toBe(879.04);
    expect(m.low_resource_required).toBe(true);
    expect(m.context_window).toBe(4096);
    expect(m.max_context_window).toBe(131072);
    expect(m.download_mb).toBeCloseTo(695.2, 1);
    expect(m.hf_repo).toBe("https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC");
  });

  it("classifies variants", () => {
    expect(byId("Ministral-3-3B-Base-2512-q4f16_1-MLC").variant).toBe("base");
    expect(byId("phi-2-q4f16_1-MLC").variant).toBe("base");
    expect(byId("DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC").variant).toBe("reasoning");
    expect(byId("Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC").variant).toBe("coder");
    expect(byId("Phi-3.5-vision-instruct-q4f16_1-MLC").variant).toBe("vision");
    const embed = byId("snowflake-arctic-embed-s-q0f32-MLC-b4");
    expect(embed.variant).toBe("embedding");
    expect(embed.structured_output).toBe(false);
  });

  it("flags function calling from WebLLM's list", () => {
    expect(byId("Hermes-2-Pro-Mistral-7B-q4f16_1-MLC").function_calling).toBe(true);
    expect(byId("Qwen3-4B-q4f16_1-MLC").function_calling).toBe(false);
  });

  it("baseId drops the quantization and context suffixes", () => {
    expect(baseId("Phi-3.5-mini-instruct-q4f16_1-MLC-1k")).toBe("Phi-3.5-mini-instruct");
    expect(baseId("SmolLM2-135M-Instruct-q0f16-MLC")).toBe("SmolLM2-135M-Instruct");
  });
});

describe("recommendBrowserModel", () => {
  const recommend = (opts: Parameters<typeof recommendBrowserModel>[0]) =>
    recommendBrowserModel(opts, models);

  it("returns null when nothing fits", () => {
    expect(recommend({ vram_budget_mb: 100 })).toBeNull();
  });

  it("a tiny budget gets the smallest low-resource chat model", () => {
    const pick = recommend({ vram_budget_mb: 370 });
    expect(pick?.model.id).toBe("SmolLM2-135M-Instruct-q0f16-MLC");
    expect(pick?.model.low_resource_required).toBe(true);
    expect(pick?.alternatives).toEqual([]);
  });

  it("validates its result", () => {
    const pick = recommend({ vram_budget_mb: 4096 });
    expect(BrowserModelRecommendationSchema.safeParse(pick).success).toBe(true);
  });

  it("4 GB gets a 3-4B model", () => {
    const pick = recommend({ vram_budget_mb: 4096 });
    expect(pick?.model.params_b).toBeGreaterThanOrEqual(3);
    expect(pick?.model.params_b).toBeLessThanOrEqual(4);
    expect(pick?.model.variant).toBe("chat");
    expect(pick?.reason).toContain("4096 MB");
  });

  it("never picks base, coder, vision or embedding models", () => {
    for (const budget of [400, 1000, 2000, 3000, 4000, 6000, 10000]) {
      const pick = recommend({ vram_budget_mb: budget });
      for (const m of [pick?.model, ...(pick?.alternatives ?? [])]) {
        if (m) expect(m.variant).toBe("chat");
      }
    }
  });

  it("prefers q4f16 and lists each model once", () => {
    const pick = recommend({ vram_budget_mb: 4096 });
    expect(pick?.model.quantization).toBe("q4f16_1");
    const bases = [pick?.model, ...(pick?.alternatives ?? [])].map((m) => baseId(m?.id ?? ""));
    expect(new Set(bases).size).toBe(bases.length);
  });

  it("without shader-f16 only f32-compute models remain", () => {
    const pick = recommend({ vram_budget_mb: 4096, shader_f16: false });
    expect(pick?.model.compute_dtype).toBe("f32");
    for (const alt of pick?.alternatives ?? []) expect(alt.compute_dtype).toBe("f32");
  });

  it("a multilingual need picks a multilingual family", () => {
    const pick = recommend({ vram_budget_mb: 2000, needs: ["multilingual"] });
    expect(pick?.model.multilingual).toBe(true);
    expect(pick?.model.family).not.toBe("smollm");
    expect(pick?.reason).toContain("multilingual");
  });

  it("a reasoning need allows reasoning models and requires thinking", () => {
    const pick = recommend({ vram_budget_mb: 6000, needs: ["reasoning"] });
    expect(pick?.model.reasoning).toBe(true);
  });

  it("long_context keeps the widest context", () => {
    const pick = recommend({ vram_budget_mb: 2600, needs: ["long_context"] });
    expect(pick?.model.context_window).toBe(4096);
  });

  it("the download budget excludes larger weights", () => {
    const pick = recommend({ vram_budget_mb: 6000, download_budget_mb: 1000 });
    expect(pick?.model.download_mb).toBeLessThanOrEqual(1000);
  });

  it("low_resource keeps only WebLLM's low-resource models", () => {
    const pick = recommend({ vram_budget_mb: 6000, low_resource: true });
    expect(pick?.model.low_resource_required).toBe(true);
  });

  it("rejects a non-positive budget", () => {
    expect(() => recommend({ vram_budget_mb: 0 })).toThrow();
  });

  it("explains a ranking without published score", () => {
    const pick = recommendBrowserModel({ vram_budget_mb: 700 }, [
      byId("TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC"),
    ]);
    expect(pick?.reason).toContain("No published score");
  });

  it("uses the shipped catalog by default", () => {
    const pick = recommendBrowserModel({ vram_budget_mb: 3000 });
    expect(pick).not.toBeNull();
    expect(listBrowserModels().some((m) => m.id === pick?.model.id)).toBe(true);
  });
});

describe("ranking rules", () => {
  const recommend = (opts: Parameters<typeof recommendBrowserModel>[0]) =>
    recommendBrowserModel(opts, models);

  it("every quality entry names a model of the shipped catalog", () => {
    const bases = new Set(listBrowserModels().map((m) => baseId(m.id)));
    for (const key of Object.keys(QUALITY)) expect(bases.has(key)).toBe(true);
    for (const q of Object.values(QUALITY)) {
      expect(q.metric).toBe("MMLU-Redux");
      expect(q.source.length).toBeGreaterThan(10);
    }
  });

  it("a newer generation without a score ranks at least level with the one it supersedes", () => {
    const pick = recommend({ vram_budget_mb: 4096 });
    expect(pick?.model.id).toBe("Qwen3.5-4B-q4f16_1-MLC");
    expect(pick?.reason).toContain("at least level with Qwen3-4B");
    expect(pick?.alternatives[0]?.id).toBe("Qwen3-4B-q4f16_1-MLC");
  });

  it("a scored model beats a larger unscored one", () => {
    const pick = recommendBrowserModel({ vram_budget_mb: 5000 }, [
      byId("Mistral-7B-Instruct-v0.3-q4f16_1-MLC"),
      byId("Qwen2.5-3B-Instruct-q4f16_1-MLC"),
    ]);
    expect(pick?.model.id).toBe("Qwen2.5-3B-Instruct-q4f16_1-MLC");
    expect(pick?.alternatives.map((m) => m.id)).toEqual(["Mistral-7B-Instruct-v0.3-q4f16_1-MLC"]);
  });

  it("a full 4k context beats a better model squeezed to 1k", () => {
    // Phi-3.5-mini-1k (2520 MB, MMLU-Redux 67.7) against Qwen2.5-3B (2505 MB, 64.4).
    const pick = recommend({ vram_budget_mb: 2600 });
    expect(pick?.model.id).toBe("Qwen2.5-3B-Instruct-q4f16_1-MLC");
  });

  it("says when the context is reduced", () => {
    const pick = recommendBrowserModel({ vram_budget_mb: 2600 }, [
      byId("Phi-3.5-mini-instruct-q4f16_1-MLC-1k"),
    ]);
    expect(pick?.reason).toContain("1024 tokens");
  });

  it("the picks for common budgets on the shipped catalog", () => {
    const pick = (mb: number) => recommendBrowserModel({ vram_budget_mb: mb })?.model.id;
    expect(pick(1500)).toBe("Qwen3-0.6B-q4f16_1-MLC");
    expect(pick(3000)).toBe("Qwen3.5-2B-q4f16_1-MLC");
    expect(pick(6000)).toBe("Qwen3-8B-q4f16_1-MLC");
  });
});

describe("browser-models CLI", () => {
  const cwd = import.meta.dir.replace("/src/__tests__", "");
  async function run(...args: string[]) {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { stdout, stderr, code: await proc.exited };
  }

  it("recommends with a reason", async () => {
    const { stdout, code } = await run("browser-models", "--recommend", "--vram", "3000");
    expect(code).toBe(0);
    expect(stdout).toContain("Recommended:");
    expect(stdout).toContain("Why:");
  });

  it("recommends as JSON through the local alias", async () => {
    const { stdout, code } = await run(
      "local",
      "--recommend",
      "--vram",
      "2000",
      "--need",
      "multilingual,json",
      "--json",
    );
    expect(code).toBe(0);
    const result = BrowserModelRecommendationSchema.parse(JSON.parse(stdout));
    expect(result.model.multilingual).toBe(true);
  });

  it("exits 1 when nothing fits", async () => {
    const { stderr, code } = await run("local", "--recommend", "--vram", "50");
    expect(code).toBe(1);
    expect(stderr).toContain("No browser model fits");
  });

  it("rejects an unknown need", async () => {
    const { stderr, code } = await run(
      "local",
      "--recommend",
      "--vram",
      "2000",
      "--need",
      "vision",
    );
    expect(code).toBe(1);
    expect(stderr).toContain("Allowed needs");
  });

  it("requires --vram with --recommend", async () => {
    const { stderr, code } = await run("local", "--recommend");
    expect(code).toBe(1);
    expect(stderr).toContain("--vram");
  });

  it("lists a family as CSV", async () => {
    const { stdout, code } = await run("browser-models", "--family", "qwen", "--format", "csv");
    expect(code).toBe(0);
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toContain("ID");
    expect(lines.slice(1).every((l) => l.includes(",qwen,"))).toBe(true);
  });
});
