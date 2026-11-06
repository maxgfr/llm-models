import type { FetchOptions } from "../clients/http";
import { fetchModelsDevModels } from "../clients/models-dev";
import {
  type FalModel,
  fetchFalModelSchema,
  fetchFalVideoModels,
  fetchGatewayVideoModels,
  fetchGoogleVideoModels,
  fetchOpenRouterVideoModels,
  fetchReplicateVideoModels,
  type GatewayVideoModel,
  type GoogleModel,
  type OpenRouterVideoModel,
  type ReplicateModel,
} from "../clients/video";
import { debug } from "../log";
import type { ModelsDevResponse } from "../types";
import {
  shortSide,
  VIDEO_OPERATIONS,
  VIDEO_PROVIDERS,
  type VideoModel,
  type VideoOperation,
  type VideoPrice,
  type VideoProviderId,
} from "../video";

const RATIO = /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/;
const DAY = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

const ratios = (list: readonly string[] | null | undefined) => {
  const kept = (list ?? []).filter((r) => RATIO.test(r));
  return kept.length ? kept : null;
};
const sortedResolutions = (list: readonly string[] | null | undefined) => {
  const names = [...new Set((list ?? []).map((r) => r.trim().toLowerCase()))].filter(Boolean);
  if (!names.length) return null;
  return names.sort((a, b) => (shortSide(a) ?? 1e9) - (shortSide(b) ?? 1e9));
};
const sortedDurations = (list: readonly number[] | null | undefined) => {
  const kept = [...new Set((list ?? []).filter((d) => Number.isFinite(d) && d > 0))].sort(
    (a, b) => a - b,
  );
  return kept.length ? kept : null;
};
const operationsOf = (list: readonly string[] | null | undefined): VideoOperation[] =>
  (list ?? []).filter((o): o is VideoOperation =>
    (VIDEO_OPERATIONS as readonly string[]).includes(o),
  );

/**
 * OpenRouter's pricing SKUs, as per-second prices: `duration_seconds_with_audio_4k`,
 * `cents_per_video_output_second_720p`, `text_to_video_duration_seconds_480p`. SKUs
 * billed another way (tokens, input images, megapixels, a minimum) are left out.
 */
export function openRouterPrices(
  skus: Record<string, string | number> | null | undefined,
): VideoPrice[] {
  const prices: VideoPrice[] = [];
  for (const [sku, raw] of Object.entries(skus ?? {})) {
    const name = sku.toLowerCase();
    if (!name.includes("second")) continue;
    if (/(input|reference|megapixel|minimum|token|image)/.test(name)) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const usdPerSecond = name.startsWith("cents_") ? value / 100 : value;
    const resolution = /_(\d{3,4}p|\dk)(?:_|$)/.exec(name)?.[1];
    const audio = name.includes("without_audio")
      ? false
      : name.includes("with_audio")
        ? true
        : undefined;
    prices.push({
      usdPerSecond,
      ...(resolution ? { resolution } : {}),
      ...(audio === undefined ? {} : { audio }),
    });
  }
  return prices;
}

export function fromOpenRouter(m: OpenRouterVideoModel): VideoModel {
  const frames = m.supported_frame_images ?? [];
  const operations: VideoOperation[] = [];
  if (m.supported_durations?.length) operations.push("text-to-video");
  if (frames.includes("first_frame")) operations.push("image-to-video");
  if (frames.includes("last_frame")) operations.push("first-last-frame");
  const name = m.name.replace(/^([^:]+):\s*/, "$1 ");
  return {
    provider: "openrouter",
    id: m.id,
    name,
    owner: m.id.split("/")[0] ?? "",
    ...(m.description ? { description: m.description } : {}),
    operations,
    inputs: frames.length ? ["text", "image"] : ["text"],
    durations: sortedDurations(m.supported_durations),
    aspectRatios: ratios(m.supported_aspect_ratios),
    resolutions: sortedResolutions(m.supported_resolutions),
    audio: m.generate_audio ?? null,
    seed: m.seed ?? null,
    frameImages: frames,
    prices: openRouterPrices(m.pricing_skus),
    ...(m.created ? { released: DAY(m.created) } : {}),
  };
}

