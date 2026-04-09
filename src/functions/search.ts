import type { ModelFilter, ModelSortField, UnifiedModel } from "../types";
import { fetchUnifiedModels } from "./normalize";

export function filterModels(models: UnifiedModel[], filter: ModelFilter): UnifiedModel[] {
  let result = models;

  if (filter.provider) {
    const p = filter.provider.toLowerCase();
    result = result.filter((m) => m.provider.toLowerCase() === p);
  }

  if (filter.capability) {
    const cap = filter.capability;
    result = result.filter((m) => m.capabilities[cap] === true);
  }

  if (filter.modality) {
    const mod = filter.modality.toLowerCase();
    result = result.filter(
      (m) =>
        m.modalities.input.some((i) => i.toLowerCase() === mod) ||
        m.modalities.output.some((o) => o.toLowerCase() === mod),
    );
  }

  if (filter.maxCostInput != null) {
    const max = filter.maxCostInput;
    result = result.filter((m) => m.cost != null && m.cost.input <= max);
  }

  if (filter.maxCostOutput != null) {
    const max = filter.maxCostOutput;
    result = result.filter((m) => m.cost != null && m.cost.output <= max);
  }

  if (filter.minContext != null) {
    const min = filter.minContext;
    result = result.filter((m) => m.context_length >= min);
  }

  if (filter.search) {
    const term = filter.search.toLowerCase();
    result = result.filter(
      (m) => m.id.toLowerCase().includes(term) || m.name.toLowerCase().includes(term),
    );
  }

  if (filter.status) {
    if (filter.status === "active") {
      result = result.filter((m) => !m.status || m.status === "active");
    } else {
      result = result.filter((m) => m.status === filter.status);
    }
  }

  if (filter.family) {
    const f = filter.family.toLowerCase();
    result = result.filter((m) => m.family?.toLowerCase() === f);
  }

  return result;
}

export function sortModels(
  models: UnifiedModel[],
  field: ModelSortField,
  descending = false,
): UnifiedModel[] {
  const sorted = [...models].sort((a, b) => {
    let valA: number | string | null;
    let valB: number | string | null;

    switch (field) {
      case "cost_input":
        valA = a.cost?.input ?? null;
        valB = b.cost?.input ?? null;
        break;
      case "cost_output":
        valA = a.cost?.output ?? null;
        valB = b.cost?.output ?? null;
        break;
      case "context_length":
        valA = a.context_length;
        valB = b.context_length;
        break;
      case "release_date":
        valA = a.release_date ?? null;
        valB = b.release_date ?? null;
        break;
      case "name":
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
        break;
      case "knowledge_cutoff":
        valA = a.knowledge_cutoff ?? null;
        valB = b.knowledge_cutoff ?? null;
        break;
      case "value": {
        const costA = a.cost ? a.cost.input + a.cost.output : null;
        const costB = b.cost ? b.cost.input + b.cost.output : null;
        valA = costA != null && costA > 0 ? a.context_length / costA : null;
        valB = costB != null && costB > 0 ? b.context_length / costB : null;
        break;
      }
    }

    // Nulls sort last regardless of direction
    if (valA === null && valB === null) return 0;
    if (valA === null) return 1;
    if (valB === null) return -1;

    if (typeof valA === "string" && typeof valB === "string") {
      return valA < valB ? -1 : valA > valB ? 1 : 0;
    }

    return (valA as number) - (valB as number);
  });

  return descending ? sorted.reverse() : sorted;
}

export async function findModels(options: {
  filter?: ModelFilter;
  sort?: ModelSortField;
  descending?: boolean;
  limit?: number;
}): Promise<UnifiedModel[]> {
  let models = await fetchUnifiedModels();

  if (options.filter) {
    models = filterModels(models, options.filter);
  }

  if (options.sort) {
    models = sortModels(models, options.sort, options.descending);
  }

  if (options.limit != null && options.limit > 0) {
    models = models.slice(0, options.limit);
  }

  return models;
}
