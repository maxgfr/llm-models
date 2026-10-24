// Speech to text with the provider the settings already point to: its
// transcription model (not the chat model), the same key and the same guarded
// fetch. OpenAI, Gemini and Mistral have one; so do Groq and the local
// OpenAI-compatible servers that implement /audio/transcriptions. Anthropic has
// none. The answer always comes back as a `Transcript` (see transcript.ts).
// Whisper running in the page is in `llm-connect/whisper`.

import type { JSONValue, TranscriptionModel } from "ai";
import { type FetchLike, type GuardedFetchOptions, guardedFetch } from "./fetch.js";
import { baseUrlOf, type ProviderKind, providerKindOf } from "./provider-kind.js";
import type { LlmSettings } from "./settings.js";
import { type Transcript, type TranscriptPiece, toTranscript } from "./transcript.js";

/** The AI SDK a transcription model is created with. */
export type TranscriptionSdk = "openai" | "google" | "mistral";

/** Where the settings transcribe: the SDK, the model and, off the SDK's default, the base URL. */
export interface TranscriptionTarget {
  sdk: TranscriptionSdk;
  model: string;
  baseURL?: string;
}

/** Transcription model of each provider that has one, chosen for word timings. */
export const DEFAULT_TRANSCRIPTION_MODELS: Readonly<Record<TranscriptionSdk, string>> = {
  openai: "whisper-1",
  google: "gemini-3.5-transcribe",
  mistral: "voxtral-mini-latest",
};

/** OpenAI-compatible hosts with a known transcription model. */
const COMPATIBLE_HOSTS: Readonly<Record<string, string>> = {
  "api.groq.com": "whisper-large-v3-turbo",
};

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export type TranscriptionProblemCode = "no-key" | "unsupported" | "no-model";

export interface TranscriptionProblem {
  code: TranscriptionProblemCode;
  message: string;
}

type Resolved = { target: TranscriptionTarget } | { problem: TranscriptionProblem };

function resolve(settings: LlmSettings, model?: string): Resolved {
  const kind = providerKindOf(settings) as ProviderKind | string;
  const base = baseUrlOf(settings);
  if (!settings.customEndpoint && !settings.apiKey?.trim())
    return { problem: { code: "no-key", message: "Add an API key to transcribe audio." } };
  switch (kind) {
    case "openai":
    case "google":
    case "mistral":
      return {
        target: {
          sdk: kind,
          model: model || DEFAULT_TRANSCRIPTION_MODELS[kind],
          ...(settings.providerApi ? { baseURL: base } : {}),
        },
      };
    case "openai-compatible": {
      const known = COMPATIBLE_HOSTS[hostOf(base)];
      if (!model && !known)
        return {
          problem: {
            code: "no-model",
            message: settings.customEndpoint
              ? "Name the transcription model this server serves (for example a Whisper model)."
              : "This provider has no known transcription model. Name one, or use OpenAI, Gemini, Mistral or Groq.",
          },
        };
      return { target: { sdk: "openai", model: model || (known as string), baseURL: base } };
    }
    default:
      return {
        problem: {
          code: "unsupported",
          message:
            kind === "anthropic"
              ? "Anthropic has no speech-to-text model. Use OpenAI, Gemini, Mistral or Groq, or Whisper on this device."
              : "This provider has no speech-to-text model llm-connect knows of.",
        },
      };
  }
}

/** The transcription model the settings call, or null when they cannot transcribe. */
export function transcriptionTargetOf(
  settings: LlmSettings,
  model?: string,
): TranscriptionTarget | null {
  const r = resolve(settings, model);
  return "target" in r ? r.target : null;
}

/** Why the settings cannot transcribe, or null when they can. */
export function transcriptionProblem(
  settings: LlmSettings,
  model?: string,
): TranscriptionProblem | null {
  const r = resolve(settings, model);
  return "problem" in r ? r.problem : null;
}

export interface TranscriptionModelOptions extends GuardedFetchOptions {
  /** A transcription model id; the provider's default when missing. */
  model?: string;
}

/**
 * The AI SDK transcription model the settings point to, its SDK imported on demand. Every request
 * goes through {@link guardedFetch}, as for chat models. Throws when the settings cannot transcribe.
 */
export async function loadTranscriptionModel(
  settings: LlmSettings,
  options: TranscriptionModelOptions = {},
): Promise<TranscriptionModel> {
  const r = resolve(settings, options.model);
  if ("problem" in r) throw new Error(r.problem.message);
  const { sdk, model, baseURL } = r.target;
  const config = {
    apiKey: settings.apiKey || "",
    ...(baseURL ? { baseURL } : {}),
    ...(settings.headers ? { headers: settings.headers } : {}),
    fetch: guardedFetch(providerKindOf(settings), options) as typeof globalThis.fetch,
  };
  switch (sdk) {
    case "openai":
      return (await import("@ai-sdk/openai")).createOpenAI(config).transcription(model);
    case "google":
      return (await import("@ai-sdk/google")).createGoogle(config).transcription(model);
    case "mistral":
      return (await import("@ai-sdk/mistral")).createMistral(config).transcription(model);
  }
}

