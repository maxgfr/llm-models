import type { z } from "zod";
import type {
  ModelsDevModelSchema,
  ModelsDevProviderSchema,
  ModelsDevResponseSchema,
} from "./schemas/models-dev";
import type { OpenRouterModelSchema, OpenRouterResponseSchema } from "./schemas/openrouter";

export type OpenRouterModel = z.infer<typeof OpenRouterModelSchema>;
export type OpenRouterResponse = z.infer<typeof OpenRouterResponseSchema>;
export type ModelsDevModel = z.infer<typeof ModelsDevModelSchema>;
export type ModelsDevProvider = z.infer<typeof ModelsDevProviderSchema>;
export type ModelsDevResponse = z.infer<typeof ModelsDevResponseSchema>;
