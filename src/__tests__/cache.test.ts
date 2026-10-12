import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearCache,
  getCacheDir,
  isCacheEnabled,
  readCache,
  readSnapshot,
  setCacheDir,
  setCacheEnabled,
  setCacheTtl,
  writeCache,
} from "../cache";

// Never touch the real ~/.cache/llm-models: clearCache() below wipes the directory.
const REAL_CACHE_DIR = getCacheDir();
const CACHE_DIR = join(mkdtempSync(join(tmpdir(), "llm-models-cache-")), "llm-models");
const TEST_KEY = "__test_cache_key__";

beforeAll(() => {
  setCacheDir(CACHE_DIR);
});

beforeEach(() => {
  setCacheEnabled(true);
  // Clean up test key
  const filePath = join(CACHE_DIR, `${TEST_KEY}.json`);
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
});

afterAll(() => {
  rmSync(join(CACHE_DIR, ".."), { recursive: true, force: true });
  setCacheDir(REAL_CACHE_DIR);
});

describe("setCacheEnabled / isCacheEnabled", () => {
  it("defaults to enabled", () => {
    setCacheEnabled(true);
    expect(isCacheEnabled()).toBe(true);
  });

  it("can be disabled", () => {
    setCacheEnabled(false);
    expect(isCacheEnabled()).toBe(false);
    setCacheEnabled(true);
  });
});

describe("writeCache / readCache", () => {
  it("writes and reads data", () => {
    const data = { foo: "bar", count: 42 };
    writeCache(TEST_KEY, data);
    const result = readCache<typeof data>(TEST_KEY);
    expect(result).toEqual(data);
  });

  it("returns null for missing key", () => {
    const result = readCache("__nonexistent_key__");
    expect(result).toBeNull();
  });

  it("returns null when cache is disabled", () => {
    writeCache(TEST_KEY, { x: 1 });
    setCacheEnabled(false);
    const result = readCache<{ x: number }>(TEST_KEY);
    expect(result).toBeNull();
    setCacheEnabled(true);
  });

  it("does not write when cache is disabled", () => {
    setCacheEnabled(false);
    writeCache(TEST_KEY, { x: 1 });
    setCacheEnabled(true);
    const result = readCache<{ x: number }>(TEST_KEY);
    expect(result).toBeNull();
  });

  it("returns null for expired TTL", () => {
    // Write a cache entry with an old timestamp
    const filePath = join(CACHE_DIR, `${TEST_KEY}.json`);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify({ timestamp: Date.now() - 10_000, data: { old: true } }),
    );
    const result = readCache(TEST_KEY, 5_000); // 5s TTL, entry is 10s old
    expect(result).toBeNull();
  });

  it("returns data within TTL", () => {
    writeCache(TEST_KEY, { fresh: true });
    const result = readCache<{ fresh: boolean }>(TEST_KEY, 60_000);
    expect(result).toEqual({ fresh: true });
  });
});

describe("writeCache robustness", () => {
  it("never throws when the cache directory cannot be created", () => {
    // A regular file where the directory should be: mkdir fails with ENOTDIR.
    const blocker = join(CACHE_DIR, "..", "blocker");
    writeFileSync(blocker, "");
    setCacheDir(join(blocker, "llm-models"));
    try {
      expect(() => writeCache(TEST_KEY, { x: 1 })).not.toThrow();
      expect(readCache(TEST_KEY)).toBeNull();
    } finally {
      setCacheDir(CACHE_DIR);
    }
  });

  it("leaves no temp file behind", () => {
    writeCache(TEST_KEY, { x: 1 });
    expect(readdirSync(CACHE_DIR).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("setCacheTtl", () => {
  it("governs the default freshness window", () => {
    writeFileSync(
      join(CACHE_DIR, `${TEST_KEY}.json`),
      JSON.stringify({ timestamp: Date.now() - 10_000, data: { old: true } }),
    );
    try {
      setCacheTtl(5_000);
      expect(readCache(TEST_KEY)).toBeNull();
      setCacheTtl(60_000);
      expect(readCache(TEST_KEY)).toEqual({ old: true });
    } finally {
      setCacheTtl(3_600_000);
    }
  });
});

describe("readSnapshot", () => {
  it("returns null for missing key", () => {
    expect(readSnapshot("__nonexistent__")).toBeNull();
  });

  it("returns data with timestamp", () => {
    writeCache(TEST_KEY, { snap: true });
    const result = readSnapshot<{ snap: boolean }>(TEST_KEY);
    expect(result).not.toBeNull();
    expect(result?.data).toEqual({ snap: true });
    expect(typeof result?.timestamp).toBe("number");
    expect(result?.timestamp).toBeGreaterThan(0);
  });
});

describe("clearCache", () => {
  it("clears cache directory", () => {
    writeCache(TEST_KEY, { x: 1 });
    clearCache();
    expect(readCache(TEST_KEY)).toBeNull();
  });

  it("handles non-existent cache directory gracefully", () => {
    if (existsSync(CACHE_DIR)) {
      rmSync(CACHE_DIR, { recursive: true });
    }
    expect(() => clearCache()).not.toThrow();
  });
});
