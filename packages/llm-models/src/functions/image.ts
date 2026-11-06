import type { FetchOptions } from "../clients/http";
import {
  fetchFalImageModels,
  fetchGatewayImageModels,
  fetchGoogleImageModels,
  fetchOpenAIImageModels,
  fetchOpenRouterImageModels,
  fetchReplicateImageModels,
  type GatewayImageModel,
  type OpenAIModel,
  type OpenRouterImageModel,
} from "../clients/image";
import { fetchModelsDevModels } from "../clients/models-dev";
import {
  type FalModel,
  fetchFalModelSchema,
  type GoogleModel,
  type ReplicateModel,
} from "../clients/video";
import {
  IMAGE_PROVIDERS,
  type ImageModel,
  type ImageOperation,
  type ImagePrice,
  type ImageProviderId,
} from "../image";
import type { ModelsDevResponse } from "../types";
import { inputProperties, type Json, settle, videoMatchKey } from "./video";

const RATIO = /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/;
const DAY = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

const ratios = (list: readonly unknown[] | null | undefined) => {
  const kept = [...new Set((list ?? []).map(String).filter((r) => RATIO.test(r)))];
  return kept.length ? kept : null;
};
/** "1024x1024", "1024*1024" → "1024x1024"; anything else is left out. */
const sizesOf = (list: readonly unknown[] | null | undefined) => {
  const kept = [
    ...new Set(
      (list ?? []).flatMap((s) => {
        const wh = /^(\d+)\s*[x*×]\s*(\d+)$/i.exec(String(s).trim());
        return wh ? [`${wh[1]}x${wh[2]}`] : [];
      }),
    ),
  ];
  return kept.length ? kept : null;
};
const usd = (v: unknown) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : null;
};

/** fal.ai's named sizes (`image_size`), and the pixels each one draws. */
const FAL_IMAGE_SIZES: Record<string, { ratio: string; size: string }> = {
  square_hd: { ratio: "1:1", size: "1024x1024" },
  square: { ratio: "1:1", size: "512x512" },
  portrait_4_3: { ratio: "3:4", size: "768x1024" },
  portrait_16_9: { ratio: "9:16", size: "576x1024" },
  landscape_4_3: { ratio: "4:3", size: "1024x768" },
  landscape_16_9: { ratio: "16:9", size: "1024x576" },
};

export function fromOpenRouterImage(m: OpenRouterImageModel): ImageModel {
  const params = m.supported_parameters;
  const references = params?.input_references;
  const imageIn =
    (m.architecture?.input_modalities ?? []).includes("image") || (references?.max ?? 0) > 0;
  const operations: ImageOperation[] = [];
  // A model that needs at least one reference image only edits.
  if (!((references?.min ?? 0) >= 1)) operations.push("text-to-image");
  if (imageIn) operations.push("image-edit");
  const max = params?.n?.max;
  return {
    provider: "openrouter",
    id: m.id,
    name: m.name.replace(/^([^:]+):\s*/, "$1 "),
    owner: m.id.split("/")[0] ?? "",
    ...(m.description ? { description: m.description } : {}),
    operations,
    inputs: imageIn ? ["text", "image"] : ["text"],
    aspectRatios: ratios(params?.aspect_ratio?.values),
    sizes: sizesOf(params?.size?.values),
    maxImagesPerCall: typeof max === "number" && max > 0 ? max : null,
    // The typed list names every parameter a model takes.
    seed: params ? "seed" in params : null,
    // OpenRouter bills image models by token, per endpoint: no per-image price.
    prices: [],
    ...(m.created ? { released: DAY(m.created) } : {}),
  };
}

/**
 * The AI Gateway's per-image prices: `pricing.image` for every case, then each
 * size or quality it names. Prices for a style or an extra operation (vector
 * art, web grounding) are left out: they are not the price of a plain image.
 */
export function gatewayImagePrices(pricing: GatewayImageModel["pricing"]): ImagePrice[] {
  const prices: ImagePrice[] = [];
  const base = usd(pricing?.image);
  if (base !== null) prices.push({ usd: base, per: "image" });
  for (const p of pricing?.image_dimension_quality_pricing ?? []) {
    const cost = usd(p.cost);
    if (cost === null || p.style || p.operation || (!p.size && !p.quality)) continue;
    prices.push({
      usd: cost,
      per: "image",
      ...(p.size ? { size: p.size.toLowerCase() } : {}),
      ...(p.quality ? { quality: p.quality.toLowerCase() } : {}),
    });
  }
  return prices;
}

