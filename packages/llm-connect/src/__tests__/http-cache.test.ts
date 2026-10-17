import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { CATALOG_CACHE_NAME, CATALOG_CACHE_TTL_MS, cachedFetch } from "../http-cache.js";
import { FakeCacheStorage } from "./fake-cache-storage.js";

const URL_ = "https://models.dev/api.json";
const T0 = new Date("2026-10-01T12:00:00Z");

interface Call {
  url: string;
  headers: Headers;
  method: string;
}

let calls: Call[] = [];

/** A server answering each request with `respond`, recording the calls. */
function server(respond: (call: Call) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      url: String(input),
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
    };
    calls.push(call);
    if (init?.signal?.aborted) throw init.signal.reason;
    return respond(call);
  }) as typeof fetch;
}

/** models.dev: `version` in the body, its ETag, and a 304 when If-None-Match matches. */
function etagServer(version: () => string) {
  return server(({ headers }) => {
    const etag = `"${version()}"`;
    if (headers.get("if-none-match") === etag) return new Response(null, { status: 304 });
    return new Response(JSON.stringify({ version: version() }), {
      headers: { "content-type": "application/json", etag },
    });
  });
}

const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

beforeEach(() => {
  calls = [];
  setSystemTime(T0);
});

afterEach(() => {
  setSystemTime();
});

