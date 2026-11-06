import type { FetchOptions } from "../clients/http";
import { fetchModelsDevModels } from "../clients/models-dev";
import {
  type ElevenLabsModel,
  type ElevenLabsVoice,
  fetchElevenLabsModels,
  fetchElevenLabsVoices,
  fetchFalSpeechModels,
  fetchGatewaySpeechModels,
  type GatewaySpeechModel,
} from "../clients/speech";
import { type FalModel, fetchFalModelSchema } from "../clients/video";
import {
  GEMINI_VOICES,
  OPENAI_VOICES,
  SPEECH_PROVIDERS,
  type SpeechModel,
  type SpeechPrice,
  type SpeechProviderId,
  type SpeechVoice,
} from "../speech";
import type { ModelsDevResponse } from "../types";
import { inputProperties, isObject, type Json, settle } from "./video";

const DAY = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);
/** Rounded so a per-character price read as a float comes back as written (0.00002 → 20). */
const perMillion = (perUnit: number) => Number((perUnit * 1e6).toPrecision(12));

/** The voices `tts-1` and `tts-1-hd` take (the newer ones are `gpt-4o-mini-tts`'s only). */
const TTS1_VOICES = new Set([
  "alloy",
  "ash",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
]);
/** The formats OpenAI's speech API returns (`response_format`). */
const OPENAI_FORMATS = ["mp3", "opus", "aac", "flac", "wav", "pcm"];

/**
 * OpenAI's speech models, as its docs list them; models.dev lists none under
 * OpenAI. `instructions` is `gpt-4o-mini-tts`'s only; 4096 characters a call.
 * https://platform.openai.com/docs/guides/text-to-speech
 * https://platform.openai.com/docs/api-reference/audio/createSpeech
 */
const OPENAI_SPEECH_MODELS: readonly [id: string, name: string][] = [
  ["gpt-4o-mini-tts", "GPT-4o mini TTS"],
  ["tts-1", "TTS-1"],
  ["tts-1-hd", "TTS-1 HD"],
];

/** The voices a model of `owner` speaks with, when its maker documents a fixed set. */
function knownVoices(owner: string, id: string): SpeechVoice[] | null {
  const name = id.split("/").pop() ?? id;
  if (owner === "openai")
    return /^tts-1/.test(name)
      ? OPENAI_VOICES.filter((v) => TTS1_VOICES.has(v.id))
      : [...OPENAI_VOICES];
  if (owner === "google" && /gemini.*tts/i.test(name)) return [...GEMINI_VOICES];
  return null;
}

/** Whether a model of `owner` takes free-text style instructions, when its maker says. */
function knownInstructions(owner: string, id: string): boolean | null {
  const name = id.split("/").pop() ?? id;
  if (owner === "openai") return !/^tts-1/.test(name);
  if (owner === "google" && /gemini.*tts/i.test(name)) return true;
  return null;
}

/** An ElevenLabs voice in the shared shape. */
export function fromElevenLabsVoice(v: ElevenLabsVoice): SpeechVoice {
  const labels = v.labels ?? {};
  const language = labels.language ?? v.verified_languages?.[0]?.language ?? undefined;
  const description = labels.description ?? v.description ?? undefined;
  return {
    id: v.voice_id,
    name: v.name?.trim() || v.voice_id,
    ...(language ? { language } : {}),
    ...(labels.gender ? { gender: labels.gender } : {}),
    ...(description ? { description } : {}),
  };
}

export function fromGatewaySpeech(
  m: GatewaySpeechModel,
  elevenLabsVoices: readonly SpeechVoice[] | null = null,
): SpeechModel {
  const owner = m.owned_by ?? m.id.split("/")[0] ?? "";
  const prices: SpeechPrice[] = [];
  const perChar = Number(m.pricing?.speech_input_character_cost);
  if (m.pricing?.speech_input_character_cost != null && Number.isFinite(perChar))
    prices.push({ usd: perMillion(perChar), per: "million-characters" });
  const voices =
    owner === "elevenlabs" && elevenLabsVoices ? [...elevenLabsVoices] : knownVoices(owner, m.id);
  return {
    provider: "gateway",
    id: m.id,
    name: m.name,
    owner,
    ...(m.description ? { description: m.description } : {}),
    voices,
    languages: null,
    formats: null,
    instructions: knownInstructions(owner, m.id),
    prices,
    ...(m.released ? { released: DAY(m.released) } : {}),
  };
}

const DOCUMENTED_VOICES = new Map(
  [...GEMINI_VOICES, ...OPENAI_VOICES].map((v): [string, SpeechVoice] => [v.id, v]),
);

