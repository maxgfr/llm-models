import type { UnifiedModel } from "../types";
import { fetchUnifiedModels } from "./normalize";

export interface ModelStats {
  total_models: number;
  total_providers: number;
  by_provider: { provider: string; count: number }[];
  by_capability: Record<string, number>;
  by_modality: Record<string, number>;
  cost: {
    input: { min: number; max: number; median: number; p25: number; p75: number; p90: number };
    output: { min: number; max: number; median: number; p25: number; p75: number; p90: number };
  } | null;
  newest_models: { id: string; release_date: string }[];
  context_length: { min: number; max: number; median: number };
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function costDistribution(
  models: UnifiedModel[],
  getter: (m: UnifiedModel) => number | undefined,
): { min: number; max: number; median: number; p25: number; p75: number; p90: number } | null {
  const values = models.map(getter).filter((v): v is number => v != null && v > 0);
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  return {
    min: values[0],
    max: values[values.length - 1],
    median: percentile(values, 50),
    p25: percentile(values, 25),
    p75: percentile(values, 75),
    p90: percentile(values, 90),
  };
}

export async function getStats(): Promise<ModelStats> {
  const models = await fetchUnifiedModels();

  // By provider
  const providerMap = new Map<string, number>();
  for (const m of models) {
    providerMap.set(m.provider, (providerMap.get(m.provider) ?? 0) + 1);
  }
  const byProvider = Array.from(providerMap.entries())
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => b.count - a.count);

  // By capability
  const byCapability: Record<string, number> = {};
  for (const m of models) {
    for (const [cap, val] of Object.entries(m.capabilities)) {
      if (val === true) {
        byCapability[cap] = (byCapability[cap] ?? 0) + 1;
      }
    }
  }

  // By modality
  const byModality: Record<string, number> = {};
  for (const m of models) {
    for (const mod of m.modalities.input) {
      byModality[mod] = (byModality[mod] ?? 0) + 1;
    }
  }

  // Cost distribution
  const inputDist = costDistribution(models, (m) => m.cost?.input);
  const outputDist = costDistribution(models, (m) => m.cost?.output);

  // Newest models
  const withDates = models
    .filter((m) => m.release_date)
    .sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""));
  const newest = withDates.slice(0, 10).map((m) => ({
    id: m.id,
    release_date: m.release_date as string,
  }));

  // Context length distribution
  const contexts = models.map((m) => m.context_length).sort((a, b) => a - b);

  return {
    total_models: models.length,
    total_providers: providerMap.size,
    by_provider: byProvider,
    by_capability: byCapability,
    by_modality: byModality,
    cost: inputDist && outputDist ? { input: inputDist, output: outputDist } : null,
    newest_models: newest,
    context_length: {
      min: contexts[0],
      max: contexts[contexts.length - 1],
      median: percentile(contexts, 50),
    },
  };
}