export function fromGatewayImage(m: GatewayImageModel): ImageModel {
  const inputs = [...new Set(["text", ...(m.modalities?.input ?? [])])];
  return {
    provider: "gateway",
    id: m.id,
    name: m.name,
    owner: m.owned_by ?? m.id.split("/")[0] ?? "",
    ...(m.description ? { description: m.description } : {}),
    operations: inputs.includes("image") ? ["text-to-image", "image-edit"] : ["text-to-image"],
    inputs,
    aspectRatios: null,
    sizes: null,
    maxImagesPerCall: null,
    seed: null,
    prices: gatewayImagePrices(m.pricing),
    ...(m.released ? { released: DAY(m.released) } : {}),
  };
}

/** The image inputs an endpoint may take, by the names fal.ai and Replicate give them. */
const IMAGE_INPUTS = [
  "image_url",
  "image_urls",
  "image",
  "images",
  "input_image",
  "input_images",
  "image_input",
  "reference_images",
  "reference_image_urls",
];

/**
 * The settings an endpoint's OpenAPI input schema offers (fal.ai and Replicate
 * both publish one): formats, sizes, images per call, seed, what it reads.
 * `null` when the schema has no input properties.
 */
export function describeOpenApiImageInput(
  openapi: unknown,
):
  | (Pick<
      ImageModel,
      "operations" | "inputs" | "aspectRatios" | "sizes" | "maxImagesPerCall" | "seed"
    > & { maxPromptChars?: number })
  | null {
  const input = inputProperties(openapi);
  if (!input) return null;
  const { props, required } = input;
  const pick = (...names: string[]) => names.map((n) => props[n]).find(Boolean);
  const enumOf = (p: Json | undefined) =>
    p && Array.isArray(p.enum) ? (p.enum as unknown[]) : null;

  const named = (enumOf(pick("image_size")) ?? [])
    .map((n) => FAL_IMAGE_SIZES[String(n)])
    .filter((s) => s !== undefined);
  const aspect = ratios([
    ...(enumOf(pick("aspect_ratio", "aspectRatio")) ?? []),
    ...named.map((s) => s.ratio),
  ]);
  const sizes = sizesOf([
    ...(enumOf(pick("size", "image_size")) ?? []),
    ...named.map((s) => s.size),
  ]);
  const count = pick("num_images", "num_outputs", "n", "number_of_images");
  const prompt = pick("prompt");
  const imageName = IMAGE_INPUTS.find((n) => props[n]);
  const operations: ImageOperation[] = [];
  // A prompt with no image it cannot do without.
  if (prompt && !(imageName && required.includes(imageName))) operations.push("text-to-image");
  if (imageName) operations.push("image-edit");
  return {
    operations,
    inputs: [...(prompt ? ["text"] : []), ...(imageName ? ["image"] : [])],
    aspectRatios: aspect,
    sizes,
    maxImagesPerCall:
      count && typeof count.maximum === "number" && count.maximum > 0 ? count.maximum : null,
    seed: props.seed ? true : null,
    ...(prompt && typeof prompt.maxLength === "number" ? { maxPromptChars: prompt.maxLength } : {}),
  };
}

export function fromFalImage(m: FalModel): ImageModel {
  const category = m.metadata?.category ?? "";
  const described = m.openapi ? describeOpenApiImageInput(m.openapi) : null;
  const edits = category === "image-to-image";
  return {
    provider: "fal",
    id: m.endpoint_id,
    name: m.metadata?.display_name?.trim() || m.endpoint_id,
    owner: m.endpoint_id.split("/")[0] ?? "",
    ...(m.metadata?.description ? { description: m.metadata.description } : {}),
    operations: described?.operations.length
      ? described.operations
      : edits
        ? ["image-edit"]
        : ["text-to-image"],
    inputs: described?.inputs.length ? described.inputs : edits ? ["text", "image"] : ["text"],
    aspectRatios: described?.aspectRatios ?? null,
    sizes: described?.sizes ?? null,
    maxImagesPerCall: described?.maxImagesPerCall ?? null,
    seed: described?.seed ?? null,
    prices: [],
    ...(described?.maxPromptChars ? { maxPromptChars: described.maxPromptChars } : {}),
    ...(m.metadata?.date ? { released: m.metadata.date.slice(0, 10) } : {}),
  };
}

