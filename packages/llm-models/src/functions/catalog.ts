import type { SlimCatalog, SlimModel, SlimProvider } from "../catalog";
import type { ModelsDevModel, ModelsDevResponse, UnifiedModel } from "../types";
import { DEFAULT_BASE_URLS } from "./browser";
import { pickTiers } from "./latest";
import { fetchUnifiedData } from "./normalize";

export interface SlimCatalogOptions {
  /** Keep only providers called through these AI SDK packages (all of them when omitted). */
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
 * Keys are sorted so that two runs on the same data write the same file.
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
    const npm = provider.npm;
    if (!npm || (allowedNpm && !allowedNpm.has(npm))) continue;
    const api = provider.api || (fillDefaultApi ? DEFAULT_BASE_URLS[id] : undefined);
    // The generic SDK has no default URL: without one the provider cannot be called.
    if (npm === "@ai-sdk/openai-compatible" && !api) continue;

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
