import type { z } from "zod";
import { readCache, writeCache } from "../cache-core";
import {
  ElevenLabsModelSchema,
  ElevenLabsVoiceSchema,
  ElevenLabsVoicesPageSchema,
  GatewaySpeechModelSchema,
} from "../schemas/speech";
import { type FetchOptions, fetchJson } from "./http";
import { each, type FalModel, fetchFalCategoryModels, GATEWAY_MODELS_URL, listOf } from "./video";

export type GatewaySpeechModel = z.infer<typeof GatewaySpeechModelSchema>;
export type ElevenLabsModel = z.infer<typeof ElevenLabsModelSchema>;
export type ElevenLabsVoice = z.infer<typeof ElevenLabsVoiceSchema>;

export const ELEVENLABS_MODELS_URL = "https://api.elevenlabs.io/v1/models";
export const ELEVENLABS_VOICES_URL = "https://api.elevenlabs.io/v2/voices";

/** The fal.ai categories llm-models lists speech models from. */
export const FAL_SPEECH_CATEGORIES = ["text-to-speech"] as const;

// 100 voices a page; the account's own voices and the premade ones fit in a few.
const ELEVENLABS_MAX_PAGES = 5;

/** Music and sound effects share the Gateway's `speech` type; they read no text aloud. */
const NOT_SPEECH = /music|sound-effects/i;

/** The AI Gateway's speech models (no music or sound effects), with their prices. No key needed. */
export async function fetchGatewaySpeechModels(
  options: FetchOptions = {},
): Promise<GatewaySpeechModel[]> {
  const cached = readCache<GatewaySpeechModel[]>("gateway-speech");
  if (cached) return cached;
  const json = await fetchJson(GATEWAY_MODELS_URL, "AI Gateway", options);
  const speech = listOf(json, "data", "AI Gateway").filter(
    (m) => (m as { type?: unknown } | null)?.type === "speech",
  );
  const models = each(speech, GatewaySpeechModelSchema, "AI Gateway").filter(
    (m) => !NOT_SPEECH.test(m.id) && !(m.tags ?? []).some((t) => NOT_SPEECH.test(t)),
  );
  writeCache("gateway-speech", models);
  return models;
}

/** fal.ai's active text-to-speech models. No key needed. */
export async function fetchFalSpeechModels(options: FetchOptions = {}): Promise<FalModel[]> {
  return fetchFalCategoryModels(FAL_SPEECH_CATEGORIES, options);
}

/** ElevenLabs' models that read text aloud. Needs a key. */
export async function fetchElevenLabsModels(
  apiKey: string,
  options: FetchOptions = {},
): Promise<ElevenLabsModel[]> {
  const json = await fetchJson(ELEVENLABS_MODELS_URL, "ElevenLabs", options, {
    "xi-api-key": apiKey,
  });
  if (!Array.isArray(json)) throw new Error("ElevenLabs API returned no model list");
  return each(json, ElevenLabsModelSchema, "ElevenLabs").filter(
    (m) => m.can_do_text_to_speech !== false,
  );
}

/** The voices an ElevenLabs key can speak with (its own and the premade ones). Needs a key. */
export async function fetchElevenLabsVoices(
  apiKey: string,
  options: FetchOptions = {},
): Promise<ElevenLabsVoice[]> {
  const voices: ElevenLabsVoice[] = [];
  let token: string | null | undefined;
  for (let page = 0; page < ELEVENLABS_MAX_PAGES; page++) {
    const url = `${ELEVENLABS_VOICES_URL}?page_size=100${
      token ? `&next_page_token=${encodeURIComponent(token)}` : ""
    }`;
    const json = await fetchJson(url, "ElevenLabs", options, { "xi-api-key": apiKey });
    const listing = ElevenLabsVoicesPageSchema.parse(json);
    voices.push(...each(listing.voices, ElevenLabsVoiceSchema, "ElevenLabs voices"));
    token = listing.next_page_token;
    if (!listing.has_more || !token) break;
  }
  return voices;
}
