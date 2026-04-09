#!/usr/bin/env node

export { fetchOpenRouterModels } from "./clients/openrouter";
export { fetchModelsDevModels } from "./clients/models-dev";
export {
  OpenRouterModelSchema,
  OpenRouterResponseSchema,
  OpenRouterArchitectureSchema,
  OpenRouterPricingSchema,
  OpenRouterTopProviderSchema,
  OpenRouterDefaultParametersSchema,
  OpenRouterLinksSchema,
} from "./schemas/openrouter";
export {
  ModelsDevModelSchema,
  ModelsDevProviderSchema,
  ModelsDevResponseSchema,
  ModelsDevCostSchema,
  ModelsDevLimitSchema,
  ModelsDevModalitiesSchema,
} from "./schemas/models-dev";
export type {
  OpenRouterModel,
  OpenRouterResponse,
  ModelsDevModel,
  ModelsDevProvider,
  ModelsDevResponse,
} from "./types";

import { runCommand } from "./cli";

const isCLI = typeof Bun !== "undefined" ? Bun.main === import.meta.path : true;

if (isCLI) {
  runCommand();
}
