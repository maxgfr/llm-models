import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { setCacheEnabled } from "../cache-core";
import {
  describeFalImageModel,
  describeOpenApiImageInput,
  enrichImageModel,
  fromGatewayImage,
  fromOpenRouterImage,
  gatewayImagePrices,
  listImageModels,
} from "../functions/image";
import { filterImageModels, type ImageModel, imagePrice, rendersImageFromText } from "../image";
import falSchnell from "./fixtures/image/fal-flux-schnell-openapi.json";
import fal from "./fixtures/image/fal-text-to-image.json";
import gateway from "./fixtures/image/gateway-models.json";
import openrouter from "./fixtures/image/openrouter-images.json";

beforeAll(() => setCacheEnabled(false));

const devModel = (id: string, name: string, input: string[], output: string[], extra = {}) => ({
  id,
  name,
  attachment: true,
  reasoning: false,
  tool_call: false,
  open_weights: false,
  release_date: "2026-04-21",
  last_updated: "2026-04-21",
  modalities: { input, output },
  limit: { context: 0, output: 0 },
  ...extra,
});

const modelsDev = {
  openai: {
    id: "openai",
    name: "OpenAI",
    doc: "https://platform.openai.com/docs",
    env: ["OPENAI_API_KEY"],
    npm: "@ai-sdk/openai",
    models: {
      "gpt-image-2": devModel("gpt-image-2", "gpt-image-2", ["text", "image"], ["image"]),
      "gpt-image-1.5": devModel("gpt-image-1.5", "gpt-image-1.5", ["text", "image"], ["image"], {
        status: "deprecated",
      }),
      "gpt-5": devModel("gpt-5", "GPT-5", ["text", "image"], ["text"]),
    },
  },
  google: {
    id: "google",
    name: "Google",
    doc: "https://ai.google.dev",
    env: ["GEMINI_API_KEY"],
    npm: "@ai-sdk/google",
    models: {
      "gemini-3-pro-image": devModel(
        "gemini-3-pro-image",
        "Nano Banana Pro",
        ["text", "image"],
        ["text", "image"],
      ),
      "deep-research-preview-04-2026": devModel(
        "deep-research-preview-04-2026",
        "Deep Research Preview",
        ["text", "image", "pdf"],
        ["text", "image"],
      ),
    },
  },
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A fetch that answers each service with its fixture, and records the calls. */
function fakeServices(overrides: Record<string, () => Response> = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const answer = (body: unknown) => new Response(JSON.stringify(body));
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    for (const [part, respond] of Object.entries(overrides))
      if (url.includes(part)) return respond();
    if (url.startsWith("https://openrouter.ai/api/v1/images/models")) return answer(openrouter);
    if (url.startsWith("https://ai-gateway.vercel.sh/v1/models")) return answer(gateway);
    if (url.includes("api.fal.ai/v1/models?endpoint_id=")) return answer(falSchnell);
    if (url.startsWith("https://api.fal.ai/v1/models")) return answer(fal);
    if (url.startsWith("https://models.dev")) return answer(modelsDev);
    return new Response("not found", { status: 404, statusText: "Not Found" });
  }) as typeof fetch;
  return calls;
}

const routerEntry = (id: string) => {
  const entry = openrouter.data.find((m) => m.id === id);
  if (!entry) throw new Error(`no fixture ${id}`);
  return fromOpenRouterImage(entry as Parameters<typeof fromOpenRouterImage>[0]);
};
const gatewayEntry = (id: string) => {
  const entry = gateway.data.find((m) => m.id === id);
  if (!entry) throw new Error(`no fixture ${id}`);
  return fromGatewayImage(entry as Parameters<typeof fromGatewayImage>[0]);
};

