import { afterEach, describe, expect, it } from "bun:test";
import type { LlmSettings } from "../settings.js";
import { transcribe, transcriptionProblem, transcriptionTargetOf } from "../transcription.js";

// The SDK warns about unknown models
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

interface Captured {
  url: string;
  headers: Record<string, string>;
  form: FormData | null;
  json: Record<string, unknown> | null;
}

const realFetch = globalThis.fetch;
let calls: Captured[] = [];

function serve(body: unknown) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const isForm = init?.body instanceof FormData;
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      form: isForm ? (init?.body as FormData) : null,
      json: !isForm && typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const openai: LlmSettings = { apiKey: "sk", model: "gpt-5", providerNpm: "@ai-sdk/openai" };
const audio = new Blob([new Uint8Array([26, 69, 223, 163, 1, 2, 3])], {
  type: "audio/webm;codecs=opus",
});

describe("transcriptionTargetOf", () => {
  it("picks each provider's transcription model", () => {
    expect(transcriptionTargetOf(openai)).toEqual({ sdk: "openai", model: "whisper-1" });
    expect(
      transcriptionTargetOf({ apiKey: "g", model: "gemini-3", providerNpm: "@ai-sdk/google" }),
    ).toEqual({ sdk: "google", model: "gemini-3.5-transcribe" });
    expect(
      transcriptionTargetOf({
        apiKey: "m",
        model: "mistral-large",
        providerNpm: "@ai-sdk/mistral",
      }),
    ).toEqual({ sdk: "mistral", model: "voxtral-mini-latest" });
    expect(transcriptionTargetOf(openai, "gpt-4o-transcribe")?.model).toBe("gpt-4o-transcribe");
  });

  it("knows Groq and needs a model name for other compatible servers", () => {
    expect(
      transcriptionTargetOf({
        apiKey: "gk",
        model: "llama",
        providerNpm: "@ai-sdk/openai-compatible",
        providerApi: "https://api.groq.com/openai/v1",
      }),
    ).toEqual({
      sdk: "openai",
      model: "whisper-large-v3-turbo",
      baseURL: "https://api.groq.com/openai/v1",
    });
    const local: LlmSettings = {
      apiKey: "",
      model: "",
      customEndpoint: "http://localhost:8000/v1",
      customModel: "llama3.2",
    };
    expect(transcriptionProblem(local)?.code).toBe("no-model");
    expect(transcriptionTargetOf(local, "Systran/faster-whisper-small")).toEqual({
      sdk: "openai",
      model: "Systran/faster-whisper-small",
      baseURL: "http://localhost:8000/v1",
    });
  });

  it("says why Anthropic or a missing key cannot transcribe", () => {
    expect(
      transcriptionProblem({ apiKey: "a", model: "claude", providerNpm: "@ai-sdk/anthropic" })
        ?.code,
    ).toBe("unsupported");
    expect(transcriptionProblem({ ...openai, apiKey: "" })?.code).toBe("no-key");
    expect(transcriptionProblem(openai)).toBeNull();
  });
});

