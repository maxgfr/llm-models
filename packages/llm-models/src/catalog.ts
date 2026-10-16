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

/** The AI SDK packages llm-connect can call; other providers stay out of an app's catalog. */
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
