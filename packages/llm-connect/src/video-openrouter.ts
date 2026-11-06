// OpenRouter's video API as an AI SDK video model with the start/status flow:
// `POST /videos` answers a job id at once, `GET /videos/{id}` says where it
// stands. (@openrouter/ai-sdk-provider only polls inside doGenerate, so a job
// would not survive the process that started it.)
// https://openrouter.ai/docs/cookbook/video-generation/text-to-video

import type {
  JSONValue,
  Experimental_VideoModelV4 as VideoModelV4,
  Experimental_VideoModelV4CallOptions as VideoModelV4CallOptions,
  Experimental_VideoModelV4OperationStatusResult as VideoModelV4OperationStatusResult,
} from "@ai-sdk/provider";
import type { FetchLike } from "./fetch.js";

export const OPENROUTER_API = "https://openrouter.ai/api/v1";

/** The resolution name OpenRouter takes ("720p", "4K"), from a name or a `WxH` size (its short side). */
export function resolutionName(size: string | undefined): string | undefined {
  if (!size) return undefined;
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m) return size.replace(/k$/, "K");
  const short = Math.min(Number(m[1]), Number(m[2]));
  if (short >= 2160) return "4K";
  if (short >= 1440) return "2K";
  return `${short}p`;
}

interface Job {
  id: string;
  status?: string;
  polling_url?: string;
  unsigned_urls?: string[];
  usage?: { cost?: number };
  error?: string;
}

async function readJob(response: Response, url: string): Promise<Job> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: reported below with the status.
  }
  if (!response.ok) {
    const message =
      (body as { error?: { message?: string } | string } | null)?.error ?? text.slice(0, 300);
    const error = new Error(
      typeof message === "string" ? message : (message?.message ?? `HTTP ${response.status}`),
    ) as Error & { statusCode: number; url: string };
    error.statusCode = response.status;
    error.url = url;
    throw error;
  }
  const job = body as Job | null;
  if (!job || typeof job.id !== "string")
    throw new Error("OpenRouter answered a video job without an id.");
  return job;
}

const response = (modelId: string) => ({ timestamp: new Date(), modelId, headers: undefined });

export function createOpenRouterVideoModel(config: {
  apiKey: string;
  modelId: string;
  baseUrl?: string;
  fetch?: FetchLike;
}): VideoModelV4 {
  const base = (config.baseUrl ?? OPENROUTER_API).replace(/\/+$/, "");
  const doFetch: FetchLike = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const auth = { authorization: `Bearer ${config.apiKey}` };

  return {
    specificationVersion: "v4",
    provider: "openrouter",
    modelId: config.modelId,
    maxVideosPerCall: 1,

    async doStart(options: VideoModelV4CallOptions) {
      const extra = (options.providerOptions?.openrouter ?? {}) as Record<string, JSONValue>;
      const image = options.frameImages?.length
        ? options.frameImages
        : options.image
          ? [{ image: options.image, frameType: "first_frame" as const }]
          : [];
      const frames = image.flatMap((f) =>
        f.image.type === "url"
          ? [{ type: "image_url", image_url: { url: f.image.url }, frame_type: f.frameType }]
          : [],
      );
      const body = {
        model: config.modelId,
        prompt: options.prompt ?? "",
        ...(options.duration !== undefined ? { duration: options.duration } : {}),
        ...(options.resolution !== undefined
          ? { resolution: resolutionName(options.resolution) }
          : {}),
        ...(options.aspectRatio !== undefined && options.aspectRatio !== "adaptive"
          ? { aspect_ratio: options.aspectRatio }
          : {}),
        ...(options.generateAudio !== undefined ? { generate_audio: options.generateAudio } : {}),
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
        ...(frames.length ? { frame_images: frames } : {}),
        ...extra,
      };
      const url = `${base}/videos`;
      const job = await readJob(
        await doFetch(url, {
          method: "POST",
          headers: {
            ...auth,
            "content-type": "application/json",
            ...cleanHeaders(options.headers),
          },
          body: JSON.stringify(body),
          signal: options.abortSignal,
        }),
        url,
      );
      return { operation: { id: job.id }, warnings: [], response: response(config.modelId) };
    },

    async doStatus(options: {
      operation: JSONValue;
      abortSignal?: AbortSignal;
      headers?: Record<string, string | undefined>;
    }): Promise<VideoModelV4OperationStatusResult> {
      const id = (options.operation as { id?: unknown } | null)?.id;
      if (typeof id !== "string") throw new Error("Not an OpenRouter video job.");
      const url = `${base}/videos/${encodeURIComponent(id)}`;
      const job = await readJob(
        await doFetch(url, {
          headers: { ...auth, ...cleanHeaders(options.headers) },
          signal: options.abortSignal,
        }),
        url,
      );
      const metadata = {
        openrouter: { jobId: id, ...(job.usage?.cost != null ? { cost: job.usage.cost } : {}) },
      };
      if (job.status === "completed") {
        const urls = job.unsigned_urls?.length ? job.unsigned_urls : [`${url}/content?index=0`];
        return {
          status: "completed",
          videos: urls.map((u) => ({ type: "url" as const, url: u, mediaType: "video/mp4" })),
          warnings: [],
          providerMetadata: metadata,
          response: response(config.modelId),
        };
      }
      if (job.status && ["failed", "cancelled", "expired", "dead"].includes(job.status)) {
        return {
          status: "error",
          error: job.error ?? `The video job ended ${job.status}.`,
          providerMetadata: metadata,
          response: response(config.modelId),
        } as VideoModelV4OperationStatusResult;
      }
      return { status: "pending", providerMetadata: metadata, response: response(config.modelId) };
    },
  } as VideoModelV4;
}

function cleanHeaders(
  headers: Record<string, string | undefined> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter((e): e is [string, string] => e[1] !== undefined),
  );
}
