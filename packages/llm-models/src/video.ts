// Video models: the shape `listVideoModels` gives them and the helpers an app
// reads them with. Entry `llm-models/video`: plain types and functions, no Zod
// and no other import, so an app bundle stays small.

/** The services llm-models lists video models from, by the id llm-connect calls them with. */
export const VIDEO_PROVIDERS = [
  "openrouter",
  "gateway",
  "fal",
  "google",
  "xai",
  "replicate",
] as const;
export type VideoProviderId = (typeof VIDEO_PROVIDERS)[number];

/** What a video model does, by the names the AI Gateway gives them. */
export const VIDEO_OPERATIONS = [
  "text-to-video",
  "image-to-video",
  "first-last-frame",
  "reference-to-video",
  "video-editing",
  "extend-video",
  "motion-control",
] as const;
export type VideoOperation = (typeof VIDEO_OPERATIONS)[number];

/** One listed price, in US dollars per second of video. */
export interface VideoPrice {
  usdPerSecond: number;
  /** The resolution it applies to ("720p", "4k"); every one when absent. */
  resolution?: string;
  /** With sound (true) or silent (false); both when absent. */
  audio?: boolean;
  /** A quality tier the provider names ("std", "pro"). */
  mode?: string;
}

/** A video model, as its provider's API takes it. `null` means the source does not say. */
export interface VideoModel {
  provider: VideoProviderId;
  /** The id the provider's API takes ("kwaivgi/kling-v3.0-pro", "veo-3.1-fast-generate-preview"). */
  id: string;
  name: string;
  /** Who makes the model ("google", "bytedance"), as the provider names them. */
  owner: string;
  description?: string;
  /** What it does; empty when the source does not say. */
  operations: VideoOperation[];
  /** What it reads: `text`, `image`, `audio`, `video`. */
  inputs: string[];
  /** Clip lengths it renders, in seconds, shortest first. */
  durations: number[] | null;
  /** `W:H` formats it renders. */
  aspectRatios: string[] | null;
  /** Resolutions it renders, lower case ("480p", "1080p", "4k"), smallest first. */
  resolutions: string[] | null;
  /** Whether it can render sound with the picture. */
  audio: boolean | null;
  /** Whether it takes a seed. */
  seed: boolean | null;
  /** The frames an image can pin: `first_frame`, `last_frame`. */
  frameImages: string[];
  /** Per-second prices; empty when the source lists none (or bills another way). */
  prices: VideoPrice[];
  /** The longest prompt it takes, in characters. */
  maxPromptChars?: number;
  /** Release date, `YYYY-MM-DD`. */
  released?: string;
}

/** Whether the model renders from a text prompt alone. */
export function rendersFromText(model: VideoModel): boolean {
  if (model.operations.length > 0) return model.operations.includes("text-to-video");
  return model.inputs.length === 0 || model.inputs.includes("text");
}

/**
 * The per-second price of a render at `resolution`, with or without sound. A
 * listed price that names the sound asked for wins, then one that names the
 * resolution, then one for every case; between equals, the highest, so an
 * estimate never comes in low. `null` when nothing listed applies.
 */
export function videoPricePerSecond(
  model: Pick<VideoModel, "prices">,
  options: { resolution?: string; audio?: boolean } = {},
): number | null {
  const resolution = options.resolution?.toLowerCase();
  const fits = (p: VideoPrice) =>
    (p.resolution === undefined || p.resolution === resolution) &&
    (p.audio === undefined || options.audio === undefined || p.audio === options.audio);
  const score = (p: VideoPrice) =>
    (options.audio !== undefined && p.audio === options.audio ? 2 : 0) +
    (p.resolution !== undefined ? 1 : 0);
  const ranked = model.prices
    .filter(fits)
    .sort((a, b) => score(b) - score(a) || b.usdPerSecond - a.usdPerSecond);
  return ranked[0]?.usdPerSecond ?? null;
}

/** The short side, in pixels, of a resolution name ("720p" → 720, "4k" → 2160). */
export function shortSide(resolution: string): number | null {
  const name = resolution.trim().toLowerCase();
  const p = /^(\d{3,4})p$/.exec(name);
  if (p) return Number(p[1]);
  const k = { "2k": 1440, "4k": 2160 }[name];
  return k ?? null;
}

/**
 * The `WxH` size of a resolution in a format, as the AI SDK takes it:
 * ("720p", "16:9") → "1280x720", ("1080p", "9:16") → "1080x1920". `null` for
 * a name or a format it cannot read.
 */
export function videoSize(resolution: string, aspectRatio: string): `${number}x${number}` | null {
  const short = shortSide(resolution);
  const ratio = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspectRatio.trim());
  if (!short || !ratio) return null;
  const w = Number(ratio[1]);
  const h = Number(ratio[2]);
  if (!w || !h) return null;
  const long = Math.round((short * Math.max(w, h)) / Math.min(w, h) / 2) * 2;
  return w >= h ? `${long}x${short}` : `${short}x${long}`;
}

/** The models of `provider` (every provider when absent) whose name or id holds `query`. */
export function filterVideoModels(
  models: readonly VideoModel[],
  options: { provider?: VideoProviderId; query?: string; operation?: VideoOperation } = {},
): VideoModel[] {
  const wanted = options.query?.trim().toLowerCase() ?? "";
  return models.filter(
    (m) =>
      (!options.provider || m.provider === options.provider) &&
      (!options.operation ||
        (options.operation === "text-to-video"
          ? rendersFromText(m)
          : m.operations.includes(options.operation))) &&
      (!wanted || m.name.toLowerCase().includes(wanted) || m.id.toLowerCase().includes(wanted)),
  );
}
