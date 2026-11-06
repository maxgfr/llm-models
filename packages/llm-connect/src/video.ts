// Render video with any provider llm-models lists (`listVideoModels`), through
// the AI SDK's start/status flow: `startVideo` answers at once with a job a
// server can store, `checkVideo` asks where it stands, from any process, as
// often as the app likes. Entry `llm-connect/video`.

import type { JSONValue, Experimental_VideoModelV4 as VideoModelV4 } from "@ai-sdk/provider";
import { type VideoProviderId, videoSize } from "llm-models/video";
import { describeError, scrubSecret } from "./errors.js";
import type { FetchLike } from "./fetch.js";
import { createOpenRouterVideoModel, OPENROUTER_API } from "./video-openrouter.js";

export type { VideoProviderId } from "llm-models/video";
export { VIDEO_PROVIDERS } from "llm-models/video";

/** Where a provider's key comes from, and what calls it. */
export interface VideoProviderInfo {
  name: string;
  /** The page that issues a key. */
  keyUrl: string;
  /** The environment variable its SDK reads by convention. */
  env: string;
  /** The package `loadVideoModel` imports (`null`: built into llm-connect). */
  package: string | null;
}

export const VIDEO_PROVIDER_INFO: Readonly<Record<VideoProviderId, VideoProviderInfo>> = {
  openrouter: {
    name: "OpenRouter",
    keyUrl: "https://openrouter.ai/settings/keys",
    env: "OPENROUTER_API_KEY",
    package: null,
  },
  gateway: {
    name: "Vercel AI Gateway",
    keyUrl: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys",
    env: "AI_GATEWAY_API_KEY",
    package: "@ai-sdk/gateway",
  },
  fal: {
    name: "fal.ai",
    keyUrl: "https://fal.ai/dashboard/keys",
    env: "FAL_KEY",
    package: "@ai-sdk/fal",
  },
  google: {
    name: "Google (Gemini API)",
    keyUrl: "https://aistudio.google.com/apikey",
    env: "GEMINI_API_KEY",
    package: "@ai-sdk/google",
  },
  xai: { name: "xAI", keyUrl: "https://console.x.ai", env: "XAI_API_KEY", package: "@ai-sdk/xai" },
  replicate: {
    name: "Replicate",
    keyUrl: "https://replicate.com/account/api-tokens",
    env: "REPLICATE_API_TOKEN",
    package: "@ai-sdk/replicate",
  },
};

/** Which provider, which key, which model (the id `listVideoModels` gives). */
export interface VideoSettings {
  provider: VideoProviderId;
  apiKey: string;
  model: string;
  /** Another base URL for the provider's API (a proxy). */
  baseUrl?: string;
}

export interface VideoOptions {
  /** The fetch every request goes through. Default `globalThis.fetch`. */
  fetch?: FetchLike;
  abortSignal?: AbortSignal;
}

/** One render, in the words llm-models lists a model's settings with. */
export interface VideoRequest {
  prompt: string;
  /** `W:H`, one of the model's `aspectRatios`. */
  aspectRatio?: string;
  /** One of the model's `resolutions` ("720p", "1080p", "4k"). */
  resolution?: string;
  /** Seconds, one of the model's `durations`. */
  durationS?: number;
  /** Render sound, for a model that offers the choice. */
  audio?: boolean;
  seed?: number;
  /** The first frame, for image-to-video. */
  image?: { url: string } | { data: Uint8Array; mediaType: string };
  /** Body fields for one provider, by provider id: `{ fal: { negative_prompt: "…" } }`. */
  providerOptions?: Record<string, Record<string, JSONValue>>;
}

/** A started render: store it (it is plain JSON) and pass it to `checkVideo`. */
export interface VideoJob {
  provider: VideoProviderId;
  model: string;
  /** The provider's own reference to the job, opaque. */
  operation: JSONValue;
  /** What the provider will not do as asked (a setting it ignored). */
  warnings: string[];
}

/** A finished video: a URL to download (with `headers` when it needs the key), or the bytes. */
export type VideoOutput =
  | { url: string; mediaType: string; headers?: Record<string, string> }
  | { data: Uint8Array; mediaType: string };

export type VideoStatus =
  | { status: "pending" }
  | { status: "completed"; videos: VideoOutput[]; costUsd?: number }
  | { status: "error"; message: string };

type VideoProvider = { video(modelId: string): VideoModelV4 };

