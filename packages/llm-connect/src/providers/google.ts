import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { fromSDK, type ProviderFactory, registerProvider } from "../registry.js";

export const factory: ProviderFactory = fromSDK(createGoogleGenerativeAI);

export function register(): void {
  registerProvider("google", factory);
}
