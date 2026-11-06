// Text to speech with any provider's speech model, through the AI SDK's
// `generateSpeech`: the Vercel AI Gateway, fal.ai, OpenAI, Google (Gemini TTS)
// or ElevenLabs. Each SDK is imported on first use. `listVoices` says which
// voices a model speaks with. Entry `llm-connect/speech`.

import type { JSONObject, JSONValue, SpeechModelV4 } from "@ai-sdk/provider";
import {
  fetchOf,
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

export const SPEECH_PROVIDERS = ["gateway", "fal", "openai", "google", "elevenlabs"] as const;

export type SpeechProviderId = (typeof SPEECH_PROVIDERS)[number];

/** Each provider's name, key page, environment variable and package. */
export const SPEECH_PROVIDER_INFO: Readonly<Record<SpeechProviderId, MediaProviderInfo>> =
  providerInfoOf(SPEECH_PROVIDERS);

/** Which provider, which key, which model. */
export interface SpeechSettings {
  provider: SpeechProviderId;
  apiKey: string;
  model: string;
  /** Another base URL for the provider's API (a proxy). */
  baseUrl?: string;
}

export interface SpeechRequest {
  text: string;
  /** A voice id of `listVoices`; the model's own default without one. */
  voice?: string;
  /** ISO 639-1 ("en", "fr"), for a model that takes it. */
  language?: string;
  /** How to speak ("Calm, slow"), for a model that takes it (OpenAI gpt-4o-mini-tts, Gemini). */
  instructions?: string;
  speed?: number;
  /** "mp3", "wav"…, as the provider names it. */
  format?: string;
  /** Body fields for one provider, by provider id: `{ elevenlabs: { voiceSettings: {…} } }`. */
  providerOptions?: Record<string, Record<string, JSONValue>>;
}

export interface SpeechResult {
  audio: { data: Uint8Array; mediaType: string };
  /** What the provider would not do as asked (a setting it ignored). */
  warnings: string[];
}

type SpeechProvider = { speech(modelId: string): SpeechModelV4 };

const ELEVENLABS_API = "https://api.elevenlabs.io";

/** `fetch` with ElevenLabs' own origin swapped for `baseUrl` (its SDK takes no base URL). */
function rebased(fetch: MediaOptions["fetch"], baseUrl: string): typeof globalThis.fetch {
  const base = baseUrl.replace(/\/+$/, "");
  const doFetch = fetchOf({ fetch });
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    return doFetch(
      url.startsWith(ELEVENLABS_API) ? base + url.slice(ELEVENLABS_API.length) : url,
      init,
    );
  }) as typeof globalThis.fetch;
}

/** The provider's AI SDK speech model, its package imported on demand. */
export async function loadSpeechModel(
  settings: SpeechSettings,
  options: MediaOptions = {},
): Promise<SpeechModelV4> {
  const { apiKey, model, baseUrl } = settings;
  const common = {
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    ...(options.fetch ? { fetch: options.fetch as typeof fetch } : {}),
  };
  const missing = (pkg: string) => missingPackage("Speaking", settings.provider, pkg);
  switch (settings.provider) {
    case "gateway": {
      const { createGateway } = await import("@ai-sdk/gateway").catch(missing("@ai-sdk/gateway"));
      return (createGateway({ apiKey, ...common }) as unknown as SpeechProvider).speech(model);
    }
    case "fal": {
      const { createFal } = await import("@ai-sdk/fal").catch(missing("@ai-sdk/fal"));
      return (createFal({ apiKey, ...common }) as unknown as SpeechProvider).speech(model);
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai").catch(missing("@ai-sdk/openai"));
      return (createOpenAI({ apiKey, ...common }) as unknown as SpeechProvider).speech(model);
    }
    case "google": {
      const { createGoogle } = await import("@ai-sdk/google").catch(missing("@ai-sdk/google"));
      return (createGoogle({ apiKey, ...common }) as unknown as SpeechProvider).speech(model);
    }
    case "elevenlabs": {
      const { createElevenLabs } = await import("@ai-sdk/elevenlabs").catch(
        missing("@ai-sdk/elevenlabs"),
      );
      const fetch = baseUrl
        ? rebased(options.fetch, baseUrl)
        : (options.fetch as typeof globalThis.fetch | undefined);
      return (
        createElevenLabs({ apiKey, ...(fetch ? { fetch } : {}) }) as unknown as SpeechProvider
      ).speech(model);
    }
    default:
      throw new Error(`Unknown speech provider "${String(settings.provider)}".`);
  }
}

/** Speak one text, as audio bytes with their media type. */
export async function generateSpeechAudio(
  settings: SpeechSettings,
  request: SpeechRequest,
  options: MediaOptions = {},
): Promise<SpeechResult> {
  const [{ generateSpeech }, model] = await Promise.all([
    import("ai").catch(missingPackage("Speaking", settings.provider, "ai")),
    loadSpeechModel(settings, options),
  ]);
  let result: Awaited<ReturnType<typeof generateSpeech>>;
  try {
    result = await generateSpeech({
      model,
      text: request.text,
      ...(request.voice ? { voice: request.voice } : {}),
      ...(request.language ? { language: request.language } : {}),
      ...(request.instructions ? { instructions: request.instructions } : {}),
      ...(request.speed !== undefined ? { speed: request.speed } : {}),
      ...(request.format ? { outputFormat: request.format } : {}),
      ...(request.providerOptions
        ? { providerOptions: request.providerOptions as Record<string, JSONObject> }
        : {}),
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    });
  } catch (error) {
    throw mediaFailure(error, settings.apiKey);
  }
  return {
    audio: { data: result.audio.uint8Array, mediaType: result.audio.mediaType },
    warnings: result.warnings.map(warningText),
  };
}