export interface TranscribeOptions extends TranscriptionModelOptions {
  /** ISO 639-1 code of the spoken language; detected when missing. */
  language?: string;
  /** Ask for word timings where the model can give them. Default true. */
  words?: boolean;
  /** Words the model may not know (product names): a prompt for Whisper, a bias for the others. */
  vocabulary?: string[];
  abortSignal?: AbortSignal;
  maxRetries?: number;
}

export type AudioInput = Blob | ArrayBuffer | Uint8Array;

async function bytesOf(audio: AudioInput): Promise<{ data: Uint8Array; mediaType?: string }> {
  if (audio instanceof Uint8Array) return { data: audio };
  if (audio instanceof ArrayBuffer) return { data: new Uint8Array(audio) };
  return {
    data: new Uint8Array(await audio.arrayBuffer()),
    ...(audio.type ? { mediaType: audio.type.split(";")[0] } : {}),
  };
}

function providerOptionsFor(
  target: TranscriptionTarget,
  options: TranscribeOptions,
): Record<string, Record<string, JSONValue>> {
  const words = options.words ?? true;
  const vocabulary = options.vocabulary?.filter(Boolean) ?? [];
  switch (target.sdk) {
    case "openai": {
      // Only Whisper models time anything; the gpt-4o ones answer plain text.
      const whisper = /whisper/i.test(target.model);
      return {
        openai: {
          ...(options.language ? { language: options.language } : {}),
          ...(vocabulary.length ? { prompt: vocabulary.join(", ") } : {}),
          ...(whisper ? { timestampGranularities: words ? ["word"] : ["segment"] } : {}),
        },
      };
    }
    case "google":
      return {
        google: {
          ...(options.language ? { languageCodes: [options.language] } : {}),
          ...(vocabulary.length ? { customVocabulary: vocabulary } : {}),
          wordTimestamp: words,
        },
      };
    case "mistral":
      return {
        mistral: {
          ...(options.language ? { language: options.language } : {}),
          ...(vocabulary.length ? { contextBias: vocabulary } : {}),
          timestampGranularities: words ? ["word"] : ["segment"],
        },
      };
  }
}

/** The `words` of an OpenAI-style verbose answer, when it has them. */
function rawWords(raw: unknown): TranscriptPiece[] | null {
  const words = (raw as { words?: unknown } | null)?.words;
  if (!Array.isArray(words) || !words.length) return null;
  const pieces: TranscriptPiece[] = [];
  for (const w of words as { word?: unknown; start?: unknown; end?: unknown }[]) {
    if (typeof w?.word !== "string" || typeof w.start !== "number" || typeof w.end !== "number")
      return null;
    pieces.push({ text: w.word, start: w.start, end: w.end });
  }
  return pieces;
}

/** Stands for the audio in `transcribe`, whose `download` then hands it over with its type. */
const AUDIO_URL = new URL("https://llm-connect.invalid/audio");

/**
 * Transcribe audio with the provider the settings point to. The audio's own type is sent (the AI
 * SDK does not recognise WebM or MP4 audio from their bytes), so a `MediaRecorder` blob works as
 * is. Providers cap uploads (25 MB for OpenAI and Groq): cut longer recordings first.
 */
export async function transcribe(
  settings: LlmSettings,
  audio: AudioInput,
  options: TranscribeOptions = {},
): Promise<Transcript> {
  const r = resolve(settings, options.model);
  if ("problem" in r) throw new Error(r.problem.message);
  // The SDK keeps segments over words when a server sends both (Groq does): the raw answer is
  // read too, for its words.
  let raw: unknown = null;
  const base = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const fetch: FetchLike = async (input, init) => {
    const res = await base(input, init);
    if (res.ok && (res.headers.get("content-type") ?? "").includes("json"))
      raw = await res
        .clone()
        .json()
        .catch(() => null);
    return res;
  };
  const [{ transcribe: sdkTranscribe }, model, bytes] = await Promise.all([
    import("ai"),
    loadTranscriptionModel(settings, { ...options, fetch }),
    bytesOf(audio),
  ]);
  const result = await sdkTranscribe({
    model,
    audio: AUDIO_URL,
    download: async () => ({ data: bytes.data, mediaType: bytes.mediaType }),
    providerOptions: providerOptionsFor(r.target, options),
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  });
  return toTranscript({
    text: result.text,
    ...(result.language ? { language: result.language } : {}),
    ...(result.durationInSeconds !== undefined ? { duration: result.durationInSeconds } : {}),
    pieces:
      rawWords(raw) ??
      result.segments.map((s) => ({ text: s.text, start: s.startSecond, end: s.endSecond })),
  });
}
