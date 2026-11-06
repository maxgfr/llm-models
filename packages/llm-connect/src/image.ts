// Generate images with any provider's image model, through the AI SDK's
// `generateImage`: OpenRouter (llm-connect's own model), the Vercel AI Gateway,
// fal.ai, OpenAI, Google (Gemini image models), xAI or Replicate. Each SDK is
// imported on first use. Entry `llm-connect/image`.

import type { ImageModelV4, JSONValue } from "@ai-sdk/provider";
import { createOpenRouterImageModel } from "./image-openrouter.js";
import {
  type MediaOptions,
  type MediaProviderInfo,
  mediaFailure,
  missingPackage,
  providerInfoOf,
  warningText,
} from "./media.js";
import { type MediaKeyReport, testMediaKey } from "./media-keys.js";

export type { FetchLike, MediaOptions, MediaProviderInfo } from "./media.js";
export { type MediaKeyReport, testMediaKey } from "./media-keys.js";

export const IMAGE_PROVIDERS = [
  "openrouter",
  "gateway",
  "fal",
  "openai",
  "google",
  "xai",
  "replicate",
] as const;

export type ImageProviderId = (typeof IMAGE_PROVIDERS)[number];

/** Each provider's name, key page, environment variable and package. */
export const IMAGE_PROVIDER_INFO: Readonly<Record<ImageProviderId, MediaProviderInfo>> =
  providerInfoOf(IMAGE_PROVIDERS);

/** Which provider, which key, which model. */
export interface ImageSettings {
  provider: ImageProviderId;
  apiKey: string;
  model: string;
  /** Another base URL for the provider's API (a proxy). */
  baseUrl?: string;
}

export interface ImageRequest {
  prompt: string;
  /** `W:H`, e.g. "16:9". */
  aspectRatio?: string;
  /** `WxH` in pixels, e.g. "1024x1024", for a model that takes a size. */
  size?: string;
  /** How many images. Default 1; split into as many calls as the model needs. */
  n?: number;
  seed?: number;
  /** Body fields for one provider, by provider id: `{ openai: { quality: "high" } }`. */
  providerOptions?: Record<string, Record<string, JSONValue>>;
}

export interface GeneratedImage {
  data: Uint8Array;
  mediaType: string;
}

export interface ImageResult {
  images: GeneratedImage[];
  /** What the provider would not do as asked (a setting it ignored). */
  warnings: string[];
  /** What the calls cost, when the provider reports it (OpenRouter does). */
  costUsd?: number;
}

type ImageProvider = { image(modelId: string): ImageModelV4 };

/** The provider's AI SDK image model, its package imported on demand. */
export async function loadImageModel(
  settings: ImageSettings,
  options: MediaOptions = {},
): Promise<ImageModelV4> {
  const { apiKey, model, baseUrl } = settings;
  const common = {
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    ...(options.fetch ? { fetch: options.fetch as typeof fetch } : {}),
  };
  const missing = (pkg: string) => missingPackage("Generating images", settings.provider, pkg);
  switch (settings.provider) {
    case "openrouter":
      return createOpenRouterImageModel({ apiKey, modelId: model, baseUrl, fetch: options.fetch });
    case "gateway": {
      const { createGateway } = await import("@ai-sdk/gateway").catch(missing("@ai-sdk/gateway"));
      return (createGateway({ apiKey, ...common }) as unknown as ImageProvider).image(model);
    }
    case "fal": {
      const { createFal } = await import("@ai-sdk/fal").catch(missing("@ai-sdk/fal"));
      return (createFal({ apiKey, ...common }) as unknown as ImageProvider).image(model);
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai").catch(missing("@ai-sdk/openai"));
      return (createOpenAI({ apiKey, ...common }) as unknown as ImageProvider).image(model);
    }
    case "google": {
      // @ai-sdk/google's image model serves Gemini image models (`gemini-*-image*`,
      // through generateContent); it refuses any other id, Imagen included.
      if (!model.startsWith("gemini-"))
        throw new Error(
          `Google image generation goes through Gemini image models ("gemini-2.5-flash-image"…); "${model}" is not one.`,
        );
      const { createGoogle } = await import("@ai-sdk/google").catch(missing("@ai-sdk/google"));
      return (createGoogle({ apiKey, ...common }) as unknown as ImageProvider).image(model);
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai").catch(missing("@ai-sdk/xai"));
      return (createXai({ apiKey, ...common }) as unknown as ImageProvider).image(model);
    }
    case "replicate": {
      const { createReplicate } = await import("@ai-sdk/replicate").catch(
        missing("@ai-sdk/replicate"),
      );
      return (createReplicate({ apiToken: apiKey, ...common }) as unknown as ImageProvider).image(
        model,
      );
    }
    default:
      throw new Error(`Unknown image provider "${String(settings.provider)}".`);
  }
}

type Size = `${number}x${number}`;
type Ratio = `${number}:${number}`;

/** Generate the images of one request, as bytes with their media type. */
export async function generateImages(
  settings: ImageSettings,
  request: ImageRequest,
  options: MediaOptions = {},
): Promise<ImageResult> {
  const [{ generateImage }, model] = await Promise.all([
    import("ai").catch(missingPackage("Generating images", settings.provider, "ai")),
    loadImageModel(settings, options),
  ]);
  let result: Awaited<ReturnType<typeof generateImage>>;
  try {
    result = await generateImage({
      model,
      prompt: request.prompt,
      n: request.n ?? 1,
      ...(request.size ? { size: request.size as Size } : {}),
      ...(request.aspectRatio ? { aspectRatio: request.aspectRatio as Ratio } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
      ...(request.providerOptions ? { providerOptions: request.providerOptions } : {}),
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    });
  } catch (error) {
    throw mediaFailure(error, settings.apiKey);
  }
  let cost: number | undefined;
  for (const call of result.calls) {
    const c = (call.providerMetadata?.[settings.provider] as { cost?: unknown } | undefined)?.cost;
    if (typeof c === "number") cost = (cost ?? 0) + c;
  }
  return {
    images: result.images.map((image) => ({ data: image.uint8Array, mediaType: image.mediaType })),
    warnings: result.warnings.map(warningText),
    ...(cost !== undefined ? { costUsd: cost } : {}),
  };
}

/** Whether the provider takes the key, without generating anything (and so without cost). */
export function testImageKey(
  settings: Pick<ImageSettings, "provider" | "apiKey">,
  options: MediaOptions = {},
): Promise<MediaKeyReport> {
  return testMediaKey(settings, options);
}
