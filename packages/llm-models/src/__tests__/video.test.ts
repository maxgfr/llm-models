import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { setCacheEnabled } from "../cache-core";
import {
  describeOpenApiVideoInput,
  enrichVideoModel,
  fromGateway,
  fromOpenRouter,
  listVideoModels,
  openRouterPrices,
  videoMatchKey,
} from "../functions/video";
import {
  filterVideoModels,
  rendersFromText,
  shortSide,
  type VideoModel,
  videoPricePerSecond,
  videoSize,
} from "../video";
import fal from "./fixtures/video/fal-text-to-video.json";
import gateway from "./fixtures/video/gateway-models.json";
import openrouter from "./fixtures/video/openrouter-videos.json";

beforeAll(() => setCacheEnabled(false));

const modelsDev = {
  xai: {
    id: "xai",
    name: "xAI",
    doc: "https://docs.x.ai",
    env: ["XAI_API_KEY"],
    npm: "@ai-sdk/xai",
    models: {
      "grok-imagine-video-1.5": {
        id: "grok-imagine-video-1.5",
        name: "Grok Imagine Video 1.5",
        attachment: true,
        reasoning: false,
        tool_call: false,
        open_weights: false,
        release_date: "2026-05-30",
        last_updated: "2026-05-30",
        modalities: { input: ["text", "image", "audio"], output: ["video"] },
        limit: { context: 1024, output: 0 },
      },
      "grok-5": {
        id: "grok-5",
        name: "Grok 5",
        attachment: true,
        reasoning: true,
        tool_call: true,
        open_weights: false,
        release_date: "2026-01-01",
        last_updated: "2026-01-01",
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 256000, output: 32000 },
      },
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
    if (url.startsWith("https://openrouter.ai/api/v1/videos/models")) return answer(openrouter);
    if (url.startsWith("https://ai-gateway.vercel.sh/v1/models")) return answer(gateway);
    if (url.startsWith("https://api.fal.ai/v1/models")) return answer(fal);
    if (url.startsWith("https://models.dev")) return answer(modelsDev);
    return new Response("not found", { status: 404, statusText: "Not Found" });
  }) as typeof fetch;
  return calls;
}

const kling = () => fromOpenRouter(openrouter.data.find((m) => m.id === "kwaivgi/kling-v3.0-pro")!);

describe("video model sources", () => {
  it("reads OpenRouter's settings, its maker's name and its per-second prices", () => {
    const m = kling();
    expect(m).toMatchObject({
      provider: "openrouter",
      id: "kwaivgi/kling-v3.0-pro",
      name: "Kling Video v3.0 Pro",
      owner: "kwaivgi",
      aspectRatios: ["16:9", "9:16", "1:1"],
      resolutions: ["720p"],
      audio: true,
    });
    expect(m.durations?.[0]).toBe(3);
    expect(rendersFromText(m)).toBe(true);
    expect(videoPricePerSecond(m, { resolution: "720p", audio: true })).toBe(0.168);
    expect(videoPricePerSecond(m, { resolution: "720p", audio: false })).toBe(0.112);
  });

  it("turns OpenRouter's SKUs into dollars per second, and leaves the other units out", () => {
    expect(
      openRouterPrices({
        cents_per_video_output_second_720p: "8",
        duration_seconds_without_audio: "0.05",
        cents_per_image_input: "1",
        video_tokens: "0.0000107",
        cents_per_megapixel_second_precise: "3.5",
      }),
    ).toEqual([
      { usdPerSecond: 0.08, resolution: "720p" },
      { usdPerSecond: 0.05, audio: false },
    ]);
  });

  it("reads the AI Gateway's operations, settings, prompt limit and prices", () => {
    const entry = gateway.data.find((m) => m.id === "klingai/kling-v3.0-t2v")!;
    const m = fromGateway(entry as Parameters<typeof fromGateway>[0]);
    expect(m).toMatchObject({
      provider: "gateway",
      operations: ["text-to-video"],
      resolutions: ["720p", "1080p", "4k"],
      audio: true,
    });
    expect(videoPricePerSecond(m, { audio: true })).toBe(0.392);
  });

  it("reads the settings of an OpenAPI input schema, refs followed", () => {
    const described = describeOpenApiVideoInput({
      components: {
        schemas: {
          Input: {
            required: ["prompt"],
            properties: {
              prompt: { type: "string" },
              duration: { allOf: [{ $ref: "#/components/schemas/duration" }], default: 5 },
              aspect_ratio: { enum: ["16:9", "9:16", "auto"] },
              resolution: { enum: ["1080P", "720P"] },
              generate_audio: { type: "boolean", default: true },
              start_image: { type: "string", format: "uri" },
            },
          },
          duration: { enum: ["5s", "10s"] },
        },
      },
    });
    expect(described).toEqual({
      operations: ["text-to-video", "image-to-video"],
      inputs: ["text", "image"],
      durations: [5, 10],
      aspectRatios: ["16:9", "9:16"],
      resolutions: ["720p", "1080p"],
      audio: true,
      seed: null,
      frameImages: ["first_frame"],
    });
    expect(
      describeOpenApiVideoInput({
        components: {
          schemas: {
            Input: {
              required: ["image", "prompt"],
              properties: { prompt: {}, image: {}, duration: { minimum: 2, maximum: 4 } },
            },
          },
        },
      }),
    ).toMatchObject({ operations: ["image-to-video"], durations: [2, 3, 4] });
    expect(describeOpenApiVideoInput({})).toBeNull();
  });

  it("matches a model across services", () => {
    expect(videoMatchKey("x-ai/grok-imagine-video-1.5")).toBe(
      videoMatchKey("grok-imagine-video-1.5"),
    );
    expect(videoMatchKey("veo-3.1-fast-generate-preview")).toBe(
      videoMatchKey("google/veo-3.1-fast"),
    );
  });
});