/** Audio formats a speech endpoint may name (`url`, `hex` and the like are not). */
const AUDIO_FORMAT =
  /^(mp3|wav|pcm|opus|ogg|ogg_opus|flac|aac|m4a|webm|mulaw|ulaw|alaw|mp3_[\w]+|pcm_\d+|wav_\d+|opus_[\w]+)$/i;

/**
 * The settings an endpoint's OpenAPI input schema offers (fal.ai publishes
 * one): voices, languages, audio formats, style instructions, text limit.
 * `null` when the schema has no input properties.
 */
export function describeOpenApiSpeechInput(openapi: unknown):
  | (Pick<SpeechModel, "voices" | "languages" | "formats" | "instructions"> & {
      maxChars?: number;
    })
  | null {
  const input = inputProperties(openapi);
  if (!input) return null;
  const { props } = input;
  const pick = (...names: string[]) => names.map((n) => props[n]).find(Boolean);
  const enumOf = (p: unknown): unknown[] | null =>
    isObject(p) && Array.isArray(p.enum) ? (p.enum as unknown[]) : null;
  /** A flat enum, or the enum of one of its fields (`voice_setting.voice_id`, `output_format.codec`). */
  const enumIn = (p: Json | undefined, ...fields: string[]) => {
    const own = enumOf(p);
    if (own) return own;
    const nested = p && isObject(p.properties) ? (p.properties as Json) : {};
    for (const f of fields) {
      const found = enumOf(nested[f]);
      if (found) return found;
    }
    return null;
  };

  const voiceList = enumIn(pick("voice", "voice_id", "voice_setting"), "voice_id", "voice");
  const languageList = enumIn(pick("language", "language_code", "language_boost"));
  const formatList = enumIn(
    pick("output_format", "response_format", "audio_format", "format"),
    "codec",
    "format",
  );
  const text = pick("text", "prompt", "input");
  const strings = (list: unknown[] | null) =>
    list ? [...new Set(list.map(String).filter((s) => s && s !== "auto"))] : [];
  // A maker's voice keeps the style its maker documents (fal serves Gemini's under their own names).
  const voices = strings(voiceList).map((id) => DOCUMENTED_VOICES.get(id) ?? { id, name: id });
  const languages = strings(languageList);
  const formats = strings(formatList).filter((f) => AUDIO_FORMAT.test(f));
  return {
    voices: voices.length ? voices : null,
    languages: languages.length ? languages : null,
    formats: formats.length ? formats : null,
    instructions: pick("style_instructions", "instructions", "style_prompt") ? true : null,
    ...(text && typeof text.maxLength === "number" ? { maxChars: text.maxLength } : {}),
  };
}

export function fromFalSpeech(m: FalModel): SpeechModel {
  const described = m.openapi ? describeOpenApiSpeechInput(m.openapi) : null;
  return {
    provider: "fal",
    id: m.endpoint_id,
    name: m.metadata?.display_name?.trim() || m.endpoint_id,
    owner: m.endpoint_id.split("/")[0] ?? "",
    ...(m.metadata?.description ? { description: m.metadata.description } : {}),
    voices: described?.voices ?? null,
    languages: described?.languages ?? null,
    formats: described?.formats ?? null,
    instructions: described?.instructions ?? null,
    prices: [],
    ...(described?.maxChars ? { maxChars: described.maxChars } : {}),
    ...(m.metadata?.date ? { released: m.metadata.date.slice(0, 10) } : {}),
  };
}

export function fromElevenLabs(
  m: ElevenLabsModel,
  voices: readonly SpeechVoice[] | null = null,
): SpeechModel {
  const languages = (m.languages ?? []).map((l) => l.language_id);
  return {
    provider: "elevenlabs",
    id: m.model_id,
    name: m.name?.trim() || m.model_id,
    owner: "elevenlabs",
    ...(m.description ? { description: m.description } : {}),
    voices: voices ? [...voices] : null,
    languages: languages.length ? languages : null,
    formats: null,
    instructions: null,
    prices: [],
    ...(m.maximum_text_length_per_request ? { maxChars: m.maximum_text_length_per_request } : {}),
  };
}

/** The direct speech providers models.dev lists, by its provider id. */
const MODELS_DEV_DIRECT: Partial<Record<string, SpeechProviderId>> = {
  openai: "openai",
  google: "google",
};
/** A model that reads text aloud, not a realtime or live chat model that also speaks. */
const SPEECH_NAME = /tts|speech/i;
const NOT_SPEECH_NAME = /realtime|live|transcri/i;

