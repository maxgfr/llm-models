import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { debug, formatAge } from "./log";

const DEFAULT_TTL = 3_600_000; // 1 hour

let cacheDir = join(homedir(), ".cache", "llm-models");
let cacheEnabled = true;
let cacheTtl = DEFAULT_TTL;

/** How long a cached API response stays fresh, in milliseconds. */
export function setCacheTtl(ttlMs: number): void {
  cacheTtl = ttlMs;
}

export function getCacheTtl(): number {
  return cacheTtl;
}

export function setCacheEnabled(enabled: boolean): void {
  cacheEnabled = enabled;
}

export function isCacheEnabled(): boolean {
  return cacheEnabled;
}

/** Where cached API responses and the diff snapshot live. */
export function getCacheDir(): string {
  return cacheDir;
}

/** Point the cache somewhere else (tests, sandboxes). */
export function setCacheDir(dir: string): void {
  cacheDir = dir;
}

function ensureCacheDir(): void {
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
}

export function readCache<T>(key: string, ttlMs = cacheTtl): T | null {
  if (!cacheEnabled) {
    debug(`cache ${key}: disabled`);
    return null;
  }
  const filePath = join(cacheDir, `${key}.json`);
  try {
    if (!existsSync(filePath)) {
      debug(`cache ${key}: miss (no entry)`);
      return null;
    }
    const raw = readFileSync(filePath, "utf-8");
    const cached = JSON.parse(raw) as { timestamp: number; data: T };
    const age = formatAge(cached.timestamp);
    if (Date.now() - cached.timestamp > ttlMs) {
      debug(`cache ${key}: miss (expired, ${age} old)`);
      return null;
    }
    debug(`cache ${key}: hit (${age} old)`);
    return cached.data;
  } catch {
    debug(`cache ${key}: miss (unreadable)`);
    return null;
  }
}

/**
 * Best effort: a read-only or full disk must never fail the command that
 * fetched the data. The write goes to a temp file renamed into place, so a
 * concurrent reader never sees half a file.
 */
export function writeCache<T>(key: string, data: T): void {
  if (!cacheEnabled) return;
  const filePath = join(cacheDir, `${key}.json`);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    ensureCacheDir();
    writeFileSync(tmpPath, JSON.stringify({ timestamp: Date.now(), data }));
    renameSync(tmpPath, filePath);
  } catch (err) {
    debug(`cache ${key}: not written (${err instanceof Error ? err.message : String(err)})`);
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // nothing left to clean up
    }
  }
}

/** Delete one cache entry, if present. */
export function removeCache(key: string): void {
  if (!cacheEnabled) return;
  try {
    rmSync(join(cacheDir, `${key}.json`), { force: true });
  } catch {
    // best effort
  }
}

export function readSnapshot<T>(key: string): { timestamp: number; data: T } | null {
  const filePath = join(cacheDir, `${key}.json`);
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as { timestamp: number; data: T };
  } catch {
    return null;
  }
}

export function readFallbackCache<T>(key: string): T | null {
  const filePath = join(cacheDir, `${key}.json`);
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    const cached = JSON.parse(raw) as { timestamp: number; data: T };
    return cached.data;
  } catch {
    return null;
  }
}

export function clearCache(): void {
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true });
    console.log("Cache cleared.");
  } else {
    console.log("No cache to clear.");
  }
}

export function getCacheInfo(): { files: number; sizeBytes: number } {
  if (!existsSync(cacheDir)) return { files: 0, sizeBytes: 0 };
  const files = readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
  let sizeBytes = 0;
  for (const file of files) {
    try {
      sizeBytes += statSync(join(cacheDir, file)).size;
    } catch {
      // ignore
    }
  }
  return { files: files.length, sizeBytes };
}
