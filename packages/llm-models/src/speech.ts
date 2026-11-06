// Speech (text-to-speech) models: the shape `listSpeechModels` gives them and
// the helpers an app reads them with. Entry `llm-models/speech`: plain types and
// functions, no Zod and no other import, so an app bundle stays small.

/** The services llm-models lists speech models from, by the id llm-connect calls them with. */
export const SPEECH_PROVIDERS = ["gateway", "fal", "openai", "google", "elevenlabs"] as const;
export type SpeechProviderId = (typeof SPEECH_PROVIDERS)[number];

/** A voice a model speaks with, by the id its API takes. */
export interface SpeechVoice {
  id: string;
  name: string;
  language?: string;
  gender?: string;
  /** Its style, as the provider describes it ("Bright", "Firm"). */
  description?: string;
}

/** One listed price, in US dollars per million characters read or per minute of speech. */
export interface SpeechPrice {
  usd: number;
  per: "million-characters" | "minute";
}

/** A speech model, as its provider's API takes it. `null` means the source does not say. */
export interface SpeechModel {
  provider: SpeechProviderId;
  /** The id the provider's API takes ("elevenlabs/eleven-v4", "gpt-4o-mini-tts"). */
  id: string;
  name: string;
  /** Who makes the model ("elevenlabs", "google"), as the provider names them. */
  owner: string;
  description?: string;
  /** The voices it speaks with. */
  voices: SpeechVoice[] | null;
  /** The languages it reads, as the provider names them ("en", "French"). */
  languages: string[] | null;
  /** Audio formats it returns ("mp3", "wav"). */
  formats: string[] | null;
  /** Whether it takes free-text style instructions ("speak softly"). */
  instructions: boolean | null;
  /** Listed prices; empty when the source lists none (or bills by token). */
  prices: SpeechPrice[];
  /** The longest text one call reads, in characters. */
  maxChars?: number;
  /** Release date, `YYYY-MM-DD`. */
  released?: string;
}

const voices = (list: string, lower = false): readonly SpeechVoice[] =>
  list.split(" ").map((entry) => {
    const [name = "", description] = entry.split(":");
    return { id: lower ? name.toLowerCase() : name, name, ...(description ? { description } : {}) };
  });

/**
 * The built-in voices of OpenAI's speech API (`tts-1` and `tts-1-hd` take only
 * Alloy, Ash, Coral, Echo, Fable, Nova, Onyx, Sage and Shimmer).
 * https://platform.openai.com/docs/guides/text-to-speech
 */
export const OPENAI_VOICES: readonly SpeechVoice[] = voices(
  "Alloy Ash Ballad Coral Echo Fable Nova Onyx Sage Shimmer Verse Marin Cedar",
  true,
);

/**
 * The 30 prebuilt voices of Gemini TTS, with the style Google gives each.
 * https://ai.google.dev/gemini-api/docs/speech-generation
 */
export const GEMINI_VOICES: readonly SpeechVoice[] = voices(
  "Zephyr:Bright Puck:Upbeat Charon:Informative Kore:Firm Fenrir:Excitable Leda:Youthful " +
    "Orus:Firm Aoede:Breezy Callirrhoe:Easy-going Autonoe:Bright Enceladus:Breathy Iapetus:Clear " +
    "Umbriel:Easy-going Algieba:Smooth Despina:Smooth Erinome:Clear Algenib:Gravelly " +
    "Rasalgethi:Informative Laomedeia:Upbeat Achernar:Soft Alnilam:Firm Schedar:Even Gacrux:Mature " +
    "Pulcherrima:Forward Achird:Friendly Zubenelgenubi:Casual Vindemiatrix:Gentle Sadachbia:Lively " +
    "Sadaltager:Knowledgeable Sulafat:Warm",
);

/**
 * What reading `characters` characters costs, in US dollars, from a
 * per-character price (the highest listed). `null` when the model lists none:
 * a per-minute price cannot be counted from text alone.
 */
export function speechPrice(model: Pick<SpeechModel, "prices">, characters: number): number | null {
  const rates = model.prices.filter((p) => p.per === "million-characters").map((p) => p.usd);
  return rates.length ? (Math.max(...rates) * characters) / 1e6 : null;
}

/** The models of `provider` (every provider when absent) whose name or id holds `query`. */
export function filterSpeechModels(
  models: readonly SpeechModel[],
  options: { provider?: SpeechProviderId; query?: string } = {},
): SpeechModel[] {
  const wanted = options.query?.trim().toLowerCase() ?? "";
  return models.filter(
    (m) =>
      (!options.provider || m.provider === options.provider) &&
      (!wanted || m.name.toLowerCase().includes(wanted) || m.id.toLowerCase().includes(wanted)),
  );
}
