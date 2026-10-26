// The slim catalog a web app ships (`llm-models catalog` writes it) and the
// helpers its client reads it with. Entry `llm-models/catalog`: plain types and
// functions, no Zod, nothing else from the library, so an app bundle stays small.

/** A model as the slim catalog lists it. */
export interface SlimModel {
  /** The id the provider's own API accepts. */
  id: string;
  name: string;
  tool_call?: boolean;
  reasoning?: boolean;
  /** Input modalities (`text`, `image`, `pdf`, `audio`, `video`), listed only when the model takes more than text. */
  input?: string[];
}

/** What a model can read, by the names llm-models gives them. */
export const INPUT_MODALITIES = ["text", "image", "pdf", "audio", "video"] as const;
export type InputModality = (typeof INPUT_MODALITIES)[number];

/** A model as a slim (`input`) or full (`modalities.input`) entry lists its inputs. */
export type WithInputs =
  | { input?: readonly string[]; modalities?: { input?: readonly string[] } }
  | null
  | undefined;

/** A source's name for an input, in llm-models' words: OpenRouter's `file` is a `pdf`. */
export function normalizeModality(modality: string): string {
  const name = modality.trim().toLowerCase();
  return name === "file" ? "pdf" : name;
}

/** The known inputs a model reads, in `INPUT_MODALITIES` order; text only when it lists none. */
export function inputsOf(model: WithInputs): InputModality[] {
  const listed = model?.input ?? model?.modalities?.input ?? [];
  const known = new Set<string>(["text", ...listed.map(normalizeModality)]);
  return INPUT_MODALITIES.filter((m) => known.has(m));
}

/**
 * Whether the model reads `modality` (`image`, `pdf`, `audio`, `video`), as its catalog entry
 * says. A model that lists no input reads text only. The SDK that calls it may still refuse a
 * kind of part: llm-connect's capabilities apply that per provider.
 */
export function acceptsInput(model: WithInputs, modality: InputModality | string): boolean {
  return (inputsOf(model) as string[]).includes(normalizeModality(modality));
}

/** A provider as the slim catalog lists it, with its non-deprecated models. */
export interface SlimProvider {
  id: string;
  name: string;
  /** The AI SDK package that calls it, e.g. "@ai-sdk/anthropic". */
  npm: string;
  /** Base URL of its API. */
  api?: string;
  /** Recommended model, a key of `models`. */
  defaultModel?: string;
  models: Record<string, SlimModel>;
}

/** Providers keyed by models.dev id. */
export type SlimCatalog = Record<string, SlimProvider>;

/**
 * The AI SDK packages llm-connect can call; other providers stay out of an app's
 * catalog, except those whose API is OpenAI-compatible: `slimCatalog` lists them
 * through `@ai-sdk/openai-compatible` (`OPENAI_COMPATIBLE_SDKS` in `functions/catalog.ts`).
 */
export const CALLABLE_NPM: readonly string[] = [
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
  "@ai-sdk/mistral",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
];

/** The provider's recommended model when it lists it, else its first model. */
export function defaultModelOf(provider: SlimProvider | null | undefined): string | undefined {
  if (!provider) return undefined;
  if (provider.defaultModel && provider.models[provider.defaultModel]) return provider.defaultModel;
  return Object.keys(provider.models)[0];
}

/** The provider's models whose name or id contains `query` (any case); all of them for a blank query. */
export function filterCatalogModels(
  provider: SlimProvider | null | undefined,
  query = "",
): SlimModel[] {
  if (!provider) return [];
  const models = Object.values(provider.models);
  const wanted = query.trim().toLowerCase();
  if (!wanted) return models;
  return models.filter(
    (model) => model.name.toLowerCase().includes(wanted) || model.id.toLowerCase().includes(wanted),
  );
}