/** The provider's AI SDK video model, its package imported on demand. */
export async function loadVideoModel(
  settings: VideoSettings,
  options: VideoOptions = {},
): Promise<VideoModelV4> {
  const { apiKey, model, baseUrl } = settings;
  const common = {
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    ...(options.fetch ? { fetch: options.fetch as typeof fetch } : {}),
  };
  const missing = (pkg: string) => (error: unknown) => {
    throw new Error(
      `Rendering with ${settings.provider} needs the ${pkg} package (npm install ${pkg}).`,
      {
        cause: error,
      },
    );
  };
  switch (settings.provider) {
    case "openrouter":
      return createOpenRouterVideoModel({ apiKey, modelId: model, baseUrl, fetch: options.fetch });
    case "gateway": {
      const { createGateway } = await import("@ai-sdk/gateway").catch(missing("@ai-sdk/gateway"));
      return (createGateway({ apiKey, ...common }) as unknown as VideoProvider).video(model);
    }
    case "fal": {
      const { createFal } = await import("@ai-sdk/fal").catch(missing("@ai-sdk/fal"));
      return (createFal({ apiKey, ...common }) as unknown as VideoProvider).video(model);
    }
    case "google": {
      const { createGoogle } = await import("@ai-sdk/google").catch(missing("@ai-sdk/google"));
      return (createGoogle({ apiKey, ...common }) as unknown as VideoProvider).video(model);
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai").catch(missing("@ai-sdk/xai"));
      return (createXai({ apiKey, ...common }) as unknown as VideoProvider).video(model);
    }
    case "replicate": {
      const { createReplicate } = await import("@ai-sdk/replicate").catch(
        missing("@ai-sdk/replicate"),
      );
      return (createReplicate({ apiToken: apiKey, ...common }) as unknown as VideoProvider).video(
        model,
      );
    }
    default:
      throw new Error(`Unknown video provider "${String(settings.provider)}".`);
  }
}

type Size = `${number}x${number}`;

/**
 * The AI SDK's call options for a request. Each provider takes the resolution
 * its own way: as a `WxH` size (the Gateway), by its name (Google, OpenRouter),
 * or by its name in the provider's options (fal, xAI, Replicate).
 */
export function videoCallOptions(provider: VideoProviderId, request: VideoRequest) {
  const providerOptions: Record<string, Record<string, JSONValue>> = {
    ...(request.providerOptions ?? {}),
  };
  let resolution: Size | undefined;
  if (request.resolution) {
    const size = request.aspectRatio ? videoSize(request.resolution, request.aspectRatio) : null;
    if (provider === "gateway") resolution = size ?? undefined;
    else if (provider === "google" || provider === "openrouter")
      resolution = request.resolution as Size;
    else
      providerOptions[provider] = {
        resolution: request.resolution,
        ...(providerOptions[provider] ?? {}),
      };
  }
  return {
    prompt: request.prompt,
    n: 1,
    aspectRatio: request.aspectRatio as `${number}:${number}` | undefined,
    resolution,
    duration: request.durationS,
    fps: undefined,
    seed: request.seed,
    image: request.image
      ? "url" in request.image
        ? { type: "url" as const, url: request.image.url }
        : { type: "file" as const, data: request.image.data, mediaType: request.image.mediaType }
      : undefined,
    frameImages: undefined,
    inputReferences: undefined,
    generateAudio: request.audio,
    providerOptions,
  };
}

/** The message of a failed call, the key scrubbed from it. */
function failure(error: unknown, apiKey: string): Error {
  const described = describeError(error, apiKey);
  const message = described.message || (error instanceof Error ? error.message : String(error));
  return Object.assign(new Error(scrubSecret(message, apiKey)), {
    code: described.code,
    status: described.status,
  });
}

/** Start a render. Answers as soon as the provider has the job; nothing waits for the video. */
export async function startVideo(
  settings: VideoSettings,
  request: VideoRequest,
  options: VideoOptions = {},
): Promise<VideoJob> {
  const model = await loadVideoModel(settings, options);
  if (!model.doStart)
    throw new Error(`${settings.provider} cannot start "${settings.model}" as a job.`);
  try {
    const started = await model.doStart({
      ...videoCallOptions(settings.provider, request),
      abortSignal: options.abortSignal,
    } as Parameters<NonNullable<VideoModelV4["doStart"]>>[0]);
    return {
      provider: settings.provider,
      model: settings.model,
      operation: started.operation,
      warnings: started.warnings.map((w) =>
        "details" in w && w.details
          ? `${(w as { feature?: string }).feature ?? "setting"}: ${w.details}`
          : w.type,
      ),
    };
  } catch (error) {
    throw failure(error, settings.apiKey);
  }
}

