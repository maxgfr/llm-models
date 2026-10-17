import { createGoogle } from "@ai-sdk/google";
import { fromSDK, type ProviderFactory, registerProvider } from "../registry.js";

export const factory: ProviderFactory = fromSDK(createGoogle);

export function register(): void {
  registerProvider("google", factory);
}
