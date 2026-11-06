import { describe, expect, it } from "bun:test";
import type { FetchLike } from "../fetch";
import {
  generateImages,
  IMAGE_PROVIDER_INFO,
  IMAGE_PROVIDERS,
  loadImageModel,
  testImageKey,
} from "../image";
import { testMediaKey } from "../media-keys";
import {
  generateSpeechAudio,
  listVoices,
  SPEECH_PROVIDER_INFO,
  SPEECH_PROVIDERS,
  testSpeechKey,
} from "../speech";

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

type Answer = { status?: number; body: unknown; type?: string };

/** A fetch that answers by URL and records each request (headers lower-cased, JSON bodies parsed). */
function fakeFetch(route: (url: string, method: string) => Answer) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((v, k) => {
      headers[k] = v;
    });
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, headers, body });
    const answer = route(url, method);
    const binary = answer.body instanceof Uint8Array;
    return new Response(
      binary
        ? (answer.body as Uint8Array<ArrayBuffer>)
        : typeof answer.body === "string"
          ? answer.body
          : JSON.stringify(answer.body),
      {
        status: answer.status ?? 200,
        headers: {
          "content-type": answer.type ?? (binary ? "application/octet-stream" : "application/json"),
        },
      },
    );
  };
  return { fetch, calls };
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const MP3 = new Uint8Array([255, 251, 144, 68, 0, 0, 0, 0, 0, 0, 0, 0]);
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

describe("OpenRouter images", () => {
  const settings = {
    provider: "openrouter" as const,
    apiKey: "or-secret",
    model: "bytedance-seed/seedream-4.5",
  };

  it("generates through the Image API, one image a call, and adds up the cost", async () => {
    const or = fakeFetch(() => ({
      body: {
        created: 1,
        data: [{ b64_json: b64(PNG), media_type: "image/png" }],
        usage: { cost: 0.04 },
      },
    }));
    const result = await generateImages(
      settings,
      { prompt: "A red panda astronaut.", aspectRatio: "16:9", n: 2, seed: 7 },
      { fetch: or.fetch },
    );
    expect(result.images).toHaveLength(2);
    expect(result.images[0]!.mediaType).toBe("image/png");
    expect(Array.from(result.images[0]!.data)).toEqual(Array.from(PNG));
    expect(result.costUsd).toBeCloseTo(0.08);
    expect(or.calls).toHaveLength(2);
    expect(or.calls[0]).toMatchObject({
      url: "https://openrouter.ai/api/v1/images",
      method: "POST",
      headers: { authorization: "Bearer or-secret" },
      body: {
        model: "bytedance-seed/seedream-4.5",
        prompt: "A red panda astronaut.",
        aspect_ratio: "16:9",
        seed: 7,
      },
    });
    expect((or.calls[0]!.body as { n?: number }).n).toBeUndefined();
  });

  it("asks chat completions for a model the Image API does not serve, and decodes the data URL", async () => {
    const or = fakeFetch((url) =>
      url.endsWith("/images")
        ? { status: 404, body: { error: { code: 404, message: "Model not found" } } }
        : {
            body: {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "Here it is.",
                    images: [
                      {
                        type: "image_url",
                        image_url: { url: `data:image/png;base64,${b64(PNG)}` },
                      },
                    ],
                  },
                },
              ],
              usage: { cost: 0.039 },
            },
          },
    );
    const result = await generateImages(
      { ...settings, model: "google/gemini-2.5-flash-image" },
      { prompt: "A lighthouse.", aspectRatio: "9:16" },
      { fetch: or.fetch },
    );
    expect(result.images).toHaveLength(1);
    expect(Array.from(result.images[0]!.data)).toEqual(Array.from(PNG));
    expect(result.images[0]!.mediaType).toBe("image/png");
    expect(result.costUsd).toBe(0.039);
    expect(or.calls[1]).toMatchObject({
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { authorization: "Bearer or-secret" },
      body: {
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content: "A lighthouse." }],
        modalities: ["image", "text"],
        image_config: { aspect_ratio: "9:16" },
      },
    });
  });

  it("reports a refused key without the key", async () => {
    const refused = fakeFetch(() => ({
      status: 401,
      body: { error: { message: "Invalid key or-secret" } },
    }));
    const error = await generateImages(settings, { prompt: "x" }, { fetch: refused.fetch }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain("or-secret");
    expect(refused.calls).toHaveLength(1);
  });
});