describe("cachedFetch", () => {
  it("serves a fresh response from Cache Storage on the next page load, without a request", async () => {
    const storage = new FakeCacheStorage();
    const fetch = etagServer(() => "v1");
    const firstLoad = cachedFetch({ caches: storage.asCacheStorage(), fetch });
    const res = await firstLoad(URL_, { headers: { Accept: "application/json" } });
    expect(await res.json()).toEqual({ version: "v1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.get("accept")).toBe("application/json");
    expect(storage.entry(CATALOG_CACHE_NAME, URL_)?.headers.get("etag")).toBe('"v1"');

    setSystemTime(minutes(59));
    const nextLoad = cachedFetch({ caches: storage.asCacheStorage(), fetch });
    const cached = await nextLoad(URL_);
    expect(cached.ok).toBe(true);
    expect(await cached.json()).toEqual({ version: "v1" });
    expect(calls).toHaveLength(1);
  });

  it("revalidates an expired response with its ETag and keeps it on a 304", async () => {
    const storage = new FakeCacheStorage();
    const fetch = etagServer(() => "v1");
    const load = cachedFetch({ caches: storage.asCacheStorage(), fetch });
    await (await load(URL_)).text();

    setSystemTime(minutes(61));
    const res = await load(URL_);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: "v1" });
    expect(calls).toHaveLength(2);
    expect(calls[1].headers.get("if-none-match")).toBe('"v1"');

    // The 304 restarted the TTL
    setSystemTime(minutes(61 + 59));
    await (await load(URL_)).text();
    expect(calls).toHaveLength(2);
  });

  it("replaces an expired response the server changed", async () => {
    const storage = new FakeCacheStorage();
    let version = "v1";
    const load = cachedFetch({
      caches: storage.asCacheStorage(),
      fetch: etagServer(() => version),
    });
    await (await load(URL_)).text();

    version = "v2";
    setSystemTime(minutes(61));
    expect(await (await load(URL_)).json()).toEqual({ version: "v2" });
    expect(calls[1].headers.get("if-none-match")).toBe('"v1"');
    expect(storage.entry(CATALOG_CACHE_NAME, URL_)?.headers.get("etag")).toBe('"v2"');
  });

  it("follows the TTL and cache name it is given", async () => {
    const storage = new FakeCacheStorage();
    const load = cachedFetch({
      caches: storage.asCacheStorage(),
      fetch: etagServer(() => "v1"),
      cacheName: "my-app",
      ttlMs: 60_000,
    });
    await (await load(URL_)).text();
    expect(storage.entry("my-app", URL_)).toBeDefined();
    expect(storage.entry(CATALOG_CACHE_NAME, URL_)).toBeUndefined();
    setSystemTime(minutes(2));
    await (await load(URL_)).text();
    expect(calls).toHaveLength(2);
    expect(CATALOG_CACHE_TTL_MS).toBe(3_600_000);
  });

  it("sends no If-None-Match across origins, where it would need a CORS preflight", async () => {
    const storage = new FakeCacheStorage();
    const load = cachedFetch({ caches: storage.asCacheStorage(), fetch: etagServer(() => "v1") });
    await (await load(URL_)).text();
    await (await load("https://app.example/models.json")).text();

    const scope = globalThis as { location?: unknown };
    const location = scope.location;
    scope.location = { href: "https://app.example/settings", origin: "https://app.example" };
    try {
      setSystemTime(minutes(61));
      await (await load(URL_)).text();
      await (await load("https://app.example/models.json")).text();
    } finally {
      scope.location = location;
    }
    expect(calls).toHaveLength(4);
    expect(calls[2].headers.get("if-none-match")).toBeNull();
    expect(calls[3].headers.get("if-none-match")).toBe('"v1"');
  });

  it("serves an expired response when the network fails or the server errors", async () => {
    const storage = new FakeCacheStorage();
    let mode: "up" | "offline" | "error" = "up";
    const fetch = server(() => {
      if (mode === "offline") throw new TypeError("Failed to fetch");
      if (mode === "error") return new Response("down", { status: 503 });
      return new Response(JSON.stringify({ version: "v1" }));
    });
    const load = cachedFetch({ caches: storage.asCacheStorage(), fetch });
    await (await load(URL_)).text();

    setSystemTime(minutes(600));
    mode = "offline";
    expect(await (await load(URL_)).json()).toEqual({ version: "v1" });
    mode = "error";
    expect(await (await load(URL_)).json()).toEqual({ version: "v1" });
    expect(calls).toHaveLength(3);

    // Nothing stored: the failure goes through
    mode = "offline";
    await expect(load("https://openrouter.ai/api/v1/models")).rejects.toThrow("Failed to fetch");
    mode = "error";
    expect((await load("https://openrouter.ai/api/v1/models")).status).toBe(503);
    expect(
      storage.entry(CATALOG_CACHE_NAME, "https://openrouter.ai/api/v1/models"),
    ).toBeUndefined();
  });

  it("rethrows the caller's own abort instead of serving an expired response", async () => {
    const storage = new FakeCacheStorage();
    const load = cachedFetch({
      caches: storage.asCacheStorage(),
      fetch: server(() => new Response("{}")),
    });
    await (await load(URL_)).text();
    setSystemTime(minutes(61));
    await expect(load(URL_, { signal: AbortSignal.abort() })).rejects.toThrow();
  });

  it("is the plain fetch without Cache Storage, and for other methods", async () => {
    const fetch = server(() => new Response("{}"));
    const scope = globalThis as { caches?: unknown };
    const caches = scope.caches;
    scope.caches = undefined;
    try {
      const load = cachedFetch({ fetch });
      await load(URL_);
      await load(URL_);
      expect(calls).toHaveLength(2);
    } finally {
      scope.caches = caches;
    }

    const storage = new FakeCacheStorage();
    const load = cachedFetch({ caches: storage.asCacheStorage(), fetch });
    await load(URL_, { method: "POST", body: "{}" });
    expect(storage.entry(CATALOG_CACHE_NAME, URL_)).toBeUndefined();
    expect(calls[2].method).toBe("POST");
  });

  it("still answers when Cache Storage refuses to store or to open", async () => {
    const storage = new FakeCacheStorage();
    storage.failPuts = true;
    const fetch = server(() => new Response(JSON.stringify({ version: "v1" })));
    const load = cachedFetch({ caches: storage.asCacheStorage(), fetch });
    expect(await (await load(URL_)).json()).toEqual({ version: "v1" });

    const broken = {
      open: async () => {
        throw new DOMException("denied", "SecurityError");
      },
    } as unknown as CacheStorage;
    const plain = cachedFetch({ caches: broken, fetch });
    expect(await (await plain(URL_)).json()).toEqual({ version: "v1" });
  });
});

describe("browser bundle", () => {
  it("pulls in no Node.js builtin, the live catalog included", async () => {
    const pulled = new Set<string>();
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "..", "catalog-client.ts")],
      target: "browser",
      throw: false,
      plugins: [
        {
          name: "watch-node-builtins",
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if (isBuiltin(args.path)) pulled.add(args.path);
              return undefined;
            });
          },
        },
      ],
    });
    expect(build.success).toBe(true);
    expect([...pulled]).toEqual([]);
  });
});
