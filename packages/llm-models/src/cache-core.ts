import { debug, formatAge } from "./log";

// The cache logic, free of any Node.js API so it also runs in a browser. Where
// entries live is a CacheStore: in memory by default, on disk once `./cache`
// (Node only) is loaded, which the package's Node entry point does.

const DEFAULT_TTL = 3_600_000; // 1 hour

export interface CacheEntry<T = unknown> {
  timestamp: number;
  data: T;
}

/** Where cache entries live. Methods may throw; callers treat that as a miss. */
export interface CacheStore {
  read(key: string): CacheEntry | null;
  write(key: string, entry: CacheEntry): void;
  remove(key: string): void;
  /** Drop every entry. Returns false when there was nothing to drop. */
  clear(): boolean;
}

/** Entries kept for the life of the page or process. */
export function createMemoryStore(): CacheStore {
  const entries = new Map<string, CacheEntry>();
  return {
    read: (key) => entries.get(key) ?? null,
    write: (key, entry) => {
      entries.set(key, entry);
    },
    remove: (key) => {
      entries.delete(key);
    },
    clear: () => {
      const had = entries.size > 0;
      entries.clear();
      return had;
    },
  };
}

let store: CacheStore = createMemoryStore();
let cacheEnabled = true;
let cacheTtl = DEFAULT_TTL;

/** Swap where cache entries live (the Node entry point installs a disk store). */
export function setCacheStore(next: CacheStore): void {
  store = next;
}

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

export function readCache<T>(key: string, ttlMs = cacheTtl): T | null {
  if (!cacheEnabled) {
    debug(`cache ${key}: disabled`);
    return null;
  }
  try {
    const cached = store.read(key) as CacheEntry<T> | null;
    if (!cached) {
      debug(`cache ${key}: miss (no entry)`);
      return null;
    }
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

/** Best effort: a store that cannot write must never fail the command that fetched the data. */
export function writeCache<T>(key: string, data: T, timestamp = Date.now()): void {
  if (!cacheEnabled) return;
  try {
    store.write(key, { timestamp, data });
  } catch (err) {
    debug(`cache ${key}: not written (${err instanceof Error ? err.message : String(err)})`);
  }
}

/** Delete one cache entry, if present. */
export function removeCache(key: string): void {
  if (!cacheEnabled) return;
  try {
    store.remove(key);
  } catch {
    // best effort
  }
}

export function readSnapshot<T>(key: string): CacheEntry<T> | null {
  try {
    return store.read(key) as CacheEntry<T> | null;
  } catch {
    return null;
  }
}

export function readFallbackCache<T>(key: string): T | null {
  return readSnapshot<T>(key)?.data ?? null;
}

export function clearCache(): void {
  console.log(store.clear() ? "Cache cleared." : "No cache to clear.");
}
