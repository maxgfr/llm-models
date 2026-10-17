import type { SlimCatalog, SlimModel, SlimProvider } from "../catalog";
import type { ModelsDevModel, ModelsDevResponse, UnifiedModel } from "../types";
import { DEFAULT_BASE_URLS } from "./browser";
import { pickTiers } from "./latest";
import { fetchUnifiedData } from "./normalize";

export interface SlimCatalogOptions {
  /**
   * Keep only providers called through these AI SDK packages (all of them when
   * omitted). With `@ai-sdk/openai-compatible` in the list, the providers of
   * {@link OPENAI_COMPATIBLE_SDKS} whose own SDK is not listed are kept through it.
   */
  npm?: readonly string[];
  /** Provider ids that must end up in the catalog with models; throws otherwise. */
  required?: readonly string[];
  /** Leave deprecated models out. Default true. */
  dropDeprecated?: boolean;
  /**
   * Keep only models a chat can use: text in and text out when models.dev
   * lists their modalities, and no embedding model. Default true.
   */
  chatOnly?: boolean;
  /** Attach each provider's recommended model as `defaultModel`. Default true. */
  defaultModel?: boolean;
  /** Fill a missing `api` from the documented base URL of well-known providers. Default true. */
  fillDefaultApi?: boolean;
}

interface CatalogSource {
  models: UnifiedModel[];
  modelsDevData: ModelsDevResponse;
}

const OPENAI_COMPATIBLE_NPM = "@ai-sdk/openai-compatible";

/**
 * Providers that models.dev maps to a dedicated AI SDK package (`sdk`) although
 * their API also accepts OpenAI Chat Completions requests at `api`. When a
 * catalog keeps `@ai-sdk/openai-compatible` but not `sdk`, the provider is
 * listed through the generic SDK at that base URL. Each `api` answered a CORS
 * preflight for an authenticated JSON POST to `<api>/chat/completions` from
 * https://maxgfr.github.io on 2026-10-17; the comment cites the provider's
 * documentation of that endpoint.
 */
export const OPENAI_COMPATIBLE_SDKS: Readonly<
  Record<string, { readonly sdk: string; readonly api: string }>
> = {
  // https://inference-docs.cerebras.ai/api-reference/chat-completions
  cerebras: { sdk: "@ai-sdk/cerebras", api: "https://api.cerebras.ai/v1" },
  // https://docs.cohere.com/docs/compatibility-api (not the native /v2 API)
  cohere: { sdk: "@ai-sdk/cohere", api: "https://api.cohere.ai/compatibility/v1" },
  // https://deepinfra.com/docs/openai_api
  deepinfra: { sdk: "@ai-sdk/deepinfra", api: "https://api.deepinfra.com/v1/openai" },
  // https://console.groq.com/docs/openai
  groq: { sdk: "@ai-sdk/groq", api: "https://api.groq.com/openai/v1" },
  // https://openrouter.ai/docs/api-reference/overview
  openrouter: { sdk: "@openrouter/ai-sdk-provider", api: "https://openrouter.ai/api/v1" },
  // https://docs.perplexity.ai/guides/chat-completions-guide
  perplexity: { sdk: "@ai-sdk/perplexity", api: "https://api.perplexity.ai" },
  // https://docs.together.ai/docs/openai-api-compatibility
  togetherai: { sdk: "@ai-sdk/togetherai", api: "https://api.together.xyz/v1" },
  // https://docs.x.ai/docs/api-reference
  xai: { sdk: "@ai-sdk/xai", api: "https://api.x.ai/v1" },
};

const PRIVATE_IPV4 = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/**
 * Whether a web page can call this base URL as listed: https, no placeholder
 * left to fill (`{…}`, `${…}`, `<…>`), and a public host, not a loopback or
 * private address (localhost, 127.0.0.0/8, ::1, 10/8, 172.16/12, 192.168/16,
 * *.local). Local servers belong to a client's custom-endpoint presets.
 */
