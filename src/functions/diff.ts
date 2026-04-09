import { readSnapshot } from "../cache";
import type { UnifiedModel } from "../types";
import { fetchUnifiedModels } from "./normalize";

export interface ModelChange {
  model_id: string;
  field: string;
  old_value: string | number | null;
  new_value: string | number | null;
}

export interface ModelDiff {
  timestamp_previous: number | null;
  timestamp_current: number;
  added: UnifiedModel[];
  removed: string[];
  price_changes: ModelChange[];
  status_changes: ModelChange[];
  total_before: number;
  total_after: number;
}

export async function diffModels(): Promise<ModelDiff> {
  const snapshot = readSnapshot<UnifiedModel[]>("unified");
  const current = await fetchUnifiedModels();
  const now = Date.now();

  if (!snapshot) {
    return {
      timestamp_previous: null,
      timestamp_current: now,
      added: current,
      removed: [],
      price_changes: [],
      status_changes: [],
      total_before: 0,
      total_after: current.length,
    };
  }

  const previousMap = new Map(snapshot.data.map((m) => [m.id, m]));
  const currentMap = new Map(current.map((m) => [m.id, m]));

  const added: UnifiedModel[] = [];
  const removed: string[] = [];
  const priceChanges: ModelChange[] = [];
  const statusChanges: ModelChange[] = [];

  // Find added models and changes
  for (const [id, model] of currentMap) {
    const prev = previousMap.get(id);
    if (!prev) {
      added.push(model);
      continue;
    }

    // Price changes
    if (prev.cost?.input !== model.cost?.input) {
      priceChanges.push({
        model_id: id,
        field: "cost_input",
        old_value: prev.cost?.input ?? null,
        new_value: model.cost?.input ?? null,
      });
    }
    if (prev.cost?.output !== model.cost?.output) {
      priceChanges.push({
        model_id: id,
        field: "cost_output",
        old_value: prev.cost?.output ?? null,
        new_value: model.cost?.output ?? null,
      });
    }

    // Status changes
    if (prev.status !== model.status) {
      statusChanges.push({
        model_id: id,
        field: "status",
        old_value: prev.status ?? null,
        new_value: model.status ?? null,
      });
    }
  }

  // Find removed models
  for (const id of previousMap.keys()) {
    if (!currentMap.has(id)) {
      removed.push(id);
    }
  }

  return {
    timestamp_previous: snapshot.timestamp,
    timestamp_current: now,
    added,
    removed,
    price_changes: priceChanges,
    status_changes: statusChanges,
    total_before: snapshot.data.length,
    total_after: current.length,
  };
}
