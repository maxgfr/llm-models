import type { LlmModelsConfig, WorkloadProfile } from "./types";

// Config lookups, free of any Node.js API. Where the config comes from is a
// loader: none by default (a browser has no config file), the config files once
// `./config` (Node only) is loaded, which the package's Node entry point does.

export type { LlmModelsConfig, WorkloadProfile };

const BUILTIN_PROFILES: Record<string, WorkloadProfile> = {
  chatbot: { input: "10K", output: "1K" },
  "code-gen": { input: "5K", output: "10K" },
  rag: { input: "100K", output: "5K" },
  summarization: { input: "50K", output: "2K" },
  translation: { input: "5K", output: "5K" },
};

let loader: () => LlmModelsConfig = () => ({});
let configCache: LlmModelsConfig | null = null;

/** Swap where the config comes from (the Node entry point reads the config files). */
export function setConfigLoader(next: () => LlmModelsConfig): void {
  loader = next;
  configCache = null;
}

export function loadConfig(): LlmModelsConfig {
  configCache ??= loader();
  return configCache;
}

export function getProfile(name: string): WorkloadProfile | undefined {
  const config = loadConfig();
  return config.profiles?.[name] ?? BUILTIN_PROFILES[name];
}

export function listProfiles(): Record<string, WorkloadProfile> {
  const config = loadConfig();
  return { ...BUILTIN_PROFILES, ...config.profiles };
}
