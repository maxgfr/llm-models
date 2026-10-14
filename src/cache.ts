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
import { type CacheEntry, type CacheStore, setCacheStore } from "./cache-core";

// Node only: the on-disk cache under ~/.cache/llm-models. Importing this module
// installs it as the cache store; the browser entry point never imports it.

export {
  clearCache,
  getCacheTtl,
  isCacheEnabled,
  readCache,
  readFallbackCache,
  readSnapshot,
  removeCache,
  setCacheEnabled,
  setCacheTtl,
  writeCache,
} from "./cache-core";

let cacheDir = join(homedir(), ".cache", "llm-models");

/** Where cached API responses and the diff snapshot live. */
export function getCacheDir(): string {
  return cacheDir;
}

/** Point the cache somewhere else (tests, sandboxes). */
export function setCacheDir(dir: string): void {
  cacheDir = dir;
}

const entryPath = (key: string) => join(cacheDir, `${key}.json`);

export const diskStore: CacheStore = {
  read(key) {
    const filePath = entryPath(key);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8")) as CacheEntry;
  },
  /**
   * The write goes to a temp file renamed into place, so a concurrent reader
   * never sees half a file.
   */
  write(key, entry) {
    const filePath = entryPath(key);
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    try {
      if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
      writeFileSync(tmpPath, JSON.stringify(entry));
      renameSync(tmpPath, filePath);
    } catch (err) {
      try {
        rmSync(tmpPath, { force: true });
      } catch {
        // nothing left to clean up
      }
      throw err;
    }
  },
  remove(key) {
    rmSync(entryPath(key), { force: true });
  },
  clear() {
    if (!existsSync(cacheDir)) return false;
    rmSync(cacheDir, { recursive: true });
    return true;
  },
};

setCacheStore(diskStore);

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