export function fromGateway(m: GatewayVideoModel): VideoModel {
  const caps = m.video_capabilities ?? {};
  const operations = operationsOf(caps.supported_operations);
  const prices: VideoPrice[] = (m.pricing?.video_duration_pricing ?? []).flatMap((p) => {
    const usdPerSecond = Number(p.cost_per_second);
    if (!Number.isFinite(usdPerSecond)) return [];
    return [
      {
        usdPerSecond,
        ...(p.resolution ? { resolution: p.resolution.toLowerCase() } : {}),
        ...(typeof p.audio === "boolean" ? { audio: p.audio } : {}),
        ...(p.mode ? { mode: p.mode } : {}),
      },
    ];
  });
  const frameImages = [
    ...(operations.includes("image-to-video") ? ["first_frame"] : []),
    ...(operations.includes("first-last-frame") ? ["last_frame"] : []),
  ];
  const inputs = new Set(m.modalities?.input ?? []);
  if (operations.includes("text-to-video")) inputs.add("text");
  return {
    provider: "gateway",
    id: m.id,
    name: m.name,
    owner: m.owned_by ?? m.id.split("/")[0] ?? "",
    ...(m.description ? { description: m.description } : {}),
    operations,
    inputs: [...inputs],
    durations: sortedDurations(caps.supported_durations_seconds),
    aspectRatios: ratios(caps.supported_aspect_ratios),
    resolutions: sortedResolutions(caps.supported_resolutions),
    audio: caps.generate_audio ?? null,
    seed: null,
    frameImages,
    prices,
    ...(caps.input_limits?.text?.max_chars
      ? { maxPromptChars: caps.input_limits.text.max_chars }
      : {}),
    ...(m.released ? { released: DAY(m.released) } : {}),
  };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The input properties of an OpenAPI 3 schema (`$ref`s and `allOf` followed), and the required ones. */
function inputProperties(
  openapi: unknown,
): { props: Record<string, Json>; required: string[] } | null {
  if (!isObject(openapi)) return null;
  const schemas = (
    isObject(openapi.components) && isObject(openapi.components.schemas)
      ? openapi.components.schemas
      : {}
  ) as Record<string, unknown>;
  const deref = (node: unknown, depth = 0): Json => {
    if (!isObject(node) || depth > 5) return {};
    const ref = typeof node.$ref === "string" ? node.$ref : null;
    const base = ref ? deref(schemas[ref.split("/").pop() ?? ""], depth + 1) : {};
    const parts = [
      ...(Array.isArray(node.allOf) ? node.allOf : []),
      ...(Array.isArray(node.anyOf) ? node.anyOf : []),
    ].map((p) => deref(p, depth + 1));
    const merged: Json = Object.assign({}, ...parts);
    return { ...base, ...merged, ...node };
  };
  // Replicate names it `Input`; fal names it `<Endpoint>Input`.
  const name =
    "Input" in schemas
      ? "Input"
      : Object.keys(schemas).find((k) => /Input$/.test(k) && !/Output/.test(k));
  const input = name ? deref(schemas[name]) : null;
  const props = input && isObject(input.properties) ? input.properties : null;
  if (!props) return null;
  return {
    props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, deref(v)])),
    required: Array.isArray(input?.required) ? input.required.map(String) : [],
  };
}

/** "5", "5s", 5 → 5. */
const seconds = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v).replace(/s$/i, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The settings an endpoint's OpenAPI input schema offers (fal.ai and Replicate
 * both publish one): durations, formats, resolutions, sound, what it reads.
 * `null` when the schema has no input properties.
 */
export function describeOpenApiVideoInput(
  openapi: unknown,
): Pick<
  VideoModel,
  | "operations"
  | "inputs"
  | "durations"
  | "aspectRatios"
  | "resolutions"
  | "audio"
  | "seed"
  | "frameImages"
> | null {
  const input = inputProperties(openapi);
  if (!input) return null;
  const { props, required } = input;
  const pickName = (...names: string[]) => names.find((n) => props[n]);
  const pick = (...names: string[]) => {
    const name = pickName(...names);
    return name ? props[name] : undefined;
  };
  const enumOf = (p: Json | undefined) =>
    p && Array.isArray(p.enum) ? (p.enum as unknown[]) : null;

  const duration = pick("duration", "duration_seconds", "seconds", "num_seconds");
  let durations: number[] | null = null;
  const durationEnum = enumOf(duration);
  if (durationEnum)
    durations = sortedDurations(durationEnum.map(seconds).filter((n): n is number => n !== null));
  else if (
    duration &&
    typeof duration.minimum === "number" &&
    typeof duration.maximum === "number"
  ) {
    const span = duration.maximum - duration.minimum;
    if (span >= 0 && span <= 60)
      durations = Array.from({ length: span + 1 }, (_, i) => (duration.minimum as number) + i);
  } else if (duration && seconds(duration.default) !== null)
    durations = [seconds(duration.default) as number];

  const aspect = enumOf(pick("aspect_ratio", "aspectRatio"));
  const resolution = enumOf(pick("resolution", "quality"));
  const audio = pick("generate_audio", "audio", "with_audio", "enable_audio");
  const hasPrompt = Boolean(pick("prompt"));
  const imageName = pickName(
    "image_url",
    "image",
    "start_image",
    "start_image_url",
    "first_frame_image",
    "first_frame",
  );
  const image = imageName ? props[imageName] : undefined;
  const lastFrame = pick(
    "end_image_url",
    "last_frame_image",
    "end_image",
    "last_frame",
    "tail_image_url",
  );
  const operations: VideoOperation[] = [];
  // A prompt with no image it cannot do without.
  if (hasPrompt && !(imageName && required.includes(imageName))) operations.push("text-to-video");
  if (image) operations.push("image-to-video");
  if (lastFrame) operations.push("first-last-frame");
  return {
    operations,
    inputs: [...(hasPrompt ? ["text"] : []), ...(image ? ["image"] : [])],
    durations,
    aspectRatios: aspect ? ratios(aspect.map(String)) : null,
    resolutions: resolution ? sortedResolutions(resolution.map(String)) : null,
    audio: audio ? audio.type === "boolean" || typeof audio.default === "boolean" : null,
    seed: props.seed ? true : null,
    frameImages: [...(image ? ["first_frame"] : []), ...(lastFrame ? ["last_frame"] : [])],
  };
}

