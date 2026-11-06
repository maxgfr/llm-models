// What the media modules (`llm-connect/video`, `/image`, `/speech`) share: the
// providers they reach, the options every call takes, and how a failed call
// reads, the key scrubbed out.

import { describeError, scrubSecret } from "./errors.js";
import type { FetchLike } from "./fetch.js";

export type { FetchLike } from "./fetch.js";

/** Every provider a media module reaches. */
export type MediaProviderId =
  | "openrouter"
  | "gateway"
  | "fal"
  | "openai"
  | "google"
  | "xai"
  | "replicate"
  | "elevenlabs";

/** Where a provider's key comes from, and what calls it. */
export interface MediaProviderInfo {
  name: string;
  /** The page that issues a key. */
  keyUrl: string;
  /** The environment variable its SDK reads by convention. */
  env: string;
  /** The package the module imports (`null`: built into llm-connect). */
  package: string | null;
}

export const MEDIA_PROVIDER_INFO: Readonly<Record<MediaProviderId, MediaProviderInfo>> = {
  openrouter: {
    name: "OpenRouter",
    keyUrl: "https://openrouter.ai/settings/keys",
    env: "OPENROUTER_API_KEY",
    package: null,
  },
  gateway: {
    name: "Vercel AI Gateway",
    keyUrl: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys",
    env: "AI_GATEWAY_API_KEY",
    package: "@ai-sdk/gateway",
  },
  fal: {
    name: "fal.ai",
    keyUrl: "https://fal.ai/dashboard/keys",
    env: "FAL_KEY",
    package: "@ai-sdk/fal",
  },
  openai: {
    name: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    env: "OPENAI_API_KEY",
    package: "@ai-sdk/openai",
  },
  google: {
    name: "Google (Gemini API)",
    keyUrl: "https://aistudio.google.com/apikey",
    env: "GEMINI_API_KEY",
    package: "@ai-sdk/google",
  },
  xai: { name: "xAI", keyUrl: "https://console.x.ai", env: "XAI_API_KEY", package: "@ai-sdk/xai" },
  replicate: {
    name: "Replicate",
    keyUrl: "https://replicate.com/account/api-tokens",
    env: "REPLICATE_API_TOKEN",
    package: "@ai-sdk/replicate",
  },
  elevenlabs: {
    name: "ElevenLabs",
    keyUrl: "https://elevenlabs.io/app/settings/api-keys",
    env: "ELEVENLABS_API_KEY",
    package: "@ai-sdk/elevenlabs",
  },
};

/** The entries of `MEDIA_PROVIDER_INFO` for a module's providers. */
export function providerInfoOf<P extends MediaProviderId>(
  providers: readonly P[],
): Readonly<Record<P, MediaProviderInfo>> {
  return Object.fromEntries(providers.map((p) => [p, MEDIA_PROVIDER_INFO[p]])) as Record<
    P,
    MediaProviderInfo
  >;
}

export interface MediaOptions {
  /** The fetch every request goes through. Default `globalThis.fetch`. */
  fetch?: FetchLike;
  abortSignal?: AbortSignal;
}

/** `options.fetch`, or the global fetch called late (so a test or polyfill that replaces it counts). */
export function fetchOf(options: MediaOptions): FetchLike {
  return options.fetch ?? ((input, init) => globalThis.fetch(input, init));
}

/** The error a module throws when the SDK a provider needs is not installed. */
export function missingPackage(what: string, provider: string, pkg: string) {
  return (error: unknown): never => {
    throw new Error(`${what} with ${provider} needs the ${pkg} package (npm install ${pkg}).`, {
      cause: error,
    });
  };
}

/** The message of a failed call, the key scrubbed from it. */
export function mediaFailure(error: unknown, apiKey: string): Error {
  const described = describeError(error, apiKey);
  const message = described.message || (error instanceof Error ? error.message : String(error));
  return Object.assign(new Error(scrubSecret(message, apiKey)), {
    code: described.code,
    status: described.status,
  });
}

/** An AI SDK warning as one line: `feature: details`, or its message, or its type. */
export function warningText(warning: { type: string }): string {
  const w = warning as { type: string; feature?: string; details?: string; message?: string };
  if (w.details) return `${w.feature ?? "setting"}: ${w.details}`;
  if (w.message) return w.message;
  return w.feature ? `${w.type}: ${w.feature}` : w.type;
}
