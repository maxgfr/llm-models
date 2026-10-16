import { createMistral } from "@ai-sdk/mistral";
import { fromSDK, type ProviderFactory, registerProvider } from "../registry.js";

export const factory: ProviderFactory = fromSDK(createMistral);

export function register(): void {
  registerProvider("mistral", factory);
}