describe("AI SDK image providers", () => {
  it("generates with OpenAI through its SDK", async () => {
    const openai = fakeFetch(() => ({
      body: { created: 1, data: [{ b64_json: b64(PNG) }] },
    }));
    const result = await generateImages(
      { provider: "openai", apiKey: "sk-secret", model: "gpt-image-1" },
      { prompt: "A teapot.", size: "1024x1024", providerOptions: { openai: { quality: "high" } } },
      { fetch: openai.fetch },
    );
    expect(result.images[0]!.mediaType).toBe("image/png");
    expect(openai.calls[0]).toMatchObject({
      url: "https://api.openai.com/v1/images/generations",
      method: "POST",
      headers: { authorization: "Bearer sk-secret" },
      body: { model: "gpt-image-1", prompt: "A teapot.", n: 1, size: "1024x1024", quality: "high" },
    });
  });

  it("generates with fal.ai through its SDK, and downloads the image it answers", async () => {
    const fal = fakeFetch((url) =>
      url.startsWith("https://fal.run/")
        ? {
            body: {
              images: [{ url: "https://v3.fal.media/files/a.png", content_type: "image/png" }],
            },
          }
        : { body: PNG, type: "image/png" },
    );
    const result = await generateImages(
      { provider: "fal", apiKey: "fal-secret", model: "fal-ai/flux/dev" },
      { prompt: "A fox.", aspectRatio: "16:9", seed: 3 },
      { fetch: fal.fetch },
    );
    expect(Array.from(result.images[0]!.data)).toEqual(Array.from(PNG));
    expect(fal.calls[0]).toMatchObject({
      url: "https://fal.run/fal-ai/flux/dev",
      headers: { authorization: "Key fal-secret" },
      body: { prompt: "A fox.", seed: 3, num_images: 1 },
    });
    expect((fal.calls[0]!.body as { image_size?: unknown }).image_size).toBeDefined();
    expect(fal.calls[1]!.url).toBe("https://v3.fal.media/files/a.png");
    expect(fal.calls[1]!.headers.authorization).toBeUndefined();
  });

  it("generates with a Gemini image model through Google's SDK", async () => {
    const google = fakeFetch(() => ({
      body: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ inlineData: { mimeType: "image/png", data: b64(PNG) } }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1290, totalTokenCount: 1295 },
      },
    }));
    const result = await generateImages(
      { provider: "google", apiKey: "g-secret", model: "gemini-2.5-flash-image" },
      { prompt: "A kite.", aspectRatio: "3:4" },
      { fetch: google.fetch },
    );
    expect(Array.from(result.images[0]!.data)).toEqual(Array.from(PNG));
    expect(google.calls[0]!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
    );
    expect(google.calls[0]!.headers["x-goog-api-key"]).toBe("g-secret");
    expect(google.calls[0]!.body).toMatchObject({
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4" } },
    });
  });

  it("refuses a Google id that is not a Gemini image model", async () => {
    await expect(
      loadImageModel({ provider: "google", apiKey: "g", model: "imagen-4.0-generate-001" }),
    ).rejects.toThrow(/Gemini image models/);
  });

  it("reports a refused key without the key", async () => {
    const refused = fakeFetch(() => ({
      status: 401,
      body: {
        error: { message: "Incorrect API key provided: sk-secret", type: "invalid_request_error" },
      },
    }));
    const error = await generateImages(
      { provider: "openai", apiKey: "sk-secret", model: "gpt-image-1" },
      { prompt: "x" },
      { fetch: refused.fetch },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain("sk-secret");
    expect(error.code).toBe("auth");
  });

  it("knows where every provider's key comes from", () => {
    for (const p of IMAGE_PROVIDERS) expect(IMAGE_PROVIDER_INFO[p].keyUrl).toStartWith("https://");
    expect(IMAGE_PROVIDER_INFO.openrouter.package).toBeNull();
  });
});