export function fromFal(m: FalModel): VideoModel {
  const category = m.metadata?.category ?? "";
  const described = m.openapi ? describeOpenApiVideoInput(m.openapi) : null;
  const operation: VideoOperation[] =
    category === "image-to-video"
      ? ["image-to-video"]
      : category === "text-to-video"
        ? ["text-to-video"]
        : [];
  return {
    provider: "fal",
    id: m.endpoint_id,
    name: m.metadata?.display_name?.trim() || m.endpoint_id,
    owner: m.endpoint_id.split("/")[0] ?? "",
    ...(m.metadata?.description ? { description: m.metadata.description } : {}),
    operations: described?.operations.length ? described.operations : operation,
    inputs: described?.inputs ?? (category === "image-to-video" ? ["text", "image"] : ["text"]),
    durations: described?.durations ?? null,
    aspectRatios: described?.aspectRatios ?? null,
    resolutions: described?.resolutions ?? null,
    audio: described?.audio ?? null,
    seed: described?.seed ?? null,
    frameImages: described?.frameImages ?? [],
    prices: [],
    ...(m.metadata?.date ? { released: m.metadata.date.slice(0, 10) } : {}),
  };
}

export function fromReplicate(m: ReplicateModel): VideoModel {
  const described = describeOpenApiVideoInput(m.latest_version?.openapi_schema);
  return {
    provider: "replicate",
    id: `${m.owner}/${m.name}`,
    name: m.name,
    owner: m.owner,
    ...(m.description ? { description: m.description } : {}),
    operations: described?.operations ?? ["text-to-video"],
    inputs: described?.inputs ?? ["text"],
    durations: described?.durations ?? null,
    aspectRatios: described?.aspectRatios ?? null,
    resolutions: described?.resolutions ?? null,
    audio: described?.audio ?? null,
    seed: described?.seed ?? null,
    frameImages: described?.frameImages ?? [],
    prices: [],
    ...(m.latest_version?.created_at ? { released: m.latest_version.created_at.slice(0, 10) } : {}),
  };
}

