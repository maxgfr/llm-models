import { z } from "zod";

// The video model lists llm-models reads. Each entry is validated on its own
// (clients/video.ts): one odd model must not take a whole list down.

/** An entry of OpenRouter's `GET /api/v1/videos/models`. */
export const OpenRouterVideoModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  created: z.number().nullish(),
  supported_resolutions: z.array(z.string()).nullish(),
  supported_aspect_ratios: z.array(z.string()).nullish(),
  supported_sizes: z.array(z.string()).nullish(),
  supported_durations: z.array(z.number()).nullish(),
  supported_frame_images: z.array(z.string()).nullish(),
  generate_audio: z.boolean().nullish(),
  seed: z.boolean().nullish(),
  pricing_skus: z.record(z.string(), z.union([z.string(), z.number()])).nullish(),
  allowed_passthrough_parameters: z.array(z.string()).nullish(),
});

/** A video entry of the AI Gateway's `GET /v1/models` (`type: "video"`). */
export const GatewayVideoModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal("video"),
  owned_by: z.string().nullish(),
  description: z.string().nullish(),
  released: z.number().nullish(),
  modalities: z
    .object({ input: z.array(z.string()) })
    .partial()
    .nullish(),
  video_capabilities: z
    .object({
      supported_operations: z.array(z.string()).nullish(),
      supported_resolutions: z.array(z.string()).nullish(),
      supported_aspect_ratios: z.array(z.string()).nullish(),
      supported_durations_seconds: z.array(z.number()).nullish(),
      generate_audio: z.boolean().nullish(),
      input_limits: z
        .object({ text: z.object({ max_chars: z.number().nullish() }).partial().nullish() })
        .partial()
        .nullish(),
    })
    .partial()
    .nullish(),
  pricing: z
    .object({
      video_duration_pricing: z
        .array(
          z.object({
            cost_per_second: z.union([z.string(), z.number()]),
            resolution: z.string().nullish(),
            audio: z.boolean().nullish(),
            mode: z.string().nullish(),
          }),
        )
        .nullish(),
    })
    .partial()
    .nullish(),
});

/** An entry of fal.ai's `GET /v1/models?category=…`. */
export const FalModelSchema = z.object({
  endpoint_id: z.string(),
  metadata: z
    .object({
      display_name: z.string().nullish(),
      description: z.string().nullish(),
      category: z.string().nullish(),
      status: z.string().nullish(),
      date: z.string().nullish(),
    })
    .partial()
    .nullish(),
  openapi: z.unknown().optional(),
});

export const FalListingSchema = z.object({
  models: z.array(z.unknown()),
  next_cursor: z.string().nullish(),
  has_more: z.boolean().nullish(),
});

/** An entry of the Gemini API's `GET /v1beta/models`. */
export const GoogleModelSchema = z.object({
  name: z.string(),
  displayName: z.string().nullish(),
  description: z.string().nullish(),
  supportedGenerationMethods: z.array(z.string()).nullish(),
});

/** A model of a Replicate collection (`GET /v1/collections/{slug}`). */
export const ReplicateModelSchema = z.object({
  owner: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  latest_version: z
    .object({
      id: z.string().nullish(),
      created_at: z.string().nullish(),
      openapi_schema: z.unknown(),
    })
    .partial()
    .nullish(),
});