export function isUsableBaseUrl(api: string): boolean {
  if (/[{<]/.test(api)) return false;
  let url: URL;
  try {
    url = new URL(api);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "[::1]") return false;
  return !(/^\d+\.\d+\.\d+\.\d+$/.test(host) && PRIVATE_IPV4.some((range) => range.test(host)));
}

/**
 * The SDK package and base URL the catalog lists a provider with: its own,
 * or the generic SDK when only that one is allowed and its API is known to be
 * OpenAI-compatible ({@link OPENAI_COMPATIBLE_SDKS}). Null when no allowed SDK calls it.
 */
function callableThrough(
  id: string,
  npm: string,
  api: string | undefined,
  allowedNpm: ReadonlySet<string> | null,
): { npm: string; api: string | undefined } | null {
  if (!allowedNpm || allowedNpm.has(npm)) return { npm, api };
  const compatible = OPENAI_COMPATIBLE_SDKS[id];
  if (compatible && compatible.sdk === npm && allowedNpm.has(OPENAI_COMPATIBLE_NPM)) {
    return { npm: OPENAI_COMPATIBLE_NPM, api: compatible.api };
  }
  return null;
}

/** Text in, text out (when known), and not an embedding model. */
function isChatModel(model: ModelsDevModel, key: string): boolean {
  const { input, output } = model.modalities ?? {};
  if (output && !output.includes("text")) return false;
  if (input && !input.includes("text")) return false;
  return !/embed/i.test(model.id || key) && !/embed/i.test(model.family ?? "");
}

/** Maps a pick such as "openai/gpt-x" back to a key of the provider's `models`. */
function toModelKey(
  pick: UnifiedModel,
  providerId: string,
  models: Record<string, SlimModel>,
): string | undefined {
  if (pick.api_id && models[pick.api_id]) return pick.api_id;
  const bare = pick.id.startsWith(`${providerId}/`)
    ? pick.id.slice(providerId.length + 1)
    : pick.id;
  if (models[bare]) return bare;
  const dashed = bare.replace(/\./g, "-");
  return Object.keys(models).find((key) => key.replace(/\./g, "-") === dashed);
}

/** The balanced pick (sonnet tier) first, then the others, as long as the catalog lists it. */
function recommendedModel(
  providerId: string,
  pool: UnifiedModel[],
  models: Record<string, SlimModel>,
): string | undefined {
  const picks = pickTiers(pool) ?? [];
  const ordered = [
    ...picks.filter((pick) => pick.tier === "sonnet"),
    ...picks.filter((pick) => pick.tier !== "sonnet"),
  ];
  for (const pick of ordered) {
    const key = toModelKey(pick.model, providerId, models);
    if (key) return key;
  }
  return undefined;
}

/**
 * The slim catalog of the providers a web app can call: id, name, SDK package,
 * base URL, recommended model and, per model, only what a settings form shows.
 * A provider whose base URL a page cannot call as listed is left out
 * ({@link isUsableBaseUrl}). Keys are sorted so that two runs on the same data write the same file.
 */
export function slimCatalog(source: CatalogSource, options: SlimCatalogOptions = {}): SlimCatalog {
  const {
    npm: allowed,
    required = [],
    dropDeprecated = true,
    chatOnly = true,
    defaultModel = true,
    fillDefaultApi = true,
  } = options;
  const allowedNpm = allowed ? new Set(allowed) : null;

  const poolByProvider = new Map<string, UnifiedModel[]>();
  for (const model of source.models) {
    const pool = poolByProvider.get(model.provider) ?? [];
    pool.push(model);
    poolByProvider.set(model.provider, pool);
  }

  const catalog: SlimCatalog = {};
  for (const id of Object.keys(source.modelsDevData).sort()) {
    const provider = source.modelsDevData[id];
    if (!provider.npm) continue;
    const through = callableThrough(
      id,
      provider.npm,
      provider.api || (fillDefaultApi ? DEFAULT_BASE_URLS[id] : undefined),
      allowedNpm,
    );
    if (!through) continue;
    const { npm, api } = through;
    // The generic SDK has no default URL: without one the provider cannot be called.
    if (npm === OPENAI_COMPATIBLE_NPM && !api) continue;
    if (api && !isUsableBaseUrl(api)) continue;

    const models: Record<string, SlimModel> = {};
    for (const key of Object.keys(provider.models).sort()) {
      const model = provider.models[key];
      if (dropDeprecated && model.status === "deprecated") continue;
      if (chatOnly && !isChatModel(model, key)) continue;
      models[key] = {
        id: model.id || key,
        name: model.name || key,
        ...(model.tool_call ? { tool_call: true } : {}),
        ...(model.reasoning ? { reasoning: true } : {}),
      };
    }
    if (Object.keys(models).length === 0) continue;

    const recommended = defaultModel
      ? recommendedModel(id, poolByProvider.get(id) ?? [], models)
      : undefined;
    const slim: SlimProvider = {
      id,
      name: provider.name || id,
      npm,
      ...(api ? { api } : {}),
      ...(recommended ? { defaultModel: recommended } : {}),
      models,
    };
    catalog[id] = slim;
  }

  const missing = required.filter((id) => !catalog[id]);
  if (missing.length > 0) {
    throw new Error(`Catalog is missing required providers: ${missing.join(", ")}`);
  }
  return catalog;
}

/** Fetch models.dev and OpenRouter, then build the slim catalog (see {@link slimCatalog}). */
export async function buildSlimCatalog(options: SlimCatalogOptions = {}): Promise<SlimCatalog> {
  return slimCatalog(await fetchUnifiedData(), options);
}
