import { describe, expect, it } from "bun:test";
import type { FetchLike } from "../fetch";
import {
  checkVideo,
  downloadVideo,
  startVideo,
  testVideoKey,
  VIDEO_PROVIDER_INFO,
  VIDEO_PROVIDERS,
  videoCallOptions,
} from "../video";
import { resolutionName } from "../video-openrouter";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A fetch that answers by URL and records each request (headers lower-cased). */
function fakeFetch(route: (url: string, method: string) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({
      url,
      method,
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const answer = route(url, method);
    return new Response(
      typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body),
      {
        status: answer.status ?? 200,
        headers: {
          "content-type": typeof answer.body === "string" ? "video/mp4" : "application/json",
        },
      },
    );
  };
  return { fetch, calls };
}

describe("OpenRouter video jobs", () => {
  const settings = {
    provider: "openrouter" as const,
    apiKey: "or-secret",
    model: "kwaivgi/kling-v3.0-pro",
  };

  it("starts a job with OpenRouter's own field names, and answers at once", async () => {
    const or = fakeFetch(() => ({
      body: { id: "job-1", status: "pending", polling_url: "/api/v1/videos/job-1" },
    }));
    const job = await startVideo(
      settings,
      {
        prompt: "Dawn over a harbour.",
        aspectRatio: "9:16",
        resolution: "720p",
        durationS: 5,
        audio: true,
      },
      { fetch: or.fetch },
    );
    expect(job).toEqual({
      provider: "openrouter",
      model: settings.model,
      operation: { id: "job-1" },
      warnings: [],
    });
    expect(or.calls).toHaveLength(1);
    expect(or.calls[0]).toMatchObject({
      url: "https://openrouter.ai/api/v1/videos",
      method: "POST",
      headers: { authorization: "Bearer or-secret" },
      body: {
        model: "kwaivgi/kling-v3.0-pro",
        prompt: "Dawn over a harbour.",
        duration: 5,
        resolution: "720p",
        aspect_ratio: "9:16",
        generate_audio: true,
      },
    });
  });

  it("checks a stored job: pending, then the video with its cost, the key only on OpenRouter's own URL", async () => {
    let done = false;
    const or = fakeFetch(() => ({
      body: done
        ? { id: "job-1", status: "completed", usage: { cost: 0.84 } }
        : { id: "job-1", status: "in_progress" },
    }));
    expect(await checkVideo(settings, { operation: { id: "job-1" } }, { fetch: or.fetch })).toEqual(
      {
        status: "pending",
      },
    );
    done = true;
    expect(await checkVideo(settings, { operation: { id: "job-1" } }, { fetch: or.fetch })).toEqual(
      {
        status: "completed",
        costUsd: 0.84,
        videos: [
          {
            url: "https://openrouter.ai/api/v1/videos/job-1/content?index=0",
            mediaType: "video/mp4",
            headers: { authorization: "Bearer or-secret" },
          },
        ],
      },
    );
    expect(or.calls[0]!.url).toBe("https://openrouter.ai/api/v1/videos/job-1");
  });

  it("reports a failed job, and a refused start without the key", async () => {
    const failed = fakeFetch(() => ({
      body: { id: "job-1", status: "failed", error: "Content policy." },
    }));
    expect(
      await checkVideo(settings, { operation: { id: "job-1" } }, { fetch: failed.fetch }),
    ).toEqual({
      status: "error",
      message: "Content policy.",
    });
    const refused = fakeFetch(() => ({
      status: 401,
      body: { error: { message: "Invalid key or-secret" } },
    }));
    const error = await startVideo(settings, { prompt: "x" }, { fetch: refused.fetch }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain("or-secret");
  });

  it("names a resolution the way OpenRouter does", () => {
    expect(resolutionName("1280x720")).toBe("720p");
    expect(resolutionName("2160x3840")).toBe("4K");
    expect(resolutionName("4k")).toBe("4K");
    expect(resolutionName("768p")).toBe("768p");
  });
});

describe("AI SDK video providers", () => {
  it("starts an xAI job through its SDK, the resolution in xAI's options", async () => {
    const xai = fakeFetch(() => ({ body: { request_id: "req-9" } }));
    const job = await startVideo(
      { provider: "xai", apiKey: "xai-secret", model: "grok-imagine-video-1.5" },
      { prompt: "A fox in snow.", aspectRatio: "16:9", resolution: "720p", durationS: 6 },
      { fetch: xai.fetch },
    );
    expect(job.operation).toMatchObject({ requestId: "req-9" });
    expect(xai.calls[0]).toMatchObject({
      url: "https://api.x.ai/v1/videos/generations",
      headers: { authorization: "Bearer xai-secret" },
      body: {
        model: "grok-imagine-video-1.5",
        prompt: "A fox in snow.",
        duration: 6,
        resolution: "720p",
      },
    });
  });

  it("checks an xAI job through its SDK", async () => {
    const xai = fakeFetch(() => ({
      body: {
        status: "done",
        video: { url: "https://vidgen.x.ai/v.mp4", respect_moderation: true },
      },
    }));
    const status = await checkVideo(
      { provider: "xai", apiKey: "xai-secret", model: "grok-imagine-video-1.5" },
      { operation: { requestId: "req-9" } },
      { fetch: xai.fetch },
    );
    expect(status).toMatchObject({
      status: "completed",
      videos: [{ url: "https://vidgen.x.ai/v.mp4" }],
    });
    expect(xai.calls[0]!.url).toBe("https://api.x.ai/v1/videos/req-9");
  });

  it("moves Google's key out of the video URL into a header", async () => {
    const google = fakeFetch(() => ({
      body: {
        name: "models/veo-3.1-fast-generate-preview/operations/op-1",
        done: true,
        response: {
          generateVideoResponse: {
            generatedSamples: [
              {
                video: {
                  uri: "https://generativelanguage.googleapis.com/v1beta/files/f1:download?alt=media",
                },
              },
            ],
          },
        },
      },
    }));
    const status = await checkVideo(
      { provider: "google", apiKey: "g-secret", model: "veo-3.1-fast-generate-preview" },
      { operation: { operationName: "models/veo-3.1-fast-generate-preview/operations/op-1" } },
      { fetch: google.fetch },
    );
    expect(status.status).toBe("completed");
    const video = (status as { videos: { url: string; headers?: Record<string, string> }[] })
      .videos[0];
    expect(video?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/files/f1:download?alt=media",
    );
    expect(video?.headers).toEqual({ "x-goog-api-key": "g-secret" });
  });

  it("sizes the resolution for the Gateway and names it for the others", () => {
    const request = { prompt: "x", aspectRatio: "9:16", resolution: "1080p" };
    expect(videoCallOptions("gateway", request).resolution).toBe("1080x1920");
    expect(videoCallOptions("google", request).resolution).toBe("1080p" as never);
    const fal = videoCallOptions("fal", {
      ...request,
      providerOptions: { fal: { negative_prompt: "blur" } },
    });
    expect(fal.resolution).toBeUndefined();
    expect(fal.providerOptions).toEqual({ fal: { resolution: "1080p", negative_prompt: "blur" } });
  });

  it("knows where every provider's key comes from", () => {
    for (const p of VIDEO_PROVIDERS) expect(VIDEO_PROVIDER_INFO[p].keyUrl).toStartWith("https://");
  });
});

describe("testVideoKey", () => {
  it("asks each provider a free question with the key in a header", async () => {
    const ok = fakeFetch(() => ({ body: {} }));
    expect(
      await testVideoKey({ provider: "replicate", apiKey: "r8" }, { fetch: ok.fetch }),
    ).toEqual({
      ok: true,
      message: "Replicate accepts the key.",
    });
    expect(ok.calls[0]).toMatchObject({
      url: "https://api.replicate.com/v1/account",
      headers: { authorization: "Bearer r8" },
    });
    await testVideoKey({ provider: "google", apiKey: "g" }, { fetch: ok.fetch });
    expect(ok.calls[1]!.url).not.toContain("g&");
    expect(ok.calls[1]!.headers["x-goog-api-key"]).toBe("g");
  });

  it("tells a refused key from a provider that is down or unreachable", async () => {
    const refused = fakeFetch(() => ({ status: 401, body: {} }));
    expect(
      (await testVideoKey({ provider: "fal", apiKey: "k" }, { fetch: refused.fetch })).message,
    ).toBe("fal.ai refused the key.");
    const down = fakeFetch(() => ({ status: 503, body: {} }));
    expect(
      (await testVideoKey({ provider: "xai", apiKey: "k" }, { fetch: down.fetch })).message,
    ).toContain("503");
    const offline: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    expect(
      await testVideoKey({ provider: "gateway", apiKey: "k" }, { fetch: offline }),
    ).toMatchObject({ ok: false });
  });
});

describe("downloadVideo", () => {
  it("downloads a URL with the headers it needs, and passes bytes through", async () => {
    const files = fakeFetch(() => ({ body: "MP4" }));
    const got = await downloadVideo(
      {
        url: "https://openrouter.ai/api/v1/videos/j/content?index=0",
        mediaType: "video/mp4",
        headers: { authorization: "Bearer k" },
      },
      { fetch: files.fetch },
    );
    expect(new TextDecoder().decode(got.data)).toBe("MP4");
    expect(files.calls[0]!.headers.authorization).toBe("Bearer k");
    const bytes = new Uint8Array([1, 2]);
    expect((await downloadVideo({ data: bytes, mediaType: "video/mp4" })).data).toBe(bytes);
  });
});
