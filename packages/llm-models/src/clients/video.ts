import type { z } from "zod";
import { readCache, writeCache } from "../cache-core";
import { debug } from "../log";
import {
  FalListingSchema,
  FalModelSchema,
  GatewayVideoModelSchema,
  GoogleModelSchema,
  OpenRouterVideoModelSchema,
  ReplicateModelSchema,
} from "../schemas/video";
import { type FetchOptions, fetchJson } from "./http";

export type OpenRouterVideoModel = z.infer<typeof OpenRouterVideoModelSchema>;
export type GatewayVideoModel = z.infer<typeof GatewayVideoModelSchema>;
export type FalModel = z.infer<typeof FalModelSchema>;
export type GoogleModel = z.infer<typeof GoogleModelSchema>;
export type ReplicateModel = z.infer<typeof ReplicateModelSchema>;

export const OPENROUTER_VIDEOS_URL = "https://openrouter.ai/api/v1/videos/models";
export const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
export const FAL_MODELS_URL = "https://api.fal.ai/v1/models";
export const GOOGLE_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";
export const REPLICATE_COLLECTION_URL = "https://api.replicate.com/v1/collections/text-to-video";

// fal pages by 100; a few pages hold every active video model of a category.
const FAL_MAX_PAGES = 8;
/** The fal.ai categories llm-models lists. */
export const FAL_VIDEO_CATEGORIES = ["text-to-video", "image-to-video"] as const;

/** Keep the entries that match `schema`, and say how many were dropped. */
function each<T>(entries: unknown[], schema: z.ZodType<T>, label: string): T[] {
  const kept: T[] = [];
  for (const entry of entries) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) kept.push(parsed.data);
  }
  if (kept.length < entries.length)
    debug(`${label}: skipped ${entries.length - kept.length} invalid entries`);
  return kept;
}

function listOf(json: unknown, key: string, label: string): unknown[] {
  const list = (json as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(list)) throw new Error(`${label} API returned no "${key}" list`);
  return list;
}

/** OpenRouter's video models, with their settings and prices. No key needed. */
export async function fetchOpenRouterVideoModels(
  options: FetchOptions = {},
): Promise<OpenRouterVideoModel[]> {
  const cached = readCache<OpenRouterVideoModel[]>("openrouter-videos");
  if (cached) return cached;
  const json = await fetchJson(OPENROUTER_VIDEOS_URL, "OpenRouter videos", options);
  const models = each(
    listOf(json, "data", "OpenRouter videos"),
    OpenRouterVideoModelSchema,
    "OpenRouter videos",
  );
  writeCache("openrouter-videos", models);
  return models;
}

/** The AI Gateway's video models, with their settings and prices. No key needed. */
export async function fetchGatewayVideoModels(
  options: FetchOptions = {},
): Promise<GatewayVideoModel[]> {
  const cached = readCache<GatewayVideoModel[]>("gateway-videos");
  if (cached) return cached;
  const json = await fetchJson(GATEWAY_MODELS_URL, "AI Gateway", options);
  const videos = listOf(json, "data", "AI Gateway").filter(
    (m) => (m as { type?: unknown } | null)?.type === "video",
  );
  const models = each(videos, GatewayVideoModelSchema, "AI Gateway");
  writeCache("gateway-videos", models);
  return models;
}

/** fal.ai's active video models of `categories`, in fal's own order. No key needed. */
export async function fetchFalVideoModels(
  options: FetchOptions & { categories?: readonly string[] } = {},
): Promise<FalModel[]> {
  const categories = options.categories ?? FAL_VIDEO_CATEGORIES;
  const cacheKey = `fal-videos-${[...categories].join("+")}`;
  const cached = readCache<FalModel[]>(cacheKey);
  if (cached) return cached;
  const models: FalModel[] = [];
  for (const category of categories) {
    let cursor: string | null | undefined;
    for (let page = 0; page < FAL_MAX_PAGES; page++) {
      const url = `${FAL_MODELS_URL}?category=${encodeURIComponent(category)}&limit=100${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
      }`;
      const listing = FalListingSchema.parse(await fetchJson(url, "fal.ai", options));
      for (const m of each(listing.models, FalModelSchema, "fal.ai")) {
        if (m.metadata?.status && m.metadata.status !== "active") continue;
        models.push({
          ...m,
          metadata: { ...m.metadata, category: m.metadata?.category ?? category },
        });
      }
      cursor = listing.next_cursor;
      if (!listing.has_more || !cursor) break;
    }
  }
  writeCache(cacheKey, models);
  return models;
}

/** One fal.ai endpoint with its OpenAPI schema, which holds its settings. No key needed. */
export async function fetchFalModelSchema(
  endpoint: string,
  options: FetchOptions = {},
): Promise<FalModel | null> {
  const url = `${FAL_MODELS_URL}?endpoint_id=${encodeURIComponent(endpoint)}&expand=openapi-3.0`;
  const listing = FalListingSchema.parse(await fetchJson(url, "fal.ai", options));
  return (
    each(listing.models, FalModelSchema, "fal.ai").find((m) => m.endpoint_id === endpoint) ?? null
  );
}

/** The Gemini API's video models (Veo) the key can call. */
export async function fetchGoogleVideoModels(
  apiKey: string,
  options: FetchOptions = {},
): Promise<GoogleModel[]> {
  const models: GoogleModel[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const url = `${GOOGLE_MODELS_URL}?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const json = await fetchJson(url, "Gemini", options, { "x-goog-api-key": apiKey });
    for (const m of each(listOf(json, "models", "Gemini"), GoogleModelSchema, "Gemini")) {
      if (m.supportedGenerationMethods?.includes("predictLongRunning") && /veo/i.test(m.name))
        models.push(m);
    }
    pageToken = (json as { nextPageToken?: string }).nextPageToken;
    if (!pageToken) break;
  }
  return models;
}

/** Replicate's text-to-video collection, with each model's input schema. Needs a token. */
export async function fetchReplicateVideoModels(
  apiToken: string,
  options: FetchOptions = {},
): Promise<ReplicateModel[]> {
  const json = await fetchJson(REPLICATE_COLLECTION_URL, "Replicate", options, {
    Authorization: `Bearer ${apiToken}`,
  });
  return each(listOf(json, "models", "Replicate"), ReplicateModelSchema, "Replicate");
}