describe("AI SDK speech providers", () => {
  it("speaks with OpenAI through its SDK", async () => {
    const openai = fakeFetch(() => ({ body: MP3, type: "audio/mpeg" }));
    const result = await generateSpeechAudio(
      { provider: "openai", apiKey: "sk-secret", model: "gpt-4o-mini-tts" },
      {
        text: "Hello there.",
        voice: "coral",
        instructions: "Cheerful.",
        speed: 1.1,
        format: "mp3",
      },
      { fetch: openai.fetch },
    );
    expect(result.audio.mediaType).toBe("audio/mpeg");
    expect(Array.from(result.audio.data)).toEqual(Array.from(MP3));
    expect(openai.calls[0]).toMatchObject({
      url: "https://api.openai.com/v1/audio/speech",
      method: "POST",
      headers: { authorization: "Bearer sk-secret" },
      body: {
        model: "gpt-4o-mini-tts",
        input: "Hello there.",
        voice: "coral",
        instructions: "Cheerful.",
        speed: 1.1,
        response_format: "mp3",
      },
    });
  });

  it("speaks with ElevenLabs through its SDK, the key in xi-api-key", async () => {
    const eleven = fakeFetch(() => ({ body: MP3, type: "audio/mpeg" }));
    const result = await generateSpeechAudio(
      { provider: "elevenlabs", apiKey: "el-secret", model: "eleven_multilingual_v2" },
      { text: "Bonjour.", voice: "voice-1", language: "fr" },
      { fetch: eleven.fetch },
    );
    expect(result.audio.mediaType).toBe("audio/mpeg");
    expect(eleven.calls[0]!.url).toStartWith(
      "https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=",
    );
    expect(eleven.calls[0]).toMatchObject({
      method: "POST",
      headers: { "xi-api-key": "el-secret" },
      body: { text: "Bonjour.", model_id: "eleven_multilingual_v2", language_code: "fr" },
    });
    expect(eleven.calls[0]!.headers.authorization).toBeUndefined();
  });

  it("sends ElevenLabs requests to another base URL", async () => {
    const eleven = fakeFetch(() => ({ body: MP3, type: "audio/mpeg" }));
    await generateSpeechAudio(
      {
        provider: "elevenlabs",
        apiKey: "el-secret",
        model: "eleven_flash_v2_5",
        baseUrl: "https://proxy.example.com/el/",
      },
      { text: "Hi." },
      { fetch: eleven.fetch },
    );
    expect(eleven.calls[0]!.url).toStartWith(
      "https://proxy.example.com/el/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM",
    );
  });

  it("reports a refused key without the key", async () => {
    const refused = fakeFetch(() => ({
      status: 401,
      body: { detail: { status: "invalid_api_key", message: "Invalid API key el-secret" } },
    }));
    const error = await generateSpeechAudio(
      { provider: "elevenlabs", apiKey: "el-secret", model: "eleven_multilingual_v2" },
      { text: "x" },
      { fetch: refused.fetch },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain("el-secret");
  });

  it("knows where every provider's key comes from", () => {
    for (const p of SPEECH_PROVIDERS)
      expect(SPEECH_PROVIDER_INFO[p].keyUrl).toStartWith("https://");
    expect(SPEECH_PROVIDER_INFO.elevenlabs.package).toBe("@ai-sdk/elevenlabs");
  });
});

describe("listVoices", () => {
  it("gives OpenAI's documented voices, nine for tts-1", async () => {
    const all = await listVoices({ provider: "openai", apiKey: "k", model: "gpt-4o-mini-tts" });
    expect(all?.map((v) => v.id)).toContain("marin");
    expect(all).toHaveLength(13);
    const legacy = await listVoices({ provider: "openai", apiKey: "k", model: "tts-1-hd" });
    expect(legacy).toHaveLength(9);
    expect(legacy?.map((v) => v.id)).not.toContain("ballad");
  });

  it("gives Gemini's 30 prebuilt voices", async () => {
    const voices = await listVoices({
      provider: "google",
      apiKey: "k",
      model: "gemini-2.5-flash-preview-tts",
    });
    expect(voices).toHaveLength(30);
    expect(voices?.[0]).toEqual({ id: "Zephyr", name: "Zephyr", description: "Bright" });
  });

  it("asks ElevenLabs for the account's voices, page after page", async () => {
    const eleven = fakeFetch((url) =>
      url.includes("next_page_token")
        ? {
            body: {
              voices: [
                {
                  voice_id: "v2",
                  name: "Rachel",
                  labels: {},
                  verified_languages: [{ language: "en" }],
                },
              ],
              has_more: false,
              next_page_token: null,
            },
          }
        : {
            body: {
              voices: [
                {
                  voice_id: "v1",
                  name: "Aria",
                  description: "Warm narrator",
                  labels: { gender: "female", accent: "american" },
                },
              ],
              has_more: true,
              next_page_token: "t1",
            },
          },
    );
    const voices = await listVoices(
      { provider: "elevenlabs", apiKey: "el-secret", model: "eleven_multilingual_v2" },
      { fetch: eleven.fetch },
    );
    expect(voices).toEqual([
      { id: "v1", name: "Aria", gender: "female", description: "Warm narrator" },
      { id: "v2", name: "Rachel", language: "en" },
    ]);
    expect(eleven.calls[0]).toMatchObject({
      url: "https://api.elevenlabs.io/v2/voices?page_size=100",
      headers: { "xi-api-key": "el-secret" },
    });
    expect(eleven.calls[1]!.url).toBe(
      "https://api.elevenlabs.io/v2/voices?page_size=100&next_page_token=t1",
    );
  });

  it("says when ElevenLabs refuses the key", async () => {
    const refused = fakeFetch(() => ({ status: 401, body: {} }));
    await expect(
      listVoices(
        { provider: "elevenlabs", apiKey: "el-secret", model: "eleven_v3" },
        { fetch: refused.fetch },
      ),
    ).rejects.toThrow("ElevenLabs refused the key.");
  });

  it("follows the maker of a Gateway model, and has no list for the others", async () => {
    expect(
      await listVoices({ provider: "gateway", apiKey: "k", model: "openai/tts-1" }),
    ).toHaveLength(9);
    expect(
      await listVoices({ provider: "gateway", apiKey: "k", model: "google/gemini-3.8-flash-tts" }),
    ).toHaveLength(30);
    expect(
      await listVoices({ provider: "gateway", apiKey: "k", model: "elevenlabs/eleven-v3" }),
    ).toBeNull();
    expect(await listVoices({ provider: "fal", apiKey: "k", model: "fal-ai/dia-tts" })).toBeNull();
  });
});

describe("testMediaKey", () => {
  const cases: [string, string, Record<string, string>][] = [
    ["openrouter", "https://openrouter.ai/api/v1/key", { authorization: "Bearer key-1234" }],
    ["gateway", "https://ai-gateway.vercel.sh/v1/credits", { authorization: "Bearer key-1234" }],
    [
      "fal",
      "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fveo3",
      { authorization: "Key key-1234" },
    ],
    ["openai", "https://api.openai.com/v1/models", { authorization: "Bearer key-1234" }],
    [
      "google",
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
      { "x-goog-api-key": "key-1234" },
    ],
    ["xai", "https://api.x.ai/v1/api-key", { authorization: "Bearer key-1234" }],
    ["replicate", "https://api.replicate.com/v1/account", { authorization: "Bearer key-1234" }],
    ["elevenlabs", "https://api.elevenlabs.io/v1/user", { "xi-api-key": "key-1234" }],
  ];

  for (const [provider, url, headers] of cases) {
    it(`asks ${provider} a free question, the key only in a header`, async () => {
      const ok = fakeFetch(() => ({ body: {} }));
      const report = await testMediaKey({ provider, apiKey: "key-1234" }, { fetch: ok.fetch });
      expect(report.ok).toBe(true);
      expect(report.message).toEndWith("accepts the key.");
      expect(ok.calls[0]).toMatchObject({ url, method: "GET", headers });
      expect(ok.calls[0]!.url).not.toContain("key-1234");
    });
  }

  it("tells a refused key from a provider that is down, and an unknown provider", async () => {
    const refused = fakeFetch(() => ({ status: 401, body: {} }));
    expect(
      await testSpeechKey({ provider: "elevenlabs", apiKey: "k" }, { fetch: refused.fetch }),
    ).toEqual({ ok: false, message: "ElevenLabs refused the key." });
    const badGoogle = fakeFetch(() => ({ status: 400, body: {} }));
    expect(
      (await testImageKey({ provider: "google", apiKey: "k" }, { fetch: badGoogle.fetch })).message,
    ).toBe("Google (Gemini API) refused the key.");
    const down = fakeFetch(() => ({ status: 503, body: {} }));
    expect(
      (await testImageKey({ provider: "openai", apiKey: "k" }, { fetch: down.fetch })).message,
    ).toContain("503");
    expect(await testMediaKey({ provider: "nope", apiKey: "k" })).toMatchObject({ ok: false });
  });
});