export function fromGoogle(m: GoogleModel): VideoModel {
  const id = m.name.replace(/^models\//, "");
  return {
    provider: "google",
    id,
    name: m.displayName?.trim() || id,
    owner: "google",
    ...(m.description ? { description: m.description } : {}),
    operations: ["text-to-video", "image-to-video"],
    inputs: ["text", "image"],
    durations: null,
    aspectRatios: null,
    resolutions: null,
    audio: null,
    seed: null,
    frameImages: [],
    prices: [],
  };
}

/** The direct video providers models.dev lists, by its provider id. */
const MODELS_DEV_DIRECT: Partial<Record<string, VideoProviderId>> = {
  xai: "xai",
  google: "google",
};

export function fromModelsDev(data: ModelsDevResponse): VideoModel[] {
  const models: VideoModel[] = [];
  for (const [providerId, provider] of Object.entries(data)) {
    const target = MODELS_DEV_DIRECT[providerId];
    if (!target) continue;
    for (const m of Object.values(provider.models)) {
      if (!m.modalities.output.includes("video")) continue;
      if (m.status === "deprecated") continue;
      models.push({
        provider: target,
        id: m.id,
        name: m.name,
        owner: providerId,
        operations: [],
        inputs: m.modalities.input,
        durations: null,
        aspectRatios: null,
        resolutions: null,
        audio: null,
        seed: null,
        frameImages: [],
        prices: [],
        released: m.release_date,
      });
    }
  }
  return models;
}

/** A model's name across services: "x-ai/grok-imagine-video-1.5" and "grok-imagine-video-1.5" match. */
export function videoMatchKey(id: string): string {
  return (id.split("/").pop() ?? id)
    .toLowerCase()
    .replace(/-(generate|preview|\d{3})(?=-|$)/g, "")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Fill what a direct provider's entry does not say (settings, operations) from
 * the same model at OpenRouter or the AI Gateway. Prices stay the provider's
 * own: an aggregator's are not the provider's.
 */
export function enrichVideoModel(model: VideoModel, known: readonly VideoModel[]): VideoModel {
  const key = videoMatchKey(model.id);
  let filled = model;
  for (const twin of known) {
    if (twin.provider === model.provider || videoMatchKey(twin.id) !== key) continue;
    filled = {
      ...filled,
      operations: filled.operations.length ? filled.operations : twin.operations,
      inputs: filled.inputs.length > 1 ? filled.inputs : twin.inputs,
      durations: filled.durations ?? twin.durations,
      aspectRatios: filled.aspectRatios ?? twin.aspectRatios,
      resolutions: filled.resolutions ?? twin.resolutions,
      audio: filled.audio ?? twin.audio,
      seed: filled.seed ?? twin.seed,
      frameImages: filled.frameImages.length ? filled.frameImages : twin.frameImages,
      ...((filled.description ?? twin.description)
        ? { description: filled.description ?? twin.description }
        : {}),
      ...((filled.maxPromptChars ?? twin.maxPromptChars)
        ? { maxPromptChars: filled.maxPromptChars ?? twin.maxPromptChars }
        : {}),
    };
  }
  return filled;
}

export interface ListVideoModelsOptions extends FetchOptions {
  /** The services to list (default: every one that needs no key, plus those given a key). */
  providers?: readonly VideoProviderId[];
  /** A Gemini API key, to list the Veo models it can call. */
  googleApiKey?: string;
  /** A Replicate token, to list its text-to-video collection. */
  replicateApiToken?: string;
}

/**
 * Every video model llm-models can find, in one shape: OpenRouter's and the AI
 * Gateway's (with their settings and prices), fal.ai's catalog, xAI's and
 * Google's from models.dev (their settings filled from the same model at
 * OpenRouter or the Gateway), Google's own list and Replicate's collection when
 * given a key. A source that fails is skipped (with `--verbose`, logged): the
 * others still answer.
 */
export async function listVideoModels(options: ListVideoModelsOptions = {}): Promise<VideoModel[]> {
  const wanted = new Set<VideoProviderId>(
    options.providers ??
      VIDEO_PROVIDERS.filter((p) => p !== "replicate" || options.replicateApiToken),
  );
  const fetchOptions: FetchOptions = options.fetch ? { fetch: options.fetch } : {};
  const settle = async <T>(label: string, run: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await run();
    } catch (error) {
      debug(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  };
  // The aggregators also fill the direct providers' settings.
  const needsAggregators =
    wanted.has("openrouter") || wanted.has("gateway") || wanted.has("xai") || wanted.has("google");
  const [openrouter, gateway, fal, modelsDev, google, replicate] = await Promise.all([
    needsAggregators
      ? settle("OpenRouter videos", () => fetchOpenRouterVideoModels(fetchOptions))
      : [],
    needsAggregators ? settle("AI Gateway", () => fetchGatewayVideoModels(fetchOptions)) : [],
    wanted.has("fal") ? settle("fal.ai", () => fetchFalVideoModels(fetchOptions)) : [],
    wanted.has("xai") || wanted.has("google")
      ? settle("models.dev", async () => fromModelsDev(await fetchModelsDevModels(fetchOptions)))
      : [],
    wanted.has("google") && options.googleApiKey
      ? settle("Gemini", () => fetchGoogleVideoModels(options.googleApiKey as string, fetchOptions))
      : [],
    wanted.has("replicate") && options.replicateApiToken
      ? settle("Replicate", () =>
          fetchReplicateVideoModels(options.replicateApiToken as string, fetchOptions),
        )
      : [],
  ]);
  const aggregated = [...openrouter.map(fromOpenRouter), ...gateway.map(fromGateway)];
  const direct = [...modelsDev, ...google.map(fromGoogle)];
  // One entry per provider and id: Google's own list wins over models.dev's.
  const seen = new Map<string, VideoModel>();
  for (const m of direct) seen.set(`${m.provider}:${m.id}`, m);
  const all = [
    ...aggregated,
    ...fal.map(fromFal),
    ...[...seen.values()].map((m) => enrichVideoModel(m, aggregated)),
    ...replicate.map(fromReplicate),
  ];
  return all.filter((m) => wanted.has(m.provider));
}

/** One fal.ai endpoint with the settings its schema offers (`listVideoModels` lists fal without them). */
export async function describeFalVideoModel(
  endpoint: string,
  options: FetchOptions = {},
): Promise<VideoModel | null> {
  const found = await fetchFalModelSchema(endpoint, options);
  return found ? fromFal(found) : null;
}