function openAISpeech(id: string, name: string, released?: string): SpeechModel {
  return {
    provider: "openai",
    id,
    name,
    owner: "openai",
    voices: knownVoices("openai", id),
    languages: null,
    formats: [...OPENAI_FORMATS],
    instructions: knownInstructions("openai", id),
    prices: [],
    maxChars: 4096,
    ...(released ? { released } : {}),
  };
}

export function fromModelsDevSpeech(data: ModelsDevResponse): SpeechModel[] {
  const models: SpeechModel[] = [];
  for (const [providerId, provider] of Object.entries(data)) {
    const target = MODELS_DEV_DIRECT[providerId];
    if (!target) continue;
    for (const m of Object.values(provider.models)) {
      if (!m.modalities.output.includes("audio")) continue;
      const label = `${m.id} ${m.name}`;
      if (!SPEECH_NAME.test(label) || NOT_SPEECH_NAME.test(label)) continue;
      if (m.status === "deprecated") continue;
      if (target === "openai") {
        models.push(openAISpeech(m.id, m.name, m.release_date));
        continue;
      }
      models.push({
        provider: target,
        id: m.id,
        name: m.name,
        owner: providerId,
        voices: knownVoices(providerId, m.id),
        languages: null,
        // Gemini TTS returns raw 16-bit PCM at 24 kHz.
        formats: providerId === "google" ? ["pcm"] : null,
        instructions: knownInstructions(providerId, m.id),
        prices: [],
        released: m.release_date,
      });
    }
  }
  return models;
}

export interface ListSpeechModelsOptions extends FetchOptions {
  /** The services to list (default: every one that needs no key, plus those given a key). */
  providers?: readonly SpeechProviderId[];
  /** An ElevenLabs key, to list its models and the voices the account can use. */
  elevenLabsApiKey?: string;
}

/**
 * Every speech (text-to-speech) model llm-models can find, in one shape: the
 * AI Gateway's (with their per-character prices), fal.ai's catalog, OpenAI's
 * and Google's (models.dev, plus OpenAI's documented ones) with their makers'
 * voices, and ElevenLabs' models and voices when given a key. A source that
 * fails is skipped (with `--verbose`, logged): the others still answer.
 */
export async function listSpeechModels(
  options: ListSpeechModelsOptions = {},
): Promise<SpeechModel[]> {
  const key = options.elevenLabsApiKey;
  const wanted = new Set<SpeechProviderId>(
    options.providers ?? SPEECH_PROVIDERS.filter((p) => p !== "elevenlabs" || key),
  );
  const fetchOptions: FetchOptions = options.fetch ? { fetch: options.fetch } : {};
  const needsVoices = Boolean(key) && (wanted.has("elevenlabs") || wanted.has("gateway"));
  const [gateway, fal, modelsDev, elevenModels, elevenVoices] = await Promise.all([
    wanted.has("gateway") ? settle("AI Gateway", () => fetchGatewaySpeechModels(fetchOptions)) : [],
    wanted.has("fal") ? settle("fal.ai", () => fetchFalSpeechModels(fetchOptions)) : [],
    wanted.has("openai") || wanted.has("google")
      ? settle("models.dev", async () =>
          fromModelsDevSpeech(await fetchModelsDevModels(fetchOptions)),
        )
      : [],
    wanted.has("elevenlabs") && key
      ? settle("ElevenLabs", () => fetchElevenLabsModels(key, fetchOptions))
      : [],
    needsVoices
      ? settle("ElevenLabs voices", () => fetchElevenLabsVoices(key as string, fetchOptions))
      : [],
  ]);
  const voices = elevenVoices.length ? elevenVoices.map(fromElevenLabsVoice) : null;
  // One entry per provider and id: models.dev's wins over OpenAI's documented list.
  const seen = new Map<string, SpeechModel>();
  if (wanted.has("openai"))
    for (const [id, name] of OPENAI_SPEECH_MODELS) seen.set(`openai:${id}`, openAISpeech(id, name));
  for (const m of modelsDev) seen.set(`${m.provider}:${m.id}`, m);
  const all = [
    ...gateway.map((m) => fromGatewaySpeech(m, voices)),
    ...fal.map(fromFalSpeech),
    ...seen.values(),
    ...elevenModels.map((m) => fromElevenLabs(m, voices)),
  ];
  return all.filter((m) => wanted.has(m.provider));
}

/** One fal.ai endpoint with the voices and settings its schema offers (`listSpeechModels` lists fal without them). */
export async function describeFalSpeechModel(
  endpoint: string,
  options: FetchOptions = {},
): Promise<SpeechModel | null> {
  const found = await fetchFalModelSchema(endpoint, options);
  return found ? fromFalSpeech(found) : null;
}