describe("transcribe", () => {
  it("sends Whisper the recording's own type and reads its word timings", async () => {
    serve({
      text: "Click save.",
      language: "english",
      duration: 1.2,
      words: [
        { word: "Click", start: 0.1, end: 0.5 },
        { word: "save.", start: 0.5, end: 1 },
      ],
    });
    const t = await transcribe(openai, audio, { language: "en", maxRetries: 0 });
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(calls[0]?.headers.authorization).toBe("Bearer sk");
    expect(calls[0]?.headers["user-agent"]).toBeUndefined();
    const form = calls[0]?.form as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("en");
    expect(form.getAll("timestamp_granularities[]")).toEqual(["word"]);
    const file = form.get("file") as File;
    expect(file.type).toBe("audio/webm");
    expect(t).toEqual({
      text: "Click save.",
      language: "en",
      duration: 1.2,
      segments: [{ text: "Click save.", start: 0.1, end: 1 }],
      words: [
        { text: "Click", start: 0.1, end: 0.5 },
        { text: "save.", start: 0.5, end: 1 },
      ],
      wordTimings: "exact",
    });
  });

  it("prefers the raw words when a server also sends segments (Groq)", async () => {
    serve({
      text: "Hi there",
      segments: [
        {
          id: 0,
          seek: 0,
          start: 0,
          end: 2,
          text: "Hi there",
          tokens: [1, 2],
          temperature: 0,
          avg_logprob: -0.1,
          compression_ratio: 1,
          no_speech_prob: 0,
        },
      ],
      words: [
        { word: "Hi", start: 0, end: 0.6 },
        { word: "there", start: 0.7, end: 1.4 },
      ],
    });
    const t = await transcribe(
      {
        apiKey: "gk",
        model: "llama",
        providerNpm: "@ai-sdk/openai-compatible",
        providerApi: "https://api.groq.com/openai/v1",
      },
      audio,
      { maxRetries: 0 },
    );
    expect(calls[0]?.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(calls[0]?.form?.get("model")).toBe("whisper-large-v3-turbo");
    expect(t.words).toEqual([
      { text: "Hi", start: 0, end: 0.6 },
      { text: "there", start: 0.7, end: 1.4 },
    ]);
    expect(t.wordTimings).toBe("exact");
  });

  it("asks Mistral for word timings with the vocabulary as a bias", async () => {
    serve({
      model: "voxtral-mini-latest",
      text: "Open stepcast",
      language: "en",
      segments: [
        { text: "Open", start: 0, end: 0.4 },
        { text: "stepcast", start: 0.4, end: 1 },
      ],
    });
    const t = await transcribe(
      { apiKey: "m", model: "mistral-large", providerNpm: "@ai-sdk/mistral" },
      audio,
      { vocabulary: ["stepcast"], maxRetries: 0 },
    );
    const form = calls[0]?.form as FormData;
    expect(calls[0]?.url).toBe("https://api.mistral.ai/v1/audio/transcriptions");
    expect(form.get("timestamp_granularities")).toBe("word");
    expect(form.get("context_bias")).toBe("stepcast");
    expect(t.wordTimings).toBe("exact");
    expect(t.segments).toEqual([{ text: "Open stepcast", start: 0, end: 1 }]);
  });

  it("keeps Mistral's word timings over a spoken language, which it refuses together", async () => {
    serve({ model: "voxtral-mini-latest", text: "Ouvre stepcast", language: "fr", segments: [] });
    await transcribe(
      { apiKey: "m", model: "mistral-large", providerNpm: "@ai-sdk/mistral" },
      audio,
      { language: "fr", maxRetries: 0 },
    );
    const form = calls[0]?.form as FormData;
    expect(form.get("timestamp_granularities")).toBe("word");
    expect(form.get("language")).toBeNull();
  });

  it("sends Mistral the spoken language when no word timings are asked", async () => {
    serve({ model: "voxtral-mini-latest", text: "Deux œufs", language: "fr" });
    const t = await transcribe(
      { apiKey: "m", model: "mistral-large", providerNpm: "@ai-sdk/mistral" },
      audio,
      { language: "fr", words: false, maxRetries: 0 },
    );
    const form = calls[0]?.form as FormData;
    expect(form.get("language")).toBe("fr");
    expect(form.get("timestamp_granularities")).toBeNull();
    expect(t.text).toBe("Deux œufs");
  });

  it("falls back to estimated words for a model without timings", async () => {
    serve({ text: "No timings here." });
    const t = await transcribe(openai, audio, { model: "gpt-4o-transcribe", maxRetries: 0 });
    expect(calls[0]?.form?.get("model")).toBe("gpt-4o-transcribe");
    expect(t.text).toBe("No timings here.");
    expect(t.wordTimings).toBe("none");
  });

  it("refuses settings that cannot transcribe before any request", async () => {
    serve({});
    await expect(
      transcribe({ apiKey: "a", model: "claude", providerNpm: "@ai-sdk/anthropic" }, audio),
    ).rejects.toThrow("no speech-to-text");
    expect(calls).toHaveLength(0);
  });
});
