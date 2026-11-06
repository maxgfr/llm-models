import { z } from "zod";

// The image model lists llm-models reads. Each entry is validated on its own
// (clients/image.ts): one odd model must not take a whole list down. fal.ai,
// Replicate and the Gemini API share the video schemas (schemas/video.ts).

/** A typed parameter of OpenRouter's image models: an enum, a range or a flag. */
const OpenRouterParameterSchema = z
  .object({
    type: z.string().nullish(),
    values: z.array(z.union([z.string(), z.number()])).nullish(),
    min: z.number().nullish(),
    max: z.number().nullish(),
  })
  .partial();

/** An entry of OpenRouter's `GET /api/v1/images/models`. */
export const OpenRouterImageModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  created: z.number().nullish(),
  architecture: z
    .object({
      input_modalities: z.array(z.string()).nullish(),
      output_modalities: z.array(z.string()).nullish(),
    })
    .partial()
    .nullish(),
  supported_parameters: z.record(z.string(), OpenRouterParameterSchema).nullish(),
});

/** An image entry of the AI Gateway's `GET /v1/models` (`type: "image"`). */
export const GatewayImageModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal("image"),
  owned_by: z.string().nullish(),
  description: z.string().nullish(),
  released: z.number().nullish(),
  modalities: z
    .object({ input: z.array(z.string()) })
    .partial()
    .nullish(),
  pricing: z
    .object({
      /** Dollars per image. */
      image: z.union([z.string(), z.number()]).nullish(),
      /** Per-image prices by size, quality, style or operation. */
      image_dimension_quality_pricing: z
        .array(
          z.object({
            cost: z.union([z.string(), z.number()]),
            size: z.string().nullish(),
            quality: z.string().nullish(),
            style: z.string().nullish(),
            operation: z.string().nullish(),
          }),
        )
        .nullish(),
    })
    .partial()
    .nullish(),
});

/** An entry of OpenAI's `GET /v1/models`. */
export const OpenAIModelSchema = z.object({
  id: z.string(),
  created: z.number().nullish(),
  owned_by: z.string().nullish(),
});
