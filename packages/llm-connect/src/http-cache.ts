// A fetch that keeps GET responses in Cache Storage, so a page (or a PWA
// launch) reuses the catalog sources it downloaded earlier. Browser APIs only:
// no Node.js builtin may be imported here.

/** Cache Storage name of the responses `liveCatalog` downloads. */
export const CATALOG_CACHE_NAME = "llm-connect-catalog";

/** How long a stored response is used without asking the server: 1 hour, as in llm-models. */
export const CATALOG_CACHE_TTL_MS = 3_600_000;

/** When the response was stored or last revalidated, in ms since the epoch. */
const STORED_AT = "x-llm-connect-stored-at";

/** Response headers kept with the body. */
const KEPT_HEADERS = ["content-type", "etag", "last-modified"];

export interface CachedFetchOptions {
  /** Cache Storage name. Default {@link CATALOG_CACHE_NAME}. */
  cacheName?: string;
  /** Milliseconds a stored response is fresh. Default {@link CATALOG_CACHE_TTL_MS}. */
  ttlMs?: number;
  /** Default `globalThis.caches` when the page has one. */
  caches?: CacheStorage;
  /** fetch for the network. Default the global fetch. */
  fetch?: typeof fetch;
}

/** The page's Cache Storage, or undefined (no browser, insecure context, or access denied). */
function pageCaches(): CacheStorage | undefined {
  try {
    return (globalThis as { caches?: CacheStorage }).caches;
  } catch {
    return undefined;
  }
}

/**
 * Whether the page may send If-None-Match itself. Cross-origin, that header is
 * not CORS-safelisted: it would need a preflight that models.dev (405) and
 * OpenRouter refuse, and their ETag is not exposed to the page anyway. There
 * the browser's HTTP cache revalidates on its own (models.dev answers
 * `max-age=0, must-revalidate`).
 */
function sameOrigin(url: string): boolean {
  const location = (globalThis as { location?: { href: string; origin: string } }).location;
  if (!location) return true;
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** The caller cancelled the request, as opposed to a timeout or a network error. */
function cancelled(signal: AbortSignal | null | undefined): boolean {
  if (!signal?.aborted) return false;
  return (signal.reason as { name?: unknown } | undefined)?.name !== "TimeoutError";
}

/** Store `body` with the headers worth keeping, stamped now; best effort. */
async function store(cache: Cache, url: string, body: string, source: Headers): Promise<Response> {
  const headers = new Headers({ [STORED_AT]: String(Date.now()) });
  for (const name of KEPT_HEADERS) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  try {
    await cache.put(url, new Response(body, { headers }));
  } catch {
    // Quota exceeded or storage unavailable: the response still serves this page
  }
  return new Response(body, { status: 200, headers });
}

/**
 * A fetch that keeps GET responses in Cache Storage, keyed by URL:
 * - a stored response younger than `ttlMs` is returned without a request;
 * - an older one is revalidated: with `If-None-Match` and its ETag on the
 *   page's own origin (a 304 refreshes it), through the browser's HTTP cache
 *   otherwise; a 200 replaces it;
 * - when the network fails or the server errors, the stored response is
 *   returned however old it is, as llm-models falls back to an expired cache.
 *
 * Without Cache Storage it is the plain fetch: llm-models' in-memory cache
 * still serves the page.
 */
export function cachedFetch(options: CachedFetchOptions = {}): typeof fetch {
  const { cacheName = CATALOG_CACHE_NAME, ttlMs = CATALOG_CACHE_TTL_MS } = options;
  const network = (input: RequestInfo | URL, init?: RequestInit) =>
    (options.fetch ?? globalThis.fetch)(input, init);
  let opened: Promise<Cache | null> | undefined;
  const open = () => {
    opened ??= (async () => {
      const storage = options.caches ?? pageCaches();
      if (!storage) return null;
      try {
        return await storage.open(cacheName);
      } catch {
        return null;
      }
    })();
    return opened;
  };

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const cache = method.toUpperCase() === "GET" ? await open() : null;
    if (!cache) return network(input, init);

    const url = urlOf(input);
    const cached = await cache.match(url).catch(() => undefined);
    const storedAt = Number(cached?.headers.get(STORED_AT));
    if (cached && Date.now() - storedAt < ttlMs) return cached;

    const headers = new Headers(init?.headers);
    const etag = cached?.headers.get("etag");
    if (etag && sameOrigin(url)) headers.set("If-None-Match", etag);

    let response: Response;
    try {
      response = await network(url, { ...init, headers });
    } catch (error) {
      if (cached && !cancelled(init?.signal)) return cached;
      throw error;
    }
    if (cached && response.status === 304)
      return store(cache, url, await cached.text(), cached.headers);
    if (!response.ok) return cached ?? response;
    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      if (cached && !cancelled(init?.signal)) return cached;
      throw error;
    }
    return store(cache, url, body, response.headers);
  }) as typeof fetch;
}
