import { z } from "zod";
import { readCache, writeCache } from "../cache-core";
import { debug } from "../log";
import { OpenRouterModelSchema } from "../schemas/openrouter";
import type { OpenRouterModel, OpenRouterResponse } from "../types";
import { type FetchOptions, fetchJson } from "./http";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";

/** Only the envelope is checked up front; each model is validated on its own. */
const LooseResponseSchema = z.object({ data: z.array(z.unknown()) });

/**
 * Validate a raw /models response entry by entry, dropping the entries that
 * no longer match the schema: one odd model must not take the whole list down.
 * Throws when the envelope is wrong or no entry survives.
 */
export function parseOpenRouterResponse(json: unknown): OpenRouterResponse {
  const envelope = LooseResponseSchema.parse(json);
  const data: OpenRouterModel[] = [];
  for (const entry of envelope.data) {
    const parsed = OpenRouterModelSchema.safeParse(entry);
    if (parsed.success) data.push(parsed.data);
  }
  const skipped = envelope.data.length - data.length;
  if (skipped > 0) debug(`OpenRouter: skipped ${skipped} invalid model entries`);
  if (data.length === 0) throw new Error("OpenRouter API returned no valid models");
  return { data };
}

export async function fetchOpenRouterModels(
  options: FetchOptions = {},
): Promise<OpenRouterResponse> {
  const cached = readCache<OpenRouterResponse>("openrouter");
  if (cached) return cached;

  const result = parseOpenRouterResponse(await fetchJson(OPENROUTER_URL, "OpenRouter", options));
  writeCache("openrouter", result);
  return result;
}
