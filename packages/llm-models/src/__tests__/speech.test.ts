import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { setCacheEnabled } from "../cache-core";
import {
  describeFalSpeechModel,
  describeOpenApiSpeechInput,
  fromGatewaySpeech,
  listSpeechModels,
} from "../functions/speech";
import {
  filterSpeechModels,
  GEMINI_VOICES,
  OPENAI_VOICES,
  type SpeechModel,
  speechPrice,
} from "../speech";
import fal from "./fixtures/speech/fal-text-to-speech.json";
import falXai from "./fixtures/speech/fal-xai-tts-openapi.json";
import gateway from "./fixtures/speech/gateway-models.json";

beforeAll(() => setCacheEnabled(false));

const devModel = (id: string, name: string, output: string[]) => ({
  id,
  name,
  attachment: false,
  reasoning: false,
  tool_call: false,
  open_weights: false,
  release_date: "2025-05-01",
  last_updated: "2025-05-01",
  modalities: { input: ["text"], output },
  limit: { context: 8192, output: 16384 },
});

const modelsDev = {
  google: {
    id: "google",
    name: "Google",
    doc: "https://ai.google.dev",
    env: ["GEMINI_API_KEY"],
    npm: "@ai-sdk/google",
    models: {
      "gemini-2.5-flash-preview-tts": devModel(
        "gemini-2.5-flash-preview-tts",
        "Gemini 2.5 Flash Preview TTS",
        ["audio"],
      ),
      "gemini-3.1-flash-live-preview": devModel(
        "gemini-3.1-flash-live-preview",
        "Gemini 3.1 Flash Live Preview",
        ["text", "audio"],
      ),
      "lyria-3-pro-preview": devModel("lyria-3-pro-preview", "Lyria 3 Pro Preview", ["audio"]),
    },
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    doc: "https://platform.openai.com/docs",
    env: ["OPENAI_API_KEY"],
    npm: "@ai-sdk/openai",
    models: {
      "gpt-realtime-2.1": devModel("gpt-realtime-2.1", "GPT-Realtime-2.1", ["text", "audio"]),
    },
  },
};

const elevenModels = [
  {
    model_id: "eleven_v4",
    name: "Eleven v4",
    can_do_text_to_speech: true,
    maximum_text_length_per_request: 10000,
    languages: [
      { language_id: "en", name: "English" },
      { language_id: "fr", name: "French" },
    ],
  },
  { model_id: "eleven_english_sts_v2", name: "Eleven English v2", can_do_text_to_speech: false },
];
const elevenVoices = (page: number) => ({
  voices: [
    page === 0
      ? {
          voice_id: "JBFqnCBsd6RMkjVDRZzb",
          name: "George",
          category: "premade",
          labels: { gender: "male", accent: "british", description: "warm" },
          verified_languages: [{ language: "en", model_id: "eleven_v4" }],
        }
      : { voice_id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", labels: { gender: "female" } },
  ],
  has_more: page === 0,
  next_page_token: page === 0 ? "p2" : null,
});

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A fetch that answers each service with its fixture, and records the calls. */
function fakeServices(overrides: Record<string, () => Response> = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const answer = (body: unknown) => new Response(JSON.stringify(body));
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    for (const [part, respond] of Object.entries(overrides))
      if (url.includes(part)) return respond();
    if (url.startsWith("https://ai-gateway.vercel.sh/v1/models")) return answer(gateway);
    if (url.includes("api.fal.ai/v1/models?endpoint_id=")) return answer(falXai);
    if (url.startsWith("https://api.fal.ai/v1/models")) return answer(fal);
    if (url.startsWith("https://models.dev")) return answer(modelsDev);
    if (url.startsWith("https://api.elevenlabs.io/v1/models")) return answer(elevenModels);
    if (url.startsWith("https://api.elevenlabs.io/v2/voices"))
      return answer(elevenVoices(url.includes("next_page_token=p2") ? 1 : 0));
    return new Response("not found", { status: 404, statusText: "Not Found" });
  }) as typeof fetch;
  return calls;
}

