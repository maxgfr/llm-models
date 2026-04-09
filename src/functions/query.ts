import type { Capabilities, ModelFilter, ModelSortField, UnifiedModel } from "../types";
import { findModels } from "./search";

export class QueryBuilder {
  private filter: ModelFilter = {};
  private sortField?: ModelSortField;
  private sortDesc = false;
  private maxResults?: number;

  provider(id: string): this {
    this.filter.provider = id;
    return this;
  }

  capability(cap: keyof Capabilities): this {
    this.filter.capability = cap;
    return this;
  }

  modality(mod: string): this {
    this.filter.modality = mod;
    return this;
  }

  maxCost(input: number): this {
    this.filter.maxCostInput = input;
    return this;
  }

  maxCostOutput(output: number): this {
    this.filter.maxCostOutput = output;
    return this;
  }

  minContext(ctx: number): this {
    this.filter.minContext = ctx;
    return this;
  }

  search(term: string): this {
    this.filter.search = term;
    return this;
  }

  status(s: "active" | "deprecated" | "beta"): this {
    this.filter.status = s;
    return this;
  }

  family(f: string): this {
    this.filter.family = f;
    return this;
  }

  sortBy(field: ModelSortField, descending = false): this {
    this.sortField = field;
    this.sortDesc = descending;
    return this;
  }

  limit(n: number): this {
    this.maxResults = n;
    return this;
  }

  async execute(): Promise<UnifiedModel[]> {
    return findModels({
      filter: this.filter,
      sort: this.sortField,
      descending: this.sortDesc,
      limit: this.maxResults,
    });
  }
}

export function query(): QueryBuilder {
  return new QueryBuilder();
}