export function fromReplicateImage(m: ReplicateModel): ImageModel {
  const described = describeOpenApiImageInput(m.latest_version?.openapi_schema);
  return {
    provider: "replicate",
    id: `${m.owner}/${m.name}`,
    name: m.name,
    owner: m.owner,
    ...(m.description ? { description: m.description } : {}),
    operations: described?.operations.length ? described.operations : ["text-to-image"],
    inputs: described?.inputs.length ? described.inputs : ["text"],
    aspectRatios: described?.aspectRatios ?? null,
    sizes: described?.sizes ?? null,
    maxImagesPerCall: described?.maxImagesPerCall ?? null,
    seed: described?.seed ?? null,
    prices: [],
    ...(described?.maxPromptChars ? { maxPromptChars: described.maxPromptChars } : {}),
    ...(m.latest_version?.created_at ? { released: m.latest_version.created_at.slice(0, 10) } : {}),
  };
}

export function fromGoogleImage(m: GoogleModel): ImageModel {
  const id = m.name.replace(/^models\//, "");
  // Imagen draws from a prompt; Gemini's image models also edit the images they are sent.
  const edits = !/imagen/i.test(id);
  return {
    provider: "google",
    id,
    name: m.displayName?.trim() || id,
    owner: "google",
    ...(m.description ? { description: m.description } : {}),
    operations: edits ? ["text-to-image", "image-edit"] : ["text-to-image"],
    inputs: edits ? ["text", "image"] : ["text"],
    aspectRatios: null,
    sizes: null,
    maxImagesPerCall: null,
    seed: null,
    prices: [],
  };
}

export function fromOpenAIImage(m: OpenAIModel): ImageModel {
  return {
    provider: "openai",
    id: m.id,
    name: m.id,
    owner: "openai",
    operations: [],
    inputs: ["text"],
    aspectRatios: null,
    sizes: null,
    maxImagesPerCall: null,
    seed: null,
    prices: [],
    ...(m.created ? { released: DAY(m.created) } : {}),
  };
}

/** The direct image providers models.dev lists, by its provider id. */
const MODELS_DEV_DIRECT: Partial<Record<string, ImageProviderId>> = {
  openai: "openai",
  google: "google",
  xai: "xai",
};
/** models.dev also gives an image output to agents that draw charts (Deep Research): not image models. */
const IMAGE_MODEL_NAME = /image|imagen|banana|dall-?e/i;

export function fromModelsDevImage(data: ModelsDevResponse): ImageModel[] {
  const models: ImageModel[] = [];
  for (const [providerId, provider] of Object.entries(data)) {
    const target = MODELS_DEV_DIRECT[providerId];
    if (!target) continue;
    for (const m of Object.values(provider.models)) {
      if (!m.modalities.output.includes("image")) continue;
      if (!IMAGE_MODEL_NAME.test(m.id) && !IMAGE_MODEL_NAME.test(m.name)) continue;
      if (m.status === "deprecated") continue;
      models.push({
        provider: target,
        id: m.id,
        name: m.name,
        owner: providerId,
        operations: [],
        inputs: m.modalities.input.filter((i) => i === "text" || i === "image"),
        aspectRatios: null,
        sizes: null,
        maxImagesPerCall: null,
        seed: null,
        prices: [],
        released: m.release_date,
      });
    }
  }
  return models;
}

/**
 * Fill what a direct provider's entry does not say (settings, operations) from
 * the same model at OpenRouter or the AI Gateway. Prices stay the provider's
 * own: an aggregator's are not the provider's.
 */
export function enrichImageModel(model: ImageModel, known: readonly ImageModel[]): ImageModel {
  const key = videoMatchKey(model.id);
  let filled = model;
  for (const twin of known) {
    if (twin.provider === model.provider || videoMatchKey(twin.id) !== key) continue;
    filled = {
      ...filled,
      operations: filled.operations.length ? filled.operations : twin.operations,
      inputs: filled.inputs.length > 1 ? filled.inputs : twin.inputs,
      aspectRatios: filled.aspectRatios ?? twin.aspectRatios,
      sizes: filled.sizes ?? twin.sizes,
      maxImagesPerCall: filled.maxImagesPerCall ?? twin.maxImagesPerCall,
      seed: filled.seed ?? twin.seed,
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

export interface ListImageModelsOptions extends FetchOptions {
  /** The services to list (default: every one that needs no key, plus those given a key). */
  providers?: readonly ImageProviderId[];
  /** A Replicate token, to list its text-to-image collection. */
  replicateApiToken?: string;
  /** An OpenAI key, to list the image models it can call. */
  openaiApiKey?: string;
  /** A Gemini API key, to list the image models (Imagen, Gemini image) it can call. */
  googleApiKey?: string;
}

/**
 * Every image model llm-models can find, in one shape: OpenRouter's (with
 * their settings) and the AI Gateway's (with their per-image prices), fal.ai's
 * catalog, OpenAI's, Google's and xAI's from models.dev (their settings filled
 * from the same model at OpenRouter or the Gateway), OpenAI's and Google's own
 * lists and Replicate's collection when given a key. A source that fails is
 * skipped (with `--verbose`, logged): the others still answer.
 */
export async function listImageModels(options: ListImageModelsOptions = {}): Promise<ImageModel[]> {
  const wanted = new Set<ImageProviderId>(
    options.providers ??
      IMAGE_PROVIDERS.filter((p) => p !== "replicate" || options.replicateApiToken),
  );
  const fetchOptions: FetchOptions = options.fetch ? { fetch: options.fetch } : {};
  const direct = wanted.has("openai") || wanted.has("google") || wanted.has("xai");
  // The aggregators also fill the direct providers' settings.
  const needsAggregators = wanted.has("openrouter") || wanted.has("gateway") || direct;
  const [openrouter, gateway, fal, modelsDev, openai, google, replicate] = await Promise.all([
    needsAggregators
      ? settle("OpenRouter images", () => fetchOpenRouterImageModels(fetchOptions))
      : [],
    needsAggregators ? settle("AI Gateway", () => fetchGatewayImageModels(fetchOptions)) : [],
    wanted.has("fal") ? settle("fal.ai", () => fetchFalImageModels(fetchOptions)) : [],
    direct
      ? settle("models.dev", async () =>
          fromModelsDevImage(await fetchModelsDevModels(fetchOptions)),
        )
      : [],
    wanted.has("openai") && options.openaiApiKey
      ? settle("OpenAI", () => fetchOpenAIImageModels(options.openaiApiKey as string, fetchOptions))
      : [],
    wanted.has("google") && options.googleApiKey
      ? settle("Gemini", () => fetchGoogleImageModels(options.googleApiKey as string, fetchOptions))
      : [],
    wanted.has("replicate") && options.replicateApiToken
      ? settle("Replicate", () =>
          fetchReplicateImageModels(options.replicateApiToken as string, fetchOptions),
        )
      : [],
  ]);
  const aggregated = [...openrouter.map(fromOpenRouterImage), ...gateway.map(fromGatewayImage)];
  // One entry per provider and id: the provider's own list wins over models.dev's.
  const seen = new Map<string, ImageModel>();
  for (const m of [...modelsDev, ...openai.map(fromOpenAIImage), ...google.map(fromGoogleImage)])
    seen.set(`${m.provider}:${m.id}`, m);
  const all = [
    ...aggregated,
    ...fal.map(fromFalImage),
    ...[...seen.values()].map((m) => enrichImageModel(m, aggregated)),
    ...replicate.map(fromReplicateImage),
  ];
  return all.filter((m) => wanted.has(m.provider));
}

/** One fal.ai endpoint with the settings its schema offers (`listImageModels` lists fal without them). */
export async function describeFalImageModel(
  endpoint: string,
  options: FetchOptions = {},
): Promise<ImageModel | null> {
  const found = await fetchFalModelSchema(endpoint, options);
  return found ? fromFalImage(found) : null;
}
