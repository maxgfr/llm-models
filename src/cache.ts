import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CACHE_DIR = join(homedir(), ".cache", "llm-models");
const DEFAULT_TTL = 3_600_000; // 1 hour

let cacheEnabled = true;

export function setCacheEnabled(enabled: boolean): void {
  cacheEnabled = enabled;
}

export function isCacheEnabled(): boolean {
  return cacheEnabled;
}

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function readCache<T>(key: string, ttlMs = DEFAULT_TTL): T | null {
  if (!cacheEnabled) return null;
  const filePath = join(CACHE_DIR, `${key}.json`);
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    const cached = JSON.parse(raw) as { timestamp: number; data: T };
    if (Date.now() - cached.timestamp > ttlMs) return null;
    return cached.data;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, data: T): void {
  if (!cacheEnabled) return;
  ensureCacheDir();
  const filePath = join(CACHE_DIR, `${key}.json`);
  writeFileSync(filePath, JSON.stringify({ timestamp: Date.now(), data }));
}

export function readSnapshot<T>(key: string): { timestamp: number; data: T } | null {
  const filePath = join(CACHE_DIR, `${key}.json`);
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as { timestamp: number; data: T };
  } catch {
    return null;
  }
}

export function clearCache(): void {
  if (existsSync(CACHE_DIR)) {
    rmSync(CACHE_DIR, { recursive: true });
    console.log("Cache cleared.");
  } else {
    console.log("No cache to clear.");
  }
}

export function getCacheInfo(): { files: number; sizeBytes: number } {
  if (!existsSync(CACHE_DIR)) return { files: 0, sizeBytes: 0 };
  const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
  let sizeBytes = 0;
  for (const file of files) {
    try {
      const stat = Bun.file(join(CACHE_DIR, file));
      sizeBytes += stat.size;
    } catch {
      // ignore
    }
  }
  return { files: files.length, sizeBytes };
}