const gatewayEntry = (id: string) => {
  const entry = gateway.data.find((m) => m.id === id);
  if (!entry) throw new Error(`no fixture ${id}`);
  return fromGatewaySpeech(entry as Parameters<typeof fromGatewaySpeech>[0]);
};

describe("speech voices", () => {
  it("holds OpenAI's 13 voices and Gemini's 30, each with its style", () => {
    expect(OPENAI_VOICES.map((v) => v.id)).toEqual([
      "alloy",
      "ash",
      "ballad",
      "coral",
      "echo",
      "fable",
      "nova",
      "onyx",
      "sage",
      "shimmer",
      "verse",
      "marin",
      "cedar",
    ]);
    expect(GEMINI_VOICES).toHaveLength(30);
    expect(GEMINI_VOICES[0]).toEqual({ id: "Zephyr", name: "Zephyr", description: "Bright" });
    expect(GEMINI_VOICES.find((v) => v.id === "Callirrhoe")?.description).toBe("Easy-going");
    expect(GEMINI_VOICES.every((v) => v.description)).toBe(true);
  });
});

describe("speech model sources", () => {
  it("reads the AI Gateway's per-character price, per million characters", () => {
    const eleven = gatewayEntry("elevenlabs/eleven-v4");
    expect(eleven).toMatchObject({
      provider: "gateway",
      owner: "elevenlabs",
      prices: [{ usd: 40, per: "million-characters" }],
      voices: null,
    });
    expect(speechPrice(eleven, 1000)).toBeCloseTo(0.04);
    expect(speechPrice({ prices: [{ usd: 0.3, per: "minute" }] }, 1000)).toBeNull();
  });

  it("gives the Gateway's OpenAI and Gemini models their makers' voices", () => {
    const tts1 = gatewayEntry("openai/tts-1");
    expect(tts1.voices?.map((v) => v.id)).not.toContain("marin");
    expect(tts1.voices).toHaveLength(9);
    expect(tts1.instructions).toBe(false);
    const gemini = gatewayEntry("google/gemini-3.8-flash-tts");
    expect(gemini.voices).toHaveLength(30);
    expect(gemini).toMatchObject({ instructions: true, prices: [] });
  });

  it("reads fal.ai's schema: voices, languages, audio formats, text limit", () => {
    const described = describeOpenApiSpeechInput(falXai.models[0]?.openapi);
    expect(described?.voices?.[0]).toEqual({ id: "carina", name: "carina" });
    expect(described?.voices).toHaveLength(28);
    expect(described?.languages).toContain("fr");
    expect(described?.languages).not.toContain("auto");
    expect(described?.formats).toEqual(["mp3", "wav", "pcm", "mulaw", "alaw"]);
    expect(described).toMatchObject({ instructions: null, maxChars: 15000 });
    expect(
      describeOpenApiSpeechInput({
        components: {
          schemas: {
            TtsInput: {
              properties: {
                prompt: { type: "string" },
                style_instructions: { type: "string" },
                output_format: { enum: ["url", "hex"] },
              },
            },
          },
        },
      }),
    ).toEqual({ voices: null, languages: null, formats: null, instructions: true });
    expect(describeOpenApiSpeechInput({})).toBeNull();
  });
});

