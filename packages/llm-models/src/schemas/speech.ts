import { z } from "zod";

// The speech model lists llm-models reads. Each entry is validated on its own
// (clients/speech.ts): one odd model must not take a whole list down. fal.ai
// shares the video schemas (schemas/video.ts).

/** A speech entry of the AI Gateway's `GET /v1/models` (`type: "speech"`). */
export const GatewaySpeechModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal("speech"),
  owned_by: z.string().nullish(),
  description: z.string().nullish(),
  released: z.number().nullish(),
  tags: z.array(z.string()).nullish(),
  pricing: z
    .object({
      /** Dollars per character read. */
      speech_input_character_cost: z.union([z.string(), z.number()]).nullish(),
      /** Dollars per second of audio (music and sound effects). */
      speech_output_cost_per_second: z.union([z.string(), z.number()]).nullish(),
    })
    .partial()
    .nullish(),
});

/** An entry of ElevenLabs' `GET /v1/models` (a bare array). */
export const ElevenLabsModelSchema = z.object({
  model_id: z.string(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  can_do_text_to_speech: z.boolean().nullish(),
  maximum_text_length_per_request: z.number().nullish(),
  languages: z.array(z.object({ language_id: z.string(), name: z.string().nullish() })).nullish(),
});

/** A voice of ElevenLabs' `GET /v2/voices`. */
export const ElevenLabsVoiceSchema = z.object({
  voice_id: z.string(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  labels: z.record(z.string(), z.string().nullish()).nullish(),
  verified_languages: z
    .array(z.object({ language: z.string().nullish(), model_id: z.string().nullish() }))
    .nullish(),
});

export const ElevenLabsVoicesPageSchema = z.object({
  voices: z.array(z.unknown()),
  has_more: z.boolean().nullish(),
  next_page_token: z.string().nullish(),
});
