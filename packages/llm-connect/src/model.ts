import type { LanguageModel } from "ai";
import { hasProvider, requireProvider, resolveAlias } from "./registry.js";
import type { LlmSettings } from "./settings.js";

/** The registered provider name the settings call: OpenAI's SDK for custom endpoints and by default. */
export function providerNameOf(settings: LlmSettings): string {
  if (settings.customEndpoint) return "openai";
  return resolveAlias(settings.providerNpm || "openai");
}

/**
 * Create the model the settings point to. Its provider must be registered
 * (see `registerProvider` or `llm-connect/providers/*`); {@link loadModel}
 * registers the built-in ones on demand.
 *
 * A custom endpoint goes through the OpenAI SDK with Chat Completions; a
 * catalog provider through its SDK, with its own base URL.
 */
export function createModel(settings: LlmSettings): LanguageModel {
  const factory = requireProvider(providerNameOf(settings));
  if (settings.customEndpoint) {
    return factory({
      apiKey: settings.apiKey || "",
      model: settings.customModel || settings.model || "",
      baseURL: settings.customEndpoint,
      ...(settings.headers && { headers: settings.headers }),
    });
  }
  return factory({
    apiKey: settings.apiKey,
    model: settings.model || "",
    ...(settings.providerApi && { baseURL: settings.providerApi }),
    ...(settings.headers && { headers: settings.headers }),
  });
}

/** Import and register a built-in provider. Literal imports, so bundlers split each SDK out. */
async function registerBuiltin(name: string): Promise<void> {
  switch (name) {
    case "openai":
      (await import("./providers/openai.js")).register();
      return;
    case "anthropic":
      (await import("./providers/anthropic.js")).register();
      return;
    case "google":
      (await import("./providers/google.js")).register();
      return;
    case "mistral":
      (await import("./providers/mistral.js")).register();
      return;
    case "openai-compatible":
      (await import("./providers/openai-compatible.js")).register();
      return;
  }
}

/**
 * {@link createModel}, importing the built-in provider the settings need when
 * nothing is registered under its name yet. Only that SDK is loaded, so an app
 * can keep the others out of its bundle (or uninstalled).
 */
export async function loadModel(settings: LlmSettings): Promise<LanguageModel> {
  const name = providerNameOf(settings);
  if (!hasProvider(name)) await registerBuiltin(name);
  return createModel(settings);
}