describe("listSpeechModels", () => {
  it("lists every service that needs no key, music and sound effects left out", async () => {
    const calls = fakeServices();
    const models = await listSpeechModels();
    const providers = [...new Set(models.map((m) => m.provider))].sort();
    expect(providers).toEqual(["fal", "gateway", "google", "openai"]);
    expect(models.filter((m) => m.provider === "gateway").map((m) => m.id)).toEqual([
      "elevenlabs/eleven-v4",
      "fish-audio/s2-pro",
      "google/gemini-3.8-flash-tts",
      "openai/tts-1",
    ]);
    // fal: active models only.
    expect(models.filter((m) => m.provider === "fal")).toHaveLength(3);
    expect(models.some((m) => m.id === "fal-ai/maya")).toBe(false);
    // models.dev: the TTS model, not the live chat model nor the music model.
    expect(models.filter((m) => m.provider === "google").map((m) => m.id)).toEqual([
      "gemini-2.5-flash-preview-tts",
    ]);
    expect(models.find((m) => m.provider === "google")?.voices).toHaveLength(30);
    // OpenAI: its documented speech models, not its realtime model.
    expect(models.filter((m) => m.provider === "openai").map((m) => m.id)).toEqual([
      "gpt-4o-mini-tts",
      "tts-1",
      "tts-1-hd",
    ]);
    expect(models.find((m) => m.id === "gpt-4o-mini-tts")).toMatchObject({
      instructions: true,
      maxChars: 4096,
    });
    expect(calls.some((c) => c.url.includes("elevenlabs.io"))).toBe(false);
  });

  it("keeps answering when a source fails", async () => {
    fakeServices({ "api.fal.ai": () => new Response("down", { status: 503, statusText: "Down" }) });
    const models = await listSpeechModels({ providers: ["gateway", "fal"] });
    expect(models.map((m) => m.provider)).toEqual(["gateway", "gateway", "gateway", "gateway"]);
  });

  it("lists ElevenLabs' models and every page of voices with its key, in a header", async () => {
    const calls = fakeServices();
    const models = await listSpeechModels({
      providers: ["elevenlabs", "gateway"],
      elevenLabsApiKey: "xi-key",
    });
    const eleven = models.filter((m) => m.provider === "elevenlabs");
    expect(eleven.map((m) => m.id)).toEqual(["eleven_v4"]);
    expect(eleven[0]).toMatchObject({ languages: ["en", "fr"], maxChars: 10000 });
    expect(eleven[0]?.voices).toEqual([
      {
        id: "JBFqnCBsd6RMkjVDRZzb",
        name: "George",
        language: "en",
        gender: "male",
        description: "warm",
      },
      { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", gender: "female" },
    ]);
    // The Gateway's ElevenLabs models get the same voices.
    expect(models.find((m) => m.id === "elevenlabs/eleven-v4")?.voices).toHaveLength(2);
    const elevenCalls = calls.filter((c) => c.url.includes("elevenlabs.io"));
    expect(elevenCalls).toHaveLength(3);
    for (const call of elevenCalls) {
      expect(call.url).not.toContain("xi-key");
      expect(call.headers["xi-api-key"]).toBe("xi-key");
    }
  });

  it("describes one fal.ai endpoint with its voices", async () => {
    fakeServices();
    const m = await describeFalSpeechModel("xai/tts/v1");
    expect(m).toMatchObject({ provider: "fal", id: "xai/tts/v1", owner: "xai", maxChars: 15000 });
    expect(m?.voices?.length).toBe(28);
  });
});

describe("speech helpers", () => {
  it("filters by provider and text", () => {
    const models: SpeechModel[] = [gatewayEntry("openai/tts-1"), gatewayEntry("fish-audio/s2-pro")];
    expect(filterSpeechModels(models, { query: "TTS" })).toHaveLength(1);
    expect(filterSpeechModels(models, { provider: "gateway" })).toHaveLength(2);
    expect(filterSpeechModels(models, { provider: "fal" })).toHaveLength(0);
  });
});

describe("documented voices on fal.ai", () => {
  it("keeps the style Google gives a Gemini voice fal.ai serves", () => {
    const described = describeOpenApiSpeechInput({
      components: { schemas: { Input: { properties: { voice: { enum: ["Kore", "custom"] } } } } },
    });
    expect(described?.voices).toEqual([
      { id: "Kore", name: "Kore", description: "Firm" },
      { id: "custom", name: "custom" },
    ]);
  });
});
