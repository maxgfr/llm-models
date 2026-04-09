import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface WorkloadProfile {
  input: string;
  output: string;
}

export interface LlmModelsConfig {
  cache?: {
    enabled?: boolean;
    ttl?: number;
  };
  defaults?: {
    format?: "table" | "json" | "csv" | "markdown";
    limit?: number;
    sort?: string;
    desc?: boolean;
  };
  profiles?: Record<string, WorkloadProfile>;
}

const CONFIG_DIR = join(homedir(), ".config", "llm-models");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const BUILTIN_PROFILES: Record<string, WorkloadProfile> = {
  chatbot: { input: "10K", output: "1K" },
  "code-gen": { input: "5K", output: "10K" },
  rag: { input: "100K", output: "5K" },
  summarization: { input: "50K", output: "2K" },
  translation: { input: "5K", output: "5K" },
};

let configCache: LlmModelsConfig | null = null;

export function loadConfig(): LlmModelsConfig {
  if (configCache) return configCache;

  // Check local config first, then global
  const localPath = join(process.cwd(), ".llm-modelsrc");
  const paths = [localPath, CONFIG_PATH];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        configCache = JSON.parse(readFileSync(p, "utf-8")) as LlmModelsConfig;
        return configCache;
      } catch {
        // ignore invalid config
      }
    }
  }

  configCache = {};
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

export function initConfig(): void {
  if (existsSync(CONFIG_PATH)) {
    console.log(`Config already exists at ${CONFIG_PATH}`);
    return;
  }
  mkdirSync(CONFIG_DIR, { recursive: true });
  const defaultConfig: LlmModelsConfig = {
    cache: { enabled: true, ttl: 3600000 },
    defaults: { format: "table", limit: 20 },
    profiles: {},
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
  console.log(`Config created at ${CONFIG_PATH}`);
}

export function getConfigPath(): string {
  const localPath = join(process.cwd(), ".llm-modelsrc");
  if (existsSync(localPath)) return localPath;
  if (existsSync(CONFIG_PATH)) return CONFIG_PATH;
  return CONFIG_PATH;
}
