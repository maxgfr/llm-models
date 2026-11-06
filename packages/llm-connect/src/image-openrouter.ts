// OpenRouter's image generation as an AI SDK image model. Its Image API
// (`POST /images`, https://openrouter.ai/docs/api/api-reference/images/generate-an-image)
// answers base64 images and the cost; a model it does not serve (404) is asked
// through chat completions with `modalities: ["image", "text"]` instead, which
// answers the images as data URLs in `choices[0].message.images`.

import type { ImageModelV4, ImageModelV4CallOptions, JSONValue } from "@ai-sdk/provider";
import type { FetchLike } from "./fetch.js";
import { OPENROUTER_API } from "./video-openrouter.js";

type HttpError = Error & { statusCode: number; url: string; responseBody: string };

async function readJson(response: Response, url: string): Promise<unknown> {
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
    ) as HttpError;
    error.statusCode = response.status;
    error.url = url;
    error.responseBody = text;
    throw error;
  }
  return body;
}

/** The base64 data of a `data:` URL, or null for anything else. */
function base64Of(url: string): string | null {
  const m = /^data:[^;,]*;base64,(.*)$/s.exec(url);
  return m ? m[1]!.replace(/\s+/g, "") : null;
}

interface ImagesAnswer {
  data?: { b64_json?: string; media_type?: string }[];
  usage?: { cost?: number | null };
}

interface ChatAnswer {
  choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
  usage?: { cost?: number | null };
}

export function createOpenRouterImageModel(config: {
  apiKey: string;
  modelId: string;
  baseUrl?: string;
  fetch?: FetchLike;
}): ImageModelV4 {
  const base = (config.baseUrl ?? OPENROUTER_API).replace(/\/+$/, "");
  const doFetch: FetchLike = config.fetch ?? ((input, init) => globalThis.fetch(input, init));

  const post = async (path: string, body: unknown, options: ImageModelV4CallOptions) => {
    const url = `${base}${path}`;
    return readJson(
      await doFetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
          ...cleanHeaders(options.headers),
        },
        body: JSON.stringify(body),
        signal: options.abortSignal,
      }),
      url,
    );
  };

  return {
    specificationVersion: "v4",
    provider: "openrouter",
    modelId: config.modelId,
    // `n` is only an upper bound at OpenRouter, and single-image providers refuse n > 1:
    // one image a call, so asking for n gets n.
    maxImagesPerCall: 1,

    async doGenerate(options: ImageModelV4CallOptions) {
      const extra = (options.providerOptions?.openrouter ?? {}) as Record<string, JSONValue>;
      const aspectRatio = options.aspectRatio;
      let images: string[];
      let cost: number | null | undefined;
      try {
        const answer = (await post(
          "/images",
          {
            model: config.modelId,
            prompt: options.prompt ?? "",
            ...(options.n > 1 ? { n: options.n } : {}),
            ...(options.size !== undefined ? { size: options.size } : {}),
            ...(aspectRatio !== undefined ? { aspect_ratio: aspectRatio } : {}),
            ...(options.seed !== undefined ? { seed: options.seed } : {}),
            ...extra,
          },
          options,
        )) as ImagesAnswer | null;
        images = (answer?.data ?? []).flatMap((d) => (d.b64_json ? [d.b64_json] : []));
        cost = answer?.usage?.cost;
      } catch (error) {
        if ((error as Partial<HttpError>).statusCode !== 404) throw error;
        // Not on the Image API: the chat completions route generates its images.
        const answer = (await post(
          "/chat/completions",
          {
            model: config.modelId,
            messages: [{ role: "user", content: options.prompt ?? "" }],
            modalities: ["image", "text"],
            ...(aspectRatio !== undefined ? { image_config: { aspect_ratio: aspectRatio } } : {}),
            ...(options.seed !== undefined ? { seed: options.seed } : {}),
            ...extra,
          },
          options,
        )) as ChatAnswer | null;
        images = (answer?.choices?.[0]?.message?.images ?? []).flatMap((i) => {
          const data = i.image_url?.url ? base64Of(i.image_url.url) : null;
          return data ? [data] : [];
        });
        cost = answer?.usage?.cost;
      }
      return {
        images,
        warnings: [],
        providerMetadata: {
          openrouter: { images: images.map(() => ({})), ...(cost != null ? { cost } : {}) },
        },
        response: { timestamp: new Date(), modelId: config.modelId, headers: undefined },
      };
    },
  };
}

function cleanHeaders(
  headers: Record<string, string | undefined> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter((e): e is [string, string] => e[1] !== undefined),
  );
}