/** Whether the provider takes the key, without speaking (and so without cost). */
export function testSpeechKey(
  settings: Pick<SpeechSettings, "provider" | "apiKey">,
  options: MediaOptions = {},
): Promise<MediaKeyReport> {
  return testMediaKey(settings, options);
}

export interface Voice {
  /** What `SpeechRequest.voice` takes. */
  id: string;
  name: string;
  language?: string;
  gender?: string;
  description?: string;
}

/**
 * OpenAI's built-in voices; tts-1 and tts-1-hd speak the first nine only.
 * https://platform.openai.com/docs/guides/text-to-speech#voice-options
 */
const OPENAI_VOICES = [
  "alloy",
  "ash",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "ballad",
  "verse",
  "marin",
  "cedar",
] as const;

/**
 * Gemini TTS's 30 prebuilt voices, with the character Google gives each.
 * https://ai.google.dev/gemini-api/docs/speech-generation#voices
 */
const GEMINI_VOICES: readonly (readonly [string, string])[] = [
  ["Zephyr", "Bright"],
  ["Puck", "Upbeat"],
  ["Charon", "Informative"],
  ["Kore", "Firm"],
  ["Fenrir", "Excitable"],
  ["Leda", "Youthful"],
  ["Orus", "Firm"],
  ["Aoede", "Breezy"],
  ["Callirrhoe", "Easy-going"],
  ["Autonoe", "Bright"],
  ["Enceladus", "Breathy"],
  ["Iapetus", "Clear"],
  ["Umbriel", "Easy-going"],
  ["Algieba", "Smooth"],
  ["Despina", "Smooth"],
  ["Erinome", "Clear"],
  ["Algenib", "Gravelly"],
  ["Rasalgethi", "Informative"],
  ["Laomedeia", "Upbeat"],
  ["Achernar", "Soft"],
  ["Alnilam", "Firm"],
  ["Schedar", "Even"],
  ["Gacrux", "Mature"],
  ["Pulcherrima", "Forward"],
  ["Achird", "Friendly"],
  ["Zubenelgenubi", "Casual"],
  ["Vindemiatrix", "Gentle"],
  ["Sadachbia", "Lively"],
  ["Sadaltager", "Knowledgeable"],
  ["Sulafat", "Warm"],
];

function openaiVoices(model: string): Voice[] {
  const legacy = /^tts-1(-hd)?(-\d+)?$/.test(model);
  return OPENAI_VOICES.slice(0, legacy ? 9 : undefined).map((id) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
  }));
}

function geminiVoices(): Voice[] {
  return GEMINI_VOICES.map(([id, description]) => ({ id, name: id, description }));
}

interface ElevenLabsVoice {
  voice_id?: string;
  name?: string;
  description?: string | null;
  labels?: Record<string, string> | null;
  verified_languages?: { language?: string }[] | null;
}

/** The voices of an ElevenLabs account (its own and the ones it added), 100 a page. */
async function elevenLabsVoices(apiKey: string, options: MediaOptions): Promise<Voice[]> {
  const voices: Voice[] = [];
  let token: string | null = null;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${ELEVENLABS_API}/v2/voices`);
    url.searchParams.set("page_size", "100");
    if (token) url.searchParams.set("next_page_token", token);
    let res: Response;
    try {
      res = await fetchOf(options)(url.toString(), {
        headers: { "xi-api-key": apiKey },
        signal: options.abortSignal ?? AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw mediaFailure(error, apiKey);
    }
    if (!res.ok)
      throw Object.assign(
        new Error(
          res.status === 401 || res.status === 403
            ? "ElevenLabs refused the key."
            : `ElevenLabs answered HTTP ${res.status} to the voice list.`,
        ),
        { status: res.status },
      );
    const body = (await res.json()) as {
      voices?: ElevenLabsVoice[];
      has_more?: boolean;
      next_page_token?: string | null;
    };
    for (const v of body.voices ?? []) {
      if (!v.voice_id) continue;
      const language = v.labels?.language ?? v.verified_languages?.[0]?.language;
      voices.push({
        id: v.voice_id,
        name: v.name ?? v.voice_id,
        ...(language ? { language } : {}),
        ...(v.labels?.gender ? { gender: v.labels.gender } : {}),
        ...(v.description ? { description: v.description } : {}),
      });
    }
    token = body.has_more ? (body.next_page_token ?? null) : null;
    if (!token) break;
  }
  return voices;
}

/**
 * The voices a model speaks with: OpenAI's and Gemini's documented ones (also through the
 * Gateway), the account's voices at ElevenLabs. `null`: no list to give, the model speaks
 * with its own default voice unless `SpeechRequest.voice` names one.
 */
export async function listVoices(
  settings: Pick<SpeechSettings, "provider" | "apiKey" | "model">,
  options: MediaOptions = {},
): Promise<Voice[] | null> {
  const { provider, model } = settings;
  switch (provider) {
    case "openai":
      return openaiVoices(model);
    case "google":
      return geminiVoices();
    case "elevenlabs":
      return elevenLabsVoices(settings.apiKey, options);
    case "gateway": {
      const [maker, id = ""] = model.split("/", 2) as [string, string?];
      if (maker === "openai") return openaiVoices(id);
      if (maker === "google") return geminiVoices();
      return null;
    }
    default:
      return null;
  }
}