/** Where a render stands: one request to the provider, no waiting. */
export async function checkVideo(
  settings: VideoSettings,
  job: Pick<VideoJob, "operation">,
  options: VideoOptions = {},
): Promise<VideoStatus> {
  const model = await loadVideoModel(settings, options);
  if (!model.doStatus)
    throw new Error(`${settings.provider} cannot check a job of "${settings.model}".`);
  let result: Awaited<ReturnType<NonNullable<VideoModelV4["doStatus"]>>>;
  try {
    result = await model.doStatus({ operation: job.operation, abortSignal: options.abortSignal });
  } catch (error) {
    throw failure(error, settings.apiKey);
  }
  if (result.status === "pending") return { status: "pending" };
  if (result.status === "error")
    return { status: "error", message: scrubSecret(result.error, settings.apiKey) };
  const cost = (result.providerMetadata?.[settings.provider] as { cost?: unknown } | undefined)
    ?.cost;
  const videos: VideoOutput[] = result.videos.map((v) => {
    if (v.type === "url") return keyedUrl(settings, v.url, v.mediaType);
    const data =
      v.type === "base64" ? Uint8Array.from(atob(v.data), (c) => c.charCodeAt(0)) : v.data;
    return { data, mediaType: v.mediaType };
  });
  return { status: "completed", videos, ...(typeof cost === "number" ? { costUsd: cost } : {}) };
}

/**
 * A video URL that never carries the key: Google's SDK appends `?key=` to its
 * download URL, which would end up wherever the app stores or logs it; it goes
 * in a header instead. OpenRouter's content endpoint needs the key too; a
 * signed URL needs none.
 */
function keyedUrl(settings: VideoSettings, raw: string, mediaType: string): VideoOutput {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { url: raw, mediaType };
  }
  if (settings.provider === "google" && url.searchParams.has("key")) {
    url.searchParams.delete("key");
    return { url: url.toString(), mediaType, headers: { "x-goog-api-key": settings.apiKey } };
  }
  const base = (settings.baseUrl ?? OPENROUTER_API).replace(/\/+$/, "");
  if (settings.provider === "openrouter" && raw.startsWith(base))
    return { url: raw, mediaType, headers: { authorization: `Bearer ${settings.apiKey}` } };
  return { url: raw, mediaType };
}

/** A key check that renders nothing: one free request per provider. */
const KEY_CHECKS: Record<
  VideoProviderId,
  (key: string) => { url: string; headers: Record<string, string> }
> = {
  openrouter: (key) => ({
    url: `${OPENROUTER_API}/key`,
    headers: { authorization: `Bearer ${key}` },
  }),
  gateway: (key) => ({
    url: "https://ai-gateway.vercel.sh/v1/credits",
    headers: { authorization: `Bearer ${key}` },
  }),
  fal: (key) => ({
    url: "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fveo3",
    headers: { authorization: `Key ${key}` },
  }),
  google: (key) => ({
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    headers: { "x-goog-api-key": key },
  }),
  xai: (key) => ({
    url: "https://api.x.ai/v1/api-key",
    headers: { authorization: `Bearer ${key}` },
  }),
  replicate: (key) => ({
    url: "https://api.replicate.com/v1/account",
    headers: { authorization: `Bearer ${key}` },
  }),
};

export interface VideoKeyReport {
  /** true: the key works; false: refused or unreachable. */
  ok: boolean;
  message: string;
}

/** Whether the provider takes the key, without rendering (and so without cost). */
export async function testVideoKey(
  settings: Pick<VideoSettings, "provider" | "apiKey">,
  options: VideoOptions = {},
): Promise<VideoKeyReport> {
  const name = VIDEO_PROVIDER_INFO[settings.provider].name;
  const check = KEY_CHECKS[settings.provider](settings.apiKey);
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  let res: Response;
  try {
    res = await doFetch(check.url, {
      headers: check.headers,
      signal: options.abortSignal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, message: `${name} could not be reached. Check the network and try again.` };
  }
  if (res.ok) return { ok: true, message: `${name} accepts the key.` };
  if (
    res.status === 401 ||
    res.status === 403 ||
    (settings.provider === "google" && res.status === 400)
  )
    return { ok: false, message: `${name} refused the key.` };
  return { ok: false, message: `${name} answered HTTP ${res.status}. Try again in a moment.` };
}

/** The bytes of a finished video, fetched when it is a URL. */
export async function downloadVideo(
  output: VideoOutput,
  options: VideoOptions = {},
): Promise<{ data: Uint8Array; mediaType: string }> {
  if ("data" in output) return output;
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const res = await doFetch(output.url, {
    headers: output.headers ?? {},
    signal: options.abortSignal,
  });
  if (!res.ok) throw new Error(`The video could not be downloaded (HTTP ${res.status}).`);
  return {
    data: new Uint8Array(await res.arrayBuffer()),
    mediaType: res.headers.get("content-type") ?? output.mediaType,
  };
}
