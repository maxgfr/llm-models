import type { z } from "zod";
import { readCache, writeCache } from "../cache-core";
import {
  GatewayImageModelSchema,
  OpenAIModelSchema,
  OpenRouterImageModelSchema,
} from "../schemas/image";
import { type FetchOptions, fetchJson } from "./http";
import {
  each,
  type FalModel,
  fetchFalCategoryModels,
  fetchGoogleModels,
  fetchReplicateCollection,
  GATEWAY_MODELS_URL,
  type GoogleModel,
  listOf,
  type ReplicateModel,
} from "./video";

export type OpenRouterImageModel = z.infer<typeof OpenRouterImageModelSchema>;
export type GatewayImageModel = z.infer<typeof GatewayImageModelSchema>;
export type OpenAIModel = z.infer<typeof OpenAIModelSchema>;

export const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images/models";
export const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
export const REPLICATE_IMAGE_COLLECTION_URL =
  "https://api.replicate.com/v1/collections/text-to-image";

/** The fal.ai categories llm-models lists image models from. */
export const FAL_IMAGE_CATEGORIES = ["text-to-image", "image-to-image"] as const;

/** OpenRouter's image models, with their typed settings. No key needed. */
export async function fetchOpenRouterImageModels(
  options: FetchOptions = {},
): Promise<OpenRouterImageModel[]> {
  const cached = readCache<OpenRouterImageModel[]>("openrouter-images");
  if (cached) return cached;
  const json = await fetchJson(OPENROUTER_IMAGES_URL, "OpenRouter images", options);
  const models = each(
    listOf(json, "data", "OpenRouter images"),
    OpenRouterImageModelSchema,
    "OpenRouter images",
  ).filter((m) => !m.id.startsWith("openrouter/"));
  writeCache("openrouter-images", models);
  return models;
}

/** The AI Gateway's image models, with their per-image prices. No key needed. */
export async function fetchGatewayImageModels(
  options: FetchOptions = {},
): Promise<GatewayImageModel[]> {
  const cached = readCache<GatewayImageModel[]>("gateway-images");
  if (cached) return cached;
  const json = await fetchJson(GATEWAY_MODELS_URL, "AI Gateway", options);
  const images = listOf(json, "data", "AI Gateway").filter(
    (m) => (m as { type?: unknown } | null)?.type === "image",
  );
  const models = each(images, GatewayImageModelSchema, "AI Gateway");
  writeCache("gateway-images", models);
  return models;
}

/** fal.ai's active text-to-image and image-to-image models. No key needed. */
export async function fetchFalImageModels(options: FetchOptions = {}): Promise<FalModel[]> {
  return fetchFalCategoryModels(FAL_IMAGE_CATEGORIES, options);
}

/** Replicate's text-to-image collection, with each model's input schema. Needs a token. */
export async function fetchReplicateImageModels(
  apiToken: string,
  options: FetchOptions = {},
): Promise<ReplicateModel[]> {
  return fetchReplicateCollection(REPLICATE_IMAGE_COLLECTION_URL, apiToken, options);
}

/** The Gemini API's image models (Imagen, Gemini image) the key can call. */
export async function fetchGoogleImageModels(
  apiKey: string,
  options: FetchOptions = {},
): Promise<GoogleModel[]> {
  return fetchGoogleModels(apiKey, (m) => /imagen|-image(?:-|$)/i.test(m.name), options);
}

/** OpenAI's image models (gpt-image, DALL·E) the key can call. */
export async function fetchOpenAIImageModels(
  apiKey: string,
  options: FetchOptions = {},
): Promise<OpenAIModel[]> {
  const json = await fetchJson(OPENAI_MODELS_URL, "OpenAI", options, {
    Authorization: `Bearer ${apiKey}`,
  });
  return each(listOf(json, "data", "OpenAI"), OpenAIModelSchema, "OpenAI").filter((m) =>
    /^(gpt-image|chatgpt-image|dall-e)/.test(m.id),
  );
}