describe("listVideoModels", () => {
  it("lists every service that needs no key, xAI's settings filled from its twins", async () => {
    const calls = fakeServices();
    const models = await listVideoModels();
    const providers = new Set(models.map((m) => m.provider));
    expect([...providers].sort()).toEqual(["fal", "gateway", "openrouter", "xai"]);
    const grok = models.find((m) => m.provider === "xai" && m.id === "grok-imagine-video-1.5")!;
    // OpenRouter says nothing of its sound; the Gateway does.
    expect(grok).toMatchObject({ durations: expect.any(Array), audio: true, prices: [] });
    expect(models.some((m) => m.id === "grok-5")).toBe(false);
    expect(models.some((m) => m.id === "anthropic/claude-sonnet-4.5")).toBe(false);
    expect(calls.some((c) => c.url.includes("replicate"))).toBe(false);
  });

  it("keeps answering when a source fails", async () => {
    fakeServices({
      "ai-gateway.vercel.sh": () => new Response("down", { status: 503, statusText: "Down" }),
    });
    const models = await listVideoModels({ providers: ["openrouter", "gateway"] });
    expect(models.length).toBe(openrouter.data.length);
  });

  it("lists Google's Veo models and Replicate's collection with their keys, in headers", async () => {
    const calls = fakeServices({
      "generativelanguage.googleapis.com": () =>
        new Response(
          JSON.stringify({
            models: [
              {
                name: "models/veo-3.1-fast-generate-preview",
                displayName: "Veo 3.1 Fast",
                supportedGenerationMethods: ["predictLongRunning"],
              },
              { name: "models/gemini-3-pro", supportedGenerationMethods: ["generateContent"] },
            ],
          }),
        ),
      "api.replicate.com": () =>
        new Response(
          JSON.stringify({
            models: [
              {
                owner: "wan-video",
                name: "wan-3.0-t2v",
                latest_version: {
                  openapi_schema: {
                    components: {
                      schemas: {
                        Input: { properties: { prompt: {}, num_seconds: { enum: [5, 8] } } },
                      },
                    },
                  },
                },
              },
            ],
          }),
        ),
    });
    const models = await listVideoModels({
      providers: ["google", "replicate"],
      googleApiKey: "g-key",
      replicateApiToken: "r-token",
    });
    const veo = models.find((m) => m.id === "veo-3.1-fast-generate-preview")!;
    expect(veo).toMatchObject({ provider: "google", name: "Veo 3.1 Fast" });
    // Its settings come from OpenRouter's Veo 3.1 Fast; its prices are not OpenRouter's.
    expect(veo).toMatchObject({ durations: [4, 6, 8], prices: [] });
    expect(models.find((m) => m.provider === "replicate")).toMatchObject({
      id: "wan-video/wan-3.0-t2v",
      durations: [5, 8],
    });
    expect(models.some((m) => m.id === "gemini-3-pro")).toBe(false);
    const google = calls.find((c) => c.url.includes("googleapis"))!;
    expect(google.url).not.toContain("g-key");
    expect(google.headers["x-goog-api-key"]).toBe("g-key");
    expect(calls.find((c) => c.url.includes("replicate"))?.headers.Authorization).toBe(
      "Bearer r-token",
    );
  });
});

describe("video helpers", () => {
  it("sizes a resolution in a format", () => {
    expect(videoSize("720p", "16:9")).toBe("1280x720");
    expect(videoSize("1080p", "9:16")).toBe("1080x1920");
    expect(videoSize("4k", "1:1")).toBe("2160x2160");
    expect(videoSize("hd", "16:9")).toBeNull();
    expect(shortSide("768P")).toBe(768);
  });

  it("filters by provider, operation and text", () => {
    const models: VideoModel[] = [kling(), enrichVideoModel(kling(), [])];
    expect(filterVideoModels(models, { query: "KLING" })).toHaveLength(2);
    expect(filterVideoModels(models, { provider: "fal" })).toHaveLength(0);
    expect(filterVideoModels(models, { operation: "text-to-video" })).toHaveLength(2);
  });
});
