import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setConfigLoader } from "./config-core";
import { LlmModelsConfigSchema } from "./schemas/functions";
import type { LlmModelsConfig } from "./types";

// Node only: reads `.llm-modelsrc` and ~/.config/llm-models/config.json.
// Importing this module installs that reader; the browser entry never imports it.

export type { LlmModelsConfig, WorkloadProfile } from "./config-core";
export { getProfile, listProfiles, loadConfig } from "./config-core";

const CONFIG_DIR = join(homedir(), ".config", "llm-models");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/** The first valid config file, local before global; an invalid one is reported and skipped. */
function readConfigFiles(): LlmModelsConfig {
  const localPath = join(process.cwd(), ".llm-modelsrc");
  const paths = [localPath, CONFIG_PATH];

  for (const p of paths) {
    if (!existsSync(p)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(p, "utf-8"));
    } catch (err) {
      console.error(
        `Warning: ignoring config ${p}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    const parsed = LlmModelsConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      console.error(`Warning: ignoring config ${p}: ${issues}`);
      continue;
    }
    return parsed.data;
  }

  return {};
}

setConfigLoader(readConfigFiles);

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
  return CONFIG_PATH;
}