describe("image model sources", () => {
  it("reads OpenRouter's typed settings, its maker's name and no token price", () => {
    const m = routerEntry("openai/gpt-image-2");
    expect(m).toMatchObject({
      provider: "openrouter",
      owner: "openai",
      name: "OpenAI GPT Image 2",
      operations: ["text-to-image", "image-edit"],
      inputs: ["text", "image"],
      maxImagesPerCall: 10,
      seed: false,
      prices: [],
    });
    expect(m.aspectRatios).toContain("16:9");
    expect(m.aspectRatios).not.toContain("auto");
    expect(m.released).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("tells an edit-only model (a reference image required) from one that draws", () => {
    expect(routerEntry("krea/k3-edit").operations).toEqual(["image-edit"]);
    expect(rendersImageFromText(routerEntry("krea/k3-edit"))).toBe(false);
    expect(routerEntry("krea/k3-edit").seed).toBe(true);
    expect(routerEntry("black-forest-labs/flux-3-image").seed).toBe(false);
  });

  it("reads the AI Gateway's per-image prices, by size and quality", () => {
    const flux = gatewayEntry("bfl/flux-3-image");
    expect(flux).toMatchObject({ provider: "gateway", owner: "bfl" });
    expect(imagePrice(flux)).toBe(0.048);
    expect(imagePrice(flux, { size: "2048x2048" })).toBe(0.1);
    const grok = gatewayEntry("spacexai/grok-imagine-image-2.0");
    // Between the plain price and the low-quality one, the highest.
    expect(imagePrice(grok)).toBe(0.06);
    expect(imagePrice(grok, { quality: "low" })).toBe(0.04);
    expect(imagePrice(grok, { size: "2048x2048" })).toBe(0.08);
    expect(imagePrice(grok, { size: "2048x2048", quality: "low" })).toBe(0.06);
    // A style surcharge (vector art) is not the price of a plain image.
    expect(
      gatewayImagePrices(gateway.data.find((m) => m.id === "recraft/recraft-v4")?.pricing as never),
    ).toEqual([{ usd: 0.04, per: "image" }]);
    // Token-billed: no per-image price.
    expect(gatewayEntry("openai/gpt-image-2").prices).toEqual([]);
    expect(gatewayEntry("meta/muse-image-1.0").operations).toEqual(["text-to-image", "image-edit"]);
  });

  it("counts a per-megapixel price for the size asked", () => {
    const model = { prices: [{ usd: 0.03, per: "megapixel" as const }] };
    expect(imagePrice(model, { size: "1000x1000" })).toBeCloseTo(0.03);
    expect(imagePrice(model, { size: "2000x1000" })).toBeCloseTo(0.06);
    expect(imagePrice(model)).toBeCloseTo(0.03 * 1.048576);
    expect(imagePrice({ prices: [] })).toBeNull();
  });

  it("reads fal.ai's schema: named sizes, images per call, seed", () => {
    const described = describeOpenApiImageInput(falSchnell.models[0]?.openapi);
    expect(described).toEqual({
      operations: ["text-to-image"],
      inputs: ["text"],
      aspectRatios: ["1:1", "3:4", "9:16", "4:3", "16:9"],
      sizes: ["1024x1024", "512x512", "768x1024", "576x1024", "1024x768", "1024x576"],
      maxImagesPerCall: 4,
      seed: true,
    });
  });

  it("reads a Replicate-style schema: an image it needs makes it an edit model", () => {
    expect(
      describeOpenApiImageInput({
        components: {
          schemas: {
            Input: {
              required: ["prompt", "input_image"],
              properties: {
                prompt: { type: "string", maxLength: 2000 },
                input_image: { type: "string", format: "uri" },
                aspect_ratio: { allOf: [{ $ref: "#/components/schemas/aspect_ratio" }] },
                size: { enum: ["1024*1024", "1536*1024", "hd"] },
                num_outputs: { type: "integer", maximum: 4 },
              },
            },
            aspect_ratio: { enum: ["1:1", "16:9", "match_input_image"] },
          },
        },
      }),
    ).toEqual({
      operations: ["image-edit"],
      inputs: ["text", "image"],
      aspectRatios: ["1:1", "16:9"],
      sizes: ["1024x1024", "1536x1024"],
      maxImagesPerCall: 4,
      seed: null,
      maxPromptChars: 2000,
    });
    expect(describeOpenApiImageInput({})).toBeNull();
  });
});

describe("listImageModels", () => {
  it("lists every service that needs no key, direct providers filled from their twins", async () => {
    const calls = fakeServices();
    const models = await listImageModels();
    const providers = [...new Set(models.map((m) => m.provider))].sort();
    expect(providers).toEqual(["fal", "gateway", "google", "openai", "openrouter"]);
    // fal: active models only, tagged with their category.
    expect(models.filter((m) => m.provider === "fal").map((m) => m.id)).toEqual([
      "fal-ai/flux/schnell",
      "fal-ai/nano-banana-pro",
      "fal-ai/nano-banana-2",
      // The image-to-image page answers the same fixture: listed again, as edits.
      "fal-ai/flux/schnell",
      "fal-ai/nano-banana-pro",
      "fal-ai/nano-banana-2",
    ]);
    const gpt = models.find((m) => m.provider === "openai" && m.id === "gpt-image-2");
    // Settings from OpenRouter's GPT Image 2; its prices are not OpenRouter's or the Gateway's.
    expect(gpt).toMatchObject({ maxImagesPerCall: 10, prices: [] });
    expect(gpt?.aspectRatios).toContain("16:9");
    const banana = models.find((m) => m.provider === "google");
    expect(banana).toMatchObject({ id: "gemini-3-pro-image", operations: expect.any(Array) });
    expect(models.some((m) => m.id === "deep-research-preview-04-2026")).toBe(false);
    expect(models.some((m) => m.id === "gpt-image-1.5")).toBe(false);
    expect(models.some((m) => m.id === "alibaba/qwen-3-14b")).toBe(false);
    expect(calls.some((c) => c.url.includes("replicate"))).toBe(false);
  });

  it("keeps answering when a source fails", async () => {
    fakeServices({
      "ai-gateway.vercel.sh": () => new Response("down", { status: 503, statusText: "Down" }),
    });
    const models = await listImageModels({ providers: ["openrouter", "gateway"] });
    expect(models.length).toBe(openrouter.data.length);
  });

  it("lists OpenAI's, Google's and Replicate's own models with their keys, in headers", async () => {
    const calls = fakeServices({
      "api.openai.com": () =>
        Response.json({ data: [{ id: "gpt-image-2", created: 1776729600 }, { id: "gpt-5" }] }),
      "generativelanguage.googleapis.com": () =>
        Response.json({
          models: [
            { name: "models/imagen-5.0-generate-001", displayName: "Imagen 5" },
            { name: "models/gemini-3-pro" },
          ],
        }),
      "api.replicate.com": () =>
        Response.json({
          models: [
            {
              owner: "black-forest-labs",
              name: "flux-3-pro",
              latest_version: {
                openapi_schema: {
                  components: {
                    schemas: {
                      Input: {
                        properties: { prompt: {}, seed: {}, aspect_ratio: { enum: ["1:1"] } },
                      },
                    },
                  },
                },
              },
            },
          ],
        }),
    });
    const models = await listImageModels({
      providers: ["openai", "google", "replicate"],
      openaiApiKey: "o-key",
      googleApiKey: "g-key",
      replicateApiToken: "r-token",
    });
    expect(models.find((m) => m.provider === "google" && m.id.startsWith("imagen"))).toMatchObject({
      name: "Imagen 5",
      operations: ["text-to-image"],
    });
    expect(models.some((m) => m.id === "gemini-3-pro")).toBe(false);
    expect(models.filter((m) => m.provider === "openai").map((m) => m.id)).toEqual(["gpt-image-2"]);
    expect(models.find((m) => m.provider === "replicate")).toMatchObject({
      id: "black-forest-labs/flux-3-pro",
      aspectRatios: ["1:1"],
      seed: true,
    });
    for (const [host, key] of [
      ["api.openai.com", "o-key"],
      ["googleapis", "g-key"],
      ["replicate", "r-token"],
    ] as const) {
      const call = calls.find((c) => c.url.includes(host));
      expect(call?.url).not.toContain(key);
      expect(Object.values(call?.headers ?? {}).join(" ")).toContain(key);
    }
  });

  it("describes one fal.ai endpoint from its schema", async () => {
    fakeServices();
    expect(await describeFalImageModel("fal-ai/flux/schnell")).toMatchObject({
      provider: "fal",
      name: "FLUX.1 [schnell]",
      maxImagesPerCall: 4,
      seed: true,
    });
  });
});

describe("image helpers", () => {
  it("fills a direct model from a twin, never its prices", () => {
    const direct: ImageModel = {
      provider: "xai",
      id: "grok-imagine-image",
      name: "Grok Imagine Image",
      owner: "xai",
      operations: [],
      inputs: ["text"],
      aspectRatios: null,
      sizes: null,
      maxImagesPerCall: null,
      seed: null,
      prices: [],
    };
    const filled = enrichImageModel(direct, [gatewayEntry("spacexai/grok-imagine-image")]);
    expect(filled).toMatchObject({ operations: ["text-to-image"], prices: [] });
  });

  it("filters by provider, operation and text", () => {
    const models = [routerEntry("openai/gpt-image-2"), routerEntry("krea/k3-edit")];
    expect(filterImageModels(models, { query: "GPT" })).toHaveLength(1);
    expect(filterImageModels(models, { provider: "fal" })).toHaveLength(0);
    expect(filterImageModels(models, { operation: "text-to-image" })).toHaveLength(1);
    expect(filterImageModels(models, { operation: "image-edit" })).toHaveLength(2);
  });
});
