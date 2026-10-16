import { createOpenAI } from "@ai-sdk/openai";
import { fromSDK, type ProviderFactory, registerProvider } from "../registry.js";

/** OpenAI, and every custom OpenAI-compatible endpoint (Chat Completions off the official URL). */
export const factory: ProviderFactory = fromSDK(createOpenAI);

export function register(): void {
  registerProvider("openai", factory);
}
