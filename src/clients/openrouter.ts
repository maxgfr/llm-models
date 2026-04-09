import { OpenRouterResponseSchema } from "../schemas/openrouter";
import type { OpenRouterResponse } from "../types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";

export async function fetchOpenRouterModels(): Promise<OpenRouterResponse> {
  const response = await fetch(OPENROUTER_URL);
  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  return OpenRouterResponseSchema.parse(json);
}
