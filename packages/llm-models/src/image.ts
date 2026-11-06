// Image models: the shape `listImageModels` gives them and the helpers an app
// reads them with. Entry `llm-models/image`: plain types and functions, no Zod
// and no other import, so an app bundle stays small.

/** The services llm-models lists image models from, by the id llm-connect calls them with. */
export const IMAGE_PROVIDERS = [
  "openrouter",
  "gateway",
  "fal",
  "openai",
  "google",
  "xai",
  "replicate",
] as const;
export type ImageProviderId = (typeof IMAGE_PROVIDERS)[number];

/** What an image model does: draw from a prompt, or change images it is given. */
export const IMAGE_OPERATIONS = ["text-to-image", "image-edit"] as const;
export type ImageOperation = (typeof IMAGE_OPERATIONS)[number];

/** One listed price, in US dollars per image or per megapixel. */
export interface ImagePrice {
  usd: number;
  per: "image" | "megapixel";
  /** The `WxH` size it applies to; every one when absent. */
  size?: string;
  /** The quality tier it applies to ("low", "high"); every one when absent. */
  quality?: string;
}

/** An image model, as its provider's API takes it. `null` means the source does not say. */
export interface ImageModel {
  provider: ImageProviderId;
  /** The id the provider's API takes ("black-forest-labs/flux-3-image", "gpt-image-2"). */
  id: string;
  name: string;
  /** Who makes the model ("openai", "bfl"), as the provider names them. */
  owner: string;
  description?: string;
  /** What it does; empty when the source does not say. */
  operations: ImageOperation[];
  /** What it reads: `text`, `image`. */
  inputs: string[];
  /** `W:H` formats it draws. */
  aspectRatios: string[] | null;
  /** `WxH` sizes it draws ("1024x1024"). */
  sizes: string[] | null;
  /** The most images one call returns. */
  maxImagesPerCall: number | null;
  /** Whether it takes a seed. */
  seed: boolean | null;
  /** Listed prices; empty when the source lists none (or bills by token). */
  prices: ImagePrice[];
  /** The longest prompt it takes, in characters. */
  maxPromptChars?: number;
  /** Release date, `YYYY-MM-DD`. */
  released?: string;
}

/** Whether the model draws from a text prompt alone. */
export function rendersImageFromText(model: ImageModel): boolean {
  if (model.operations.length > 0) return model.operations.includes("text-to-image");
  return model.inputs.length === 0 || model.inputs.includes("text");
}

/**
 * The price of one image of `size` (default 1024x1024) at `quality`. A listed
 * price that names the quality asked for wins, then one that names the size,
 * then one for every case; a per-megapixel price is counted for that size.
 * Between equals, the highest, so an estimate never comes in low. `null` when
 * nothing listed applies.
 */
export function imagePrice(
  model: Pick<ImageModel, "prices">,
  options: { size?: string; quality?: string } = {},
): number | null {
  const size = (options.size ?? "1024x1024").toLowerCase();
  const wh = /^(\d+)x(\d+)$/.exec(size);
  const megapixels = wh ? (Number(wh[1]) * Number(wh[2])) / 1e6 : null;
  const quality = options.quality?.toLowerCase();
  const usd = (p: ImagePrice) =>
    p.per === "image" ? p.usd : megapixels === null ? null : p.usd * megapixels;
  const score = (p: ImagePrice) =>
    (quality !== undefined && p.quality === quality ? 2 : 0) + (p.size !== undefined ? 1 : 0);
  const ranked = model.prices
    .filter(
      (p) =>
        (p.size === undefined || p.size === size) &&
        (p.quality === undefined || quality === undefined || p.quality === quality) &&
        usd(p) !== null,
    )
    .sort((a, b) => score(b) - score(a) || (usd(b) as number) - (usd(a) as number));
  return ranked[0] ? usd(ranked[0]) : null;
}

/** The models of `provider` (every provider when absent) whose name or id holds `query`. */
export function filterImageModels(
  models: readonly ImageModel[],
  options: { provider?: ImageProviderId; query?: string; operation?: ImageOperation } = {},
): ImageModel[] {
  const wanted = options.query?.trim().toLowerCase() ?? "";
  return models.filter(
    (m) =>
      (!options.provider || m.provider === options.provider) &&
      (!options.operation ||
        (options.operation === "text-to-image"
          ? rendersImageFromText(m)
          : m.operations.includes(options.operation))) &&
      (!wanted || m.name.toLowerCase().includes(wanted) || m.id.toLowerCase().includes(wanted)),
  );
}
